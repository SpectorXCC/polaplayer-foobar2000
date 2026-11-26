param(
    [string] $FoobarSdk = $env:POLAPLAYER_FOOBAR_SDK,
    [string] $FoobarLibraries = $env:POLAPLAYER_FOOBAR_LIBRARIES,
    [string] $Msvc = $env:POLAPLAYER_MSVC,
    [string] $WindowsIncludes = $env:POLAPLAYER_WINDOWS_INCLUDES,
    [string] $WindowsLibraries = $env:POLAPLAYER_WINDOWS_LIBRARIES,
    [string] $Verdant = (Join-Path $PSScriptRoot '..\..'),
    [switch] $RunTests
)
$ErrorActionPreference = 'Stop'

function Resolve-BuildDirectory([string] $Path, [string] $Option, [string] $EnvironmentVariable) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "Pass -$Option or set $EnvironmentVariable to the directory path."
    }
    if (!(Test-Path -LiteralPath $Path -PathType Container)) {
        throw "-$Option requires an existing directory: $Path"
    }
    (Resolve-Path -LiteralPath $Path).ProviderPath
}

$FoobarSdk = Resolve-BuildDirectory $FoobarSdk 'FoobarSdk' 'POLAPLAYER_FOOBAR_SDK'
$FoobarLibraries = Resolve-BuildDirectory $FoobarLibraries 'FoobarLibraries' 'POLAPLAYER_FOOBAR_LIBRARIES'
$Msvc = Resolve-BuildDirectory $Msvc 'Msvc' 'POLAPLAYER_MSVC'
$WindowsIncludes = Resolve-BuildDirectory $WindowsIncludes 'WindowsIncludes' 'POLAPLAYER_WINDOWS_INCLUDES'
$WindowsLibraries = Resolve-BuildDirectory $WindowsLibraries 'WindowsLibraries' 'POLAPLAYER_WINDOWS_LIBRARIES'
$Verdant = (Resolve-Path -LiteralPath $Verdant).ProviderPath

$out = Join-Path $PSScriptRoot 'out'
$webOut = Join-Path $out 'web'
$webSrc = Join-Path $PSScriptRoot 'web'
$native = Join-Path $Verdant 'native'
New-Item -ItemType Directory -Path $webOut -Force | Out-Null

# 1. Build independent Preact + AMLL frontend bundle
Push-Location $webSrc
try {
    node .\node_modules\typescript\bin\tsc --noEmit
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($RunTests) {
        node .\tests\run.mjs
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    node .\build.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }

# 2. Compile C++ native component
$env:INCLUDE = @("$Msvc\include", "$WindowsIncludes\ucrt", "$WindowsIncludes\shared", "$WindowsIncludes\um", "$WindowsIncludes\winrt", "$WindowsIncludes\cppwinrt") -join ';'
$env:LIB = @("$Msvc\lib\x64", "$WindowsLibraries\ucrt\x64", "$WindowsLibraries\um\x64") -join ';'
$compiler = Join-Path $Msvc 'bin\Hostx64\x64\cl.exe'
$kit = @('foobar2000_component_client.lib', 'foobar2000_SDK.lib', 'pfc.lib', 'shared.lib') |
    ForEach-Object { Join-Path $FoobarLibraries $_ }
$flags = @('/nologo', '/EHsc', '/std:c++20', '/O2', '/MD', '/utf-8', '/DUNICODE', '/D_UNICODE', '/DNOMINMAX', '/DNDEBUG', '/DWIN32_LEAN_AND_MEAN', '/D_WIN32_WINNT=0x0A00')
$sources = @(
    (Join-Path $PSScriptRoot 'polaplayer_ui.cpp'),
    (Join-Path $PSScriptRoot 'navidrome_native.cpp'),
    (Join-Path $PSScriptRoot 'art_server.cpp'),
    (Join-Path $PSScriptRoot 'local_index.cpp'),
    (Join-Path $native 'webview_host.cpp')
)
$link = @('/INCLUDE:foobar2000_get_interface', '/OUT:foo_ui_polaplayer.dll',
    'user32.lib', 'gdi32.lib', 'shell32.lib', 'shlwapi.lib', 'ole32.lib',
    'oleaut32.lib', 'runtimeobject.lib', 'comctl32.lib', 'dwmapi.lib', 'uuid.lib',
    'winhttp.lib', 'bcrypt.lib', 'crypt32.lib', 'advapi32.lib', 'windowscodecs.lib')

Push-Location $out
try {
    & $compiler @flags "/I$FoobarSdk" "/I$native" "/I$native\vendor\webview2\include" /LD @sources /link @link @kit
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }

# 3. Assemble package files
Copy-Item -LiteralPath (Join-Path $native 'WebView2Loader.dll') -Destination $out -Force
$dist = Join-Path $webSrc 'dist'
foreach ($asset in @('app.css', 'app.js', 'index.html')) {
    Copy-Item -LiteralPath (Join-Path $dist $asset) -Destination $webOut -Force
}
foreach ($notice in @('LICENSE', 'THIRD-PARTY-NOTICES.md')) {
    $path = Join-Path $Verdant $notice
    if (Test-Path -LiteralPath $path) { Copy-Item -LiteralPath $path -Destination $out -Force }
}

$archive = Join-Path $PSScriptRoot 'foo_ui_polaplayer.fb2k-component'
$package = @('foo_ui_polaplayer.dll', 'WebView2Loader.dll', 'web', 'LICENSE', 'THIRD-PARTY-NOTICES.md') |
    ForEach-Object { Join-Path $out $_ } | Where-Object { Test-Path -LiteralPath $_ }
$outPrefix = $out.TrimEnd('\', '/') + '\'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
$zip = [System.IO.Compression.ZipFile]::Open($archive, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($item in $package) {
        $entries = if (Test-Path -LiteralPath $item -PathType Container) {
            Get-ChildItem -LiteralPath $item -File -Recurse
        } else {
            Get-Item -LiteralPath $item
        }
        foreach ($entry in $entries) {
            $relative = $entry.FullName.Substring($outPrefix.Length).Replace('\', '/')
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $entry.FullName, $relative) | Out-Null
        }
    }
} finally { $zip.Dispose() }
Write-Output "Built $archive"

if ($RunTests) {
    $testsDir = Join-Path $PSScriptRoot 'tests'
    foreach ($tName in @('local_lyrics.test', 'local_index.test', 'navidrome_parser.test', 'fft_stream.test')) {
        $cpp = Join-Path $testsDir "$tName.cpp"
        $exe = Join-Path $testsDir "$tName.exe"
        g++ -std=c++20 -O2 -static -static-libgcc -static-libstdc++ "-I$PSScriptRoot" $cpp -o $exe
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & $exe
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    Push-Location $Verdant
    try {
        node .\tests\run.js
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally { Pop-Location }
}

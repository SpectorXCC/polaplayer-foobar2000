$ErrorActionPreference = 'Stop'
$nativeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$vendorDir = Join-Path $nativeDir 'vendor\webview2'
$incDir = Join-Path $vendorDir 'include'
$tmpZip = Join-Path $vendorDir 'webview2.nupkg.zip'
$extractDir = Join-Path $vendorDir 'pkg'

$hdr = Join-Path $incDir 'WebView2.h'
$loaderDst = Join-Path $nativeDir 'WebView2Loader.dll'

if ((Test-Path $hdr) -and (Test-Path $loaderDst)) {
    Write-Host "WebView2 SDK and WebView2Loader.dll already present."
    exit 0
}

New-Item -ItemType Directory -Force -Path $incDir | Out-Null
$url = 'https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2'
Write-Host "Downloading Microsoft.Web.WebView2 NuGet package..."
Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing

if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
Expand-Archive -Path $tmpZip -DestinationPath $extractDir -Force

$pkgInc = Join-Path $extractDir 'build\native\include'
if (-not (Test-Path (Join-Path $pkgInc 'WebView2.h'))) {
    throw "WebView2.h not found inside NuGet package at $pkgInc"
}
Copy-Item -Path (Join-Path $pkgInc '*') -Destination $incDir -Force

$pkgLoader = Join-Path $extractDir 'runtimes\win-x64\native\WebView2Loader.dll'
if (-not (Test-Path $pkgLoader)) {
    throw "win-x64 WebView2Loader.dll not found at $pkgLoader"
}
Copy-Item -Path $pkgLoader -Destination $loaderDst -Force

$pkgLicense = Join-Path $extractDir 'LICENSE.txt'
if (Test-Path $pkgLicense) {
    Copy-Item -Path $pkgLicense -Destination (Join-Path $vendorDir 'LICENSE.txt') -Force
}

Remove-Item -Force $tmpZip -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue

Write-Host "Installed WebView2 headers -> $incDir"
Write-Host "Installed WebView2Loader.dll -> $loaderDst"

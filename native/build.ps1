$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$fetch = Join-Path $dir 'fetch-webview2.ps1'
$wvInc = Join-Path $dir 'vendor\webview2\include'
if (-not (Test-Path (Join-Path $wvInc 'WebView2.h'))) {
    & $fetch
}

$src1 = Join-Path $dir 'verdant_chrome.cpp'
$src2 = Join-Path $dir 'webview_host.cpp'
$def = Join-Path $dir 'VerdantChrome.def'
$out = Join-Path $dir 'VerdantChrome.dll'

g++ -shared -O2 -Wall -Wextra -Wno-unused-parameter -Wno-unknown-pragmas -static-libgcc -static-libstdc++ `
    -I"$wvInc" `
    $src1 $src2 $def -o $out `
    -luser32 -lgdi32 -lshell32 -lole32 -loleaut32 -lcomctl32 -ldwmapi -luuid

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Built: $out"

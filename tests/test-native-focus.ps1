$ErrorActionPreference='Stop'
$nativeDir=Join-Path (Split-Path -Parent $PSScriptRoot) 'native'
$wvInc=Join-Path $nativeDir 'vendor\webview2\include'
if(-not (Test-Path (Join-Path $wvInc 'WebView2.h'))){
    & (Join-Path $nativeDir 'fetch-webview2.ps1')
}
$out=Join-Path ([System.IO.Path]::GetTempPath()) ('verdant-focus-test-'+[guid]::NewGuid().ToString('N')+'.exe')
try {
    g++ -O2 -Wall -Wextra -Wno-unused-parameter -Wno-unknown-pragmas -static-libgcc -static-libstdc++ `
        -I"$wvInc" `
        (Join-Path $PSScriptRoot 'native_focus.test.cpp') `
        (Join-Path $nativeDir 'webview_host.cpp') -o $out `
        -luser32 -lgdi32 -lshell32 -lole32 -loleaut32 -lcomctl32 -ldwmapi -luuid
    if($LASTEXITCODE -ne 0){throw 'Native focus test compilation failed.'}
    & $out
    if($LASTEXITCODE -ne 0){throw 'Native focus regression failed.'}
} finally {
    if(Test-Path -LiteralPath $out){Remove-Item -LiteralPath $out -Force}
}

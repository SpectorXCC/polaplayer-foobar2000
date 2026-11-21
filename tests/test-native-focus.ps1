$ErrorActionPreference='Stop'
$out=Join-Path ([System.IO.Path]::GetTempPath()) ('verdant-focus-test-'+[guid]::NewGuid().ToString('N')+'.exe')
try {
    g++ -O2 -Wall -Wextra -Wno-unused-parameter -static-libgcc -static-libstdc++ `
        (Join-Path $PSScriptRoot 'native_focus.test.cpp') -o $out `
        -luser32 -lgdi32 -lshell32 -lole32 -loleaut32 -lcomctl32 -ldwmapi -luuid
    if($LASTEXITCODE -ne 0){throw 'Native focus test compilation failed.'}
    & $out
    if($LASTEXITCODE -ne 0){throw 'Native focus regression failed.'}
} finally {
    if(Test-Path -LiteralPath $out){Remove-Item -LiteralPath $out -Force}
}

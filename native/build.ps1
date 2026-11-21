$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $dir 'verdant_chrome.cpp'
$def = Join-Path $dir 'VerdantChrome.def'
$out = Join-Path $dir 'VerdantChrome.dll'

g++ -shared -O2 -Wall -Wextra -Wno-unused-parameter -static-libgcc -static-libstdc++ `
    $src $def -o $out `
    -luser32 -lgdi32 -lshell32 -lole32 -loleaut32 -lcomctl32 -ldwmapi -luuid

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Built: $out"

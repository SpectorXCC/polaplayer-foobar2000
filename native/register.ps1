$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$dll = Join-Path $dir 'VerdantChrome.dll'
if (-not (Test-Path $dll)) {
    throw "VerdantChrome.dll not found at $dll. Run build.ps1 first."
}

$clsid = '{A7E3C142-6F8B-4A21-9D5E-1B3C4E5F6A7B}'
$progId = 'Verdant.Chrome'

New-Item -Path "HKCU:\Software\Classes\$progId" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\$progId" -Name '(default)' -Value 'Verdant Chrome Helper'
New-Item -Path "HKCU:\Software\Classes\$progId\CLSID" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\$progId\CLSID" -Name '(default)' -Value $clsid

New-Item -Path "HKCU:\Software\Classes\CLSID\$clsid" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\CLSID\$clsid" -Name '(default)' -Value 'Verdant Chrome Helper'
New-Item -Path "HKCU:\Software\Classes\CLSID\$clsid\InprocServer32" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\CLSID\$clsid\InprocServer32" -Name '(default)' -Value $dll
Set-ItemProperty -Path "HKCU:\Software\Classes\CLSID\$clsid\InprocServer32" -Name 'ThreadingModel' -Value 'Apartment'

Write-Host "Registered $progId ($clsid) -> $dll (HKCU)"

$ErrorActionPreference = 'Stop'
$clsid = '{A7E3C142-6F8B-4A21-9D5E-1B3C4E5F6A7B}'
$progId = 'Verdant.Chrome'

Remove-Item -Path "HKCU:\Software\Classes\$progId" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "HKCU:\Software\Classes\CLSID\$clsid" -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Unregistered $progId ($clsid) from HKCU"

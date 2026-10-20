param([ValidateRange(0, 1800)][int]$DelaySeconds = 0, [switch]$Scheduled)
$ErrorActionPreference = 'Stop'
if ($DelaySeconds -gt 0) { Start-Sleep -Seconds $DelaySeconds; $Scheduled = $true }
& (Join-Path (Split-Path -Parent $PSScriptRoot) 'shared\runner.ps1') -ProjectDir $PSScriptRoot -Scheduled:$Scheduled -FromLogon:($DelaySeconds -gt 0)
exit $LASTEXITCODE

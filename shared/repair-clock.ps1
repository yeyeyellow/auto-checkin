#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$auditDir = Join-Path $PSScriptRoot ('artifacts\clock-repair-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $auditDir -Force | Out-Null
Get-CimInstance Win32_Service -Filter "Name='W32Time'" |
    Select-Object Name, State, StartMode |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $auditDir 'service-before.json') -Encoding UTF8
try {
    Set-Service -Name W32Time -StartupType Automatic
    Start-Service -Name W32Time
    # The command exit code alone does not prove that Windows has a valid time source.
    $synchronized = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $resync = & "$env:SystemRoot\System32\w32tm.exe" /resync /rediscover 2>&1
        $resync | Out-File -LiteralPath (Join-Path $auditDir 'resync.txt') -Encoding UTF8 -Append
        Start-Sleep -Seconds 2
        $status = @(& "$env:SystemRoot\System32\w32tm.exe" /query /status 2>&1)
        $statusExit = $LASTEXITCODE
        $status | Out-File -LiteralPath (Join-Path $auditDir 'status.txt') -Encoding UTF8
        if ($statusExit -eq 0 -and $status.Count -gt 0 -and $status[0] -match ':\s*0\s*\(') {
            $synchronized = $true
            break
        }
    }
    if (-not $synchronized) { throw 'Windows still reports an unsynchronized time source; see status.txt and resync.txt' }
    @{ success=$true; time=[DateTime]::UtcNow.ToString('o'); service=(Get-Service W32Time).Status.ToString() } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $auditDir 'result.json') -Encoding UTF8
    Write-Output ('Clock synchronized. Audit: ' + $auditDir)
} catch {
    @{ success=$false; time=[DateTime]::UtcNow.ToString('o'); error=$_.Exception.Message } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $auditDir 'result.json') -Encoding UTF8
    throw
}

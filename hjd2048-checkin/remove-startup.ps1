$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'run-checkin.ps1'
$startupPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Hjd2048Checkin.vbs'
if (Test-Path -LiteralPath $startupPath) {
    if (![IO.File]::ReadAllText($startupPath).Contains($runner)) { throw 'Startup entry belongs to a different project.' }
    Remove-Item -LiteralPath $startupPath
    Write-Output 'Removed the login startup entry.'
}
$task = Get-ScheduledTask -TaskName 'Hjd2048CheckinRecovery' -ErrorAction SilentlyContinue
if ($task) {
    $hiddenEntry = Join-Path $PSScriptRoot 'scheduled-checkin.vbs'
    if (-not $task.Actions.Arguments.Contains($runner) -and $task.Actions.Arguments -ne ('"' + $hiddenEntry + '"')) { throw 'Recovery task belongs to a different project.' }
    Unregister-ScheduledTask -TaskName 'Hjd2048CheckinRecovery' -Confirm:$false
    Write-Output 'Removed the recovery task.'
}

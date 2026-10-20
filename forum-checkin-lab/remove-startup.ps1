$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'run-checkin.ps1'
$startupPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'LaowangForumCheckin.vbs'
if (Test-Path -LiteralPath $startupPath) {
    if (![IO.File]::ReadAllText($startupPath).Contains($runner)) { throw 'Startup entry belongs to a different project.' }
    Remove-Item -LiteralPath $startupPath
    Write-Output 'Removed the login startup entry.'
}
$task = Get-ScheduledTask -TaskName 'LaowangForumCheckin' -ErrorAction SilentlyContinue
if ($task) {
    if (!$task.Actions.Arguments.Contains($runner)) { throw 'Scheduled task belongs to a different project.' }
    Unregister-ScheduledTask -TaskName 'LaowangForumCheckin' -Confirm:$false
    Write-Output 'Removed the boot scheduled task.'
}
$recovery = Get-ScheduledTask -TaskName 'LaowangForumCheckinRecovery' -ErrorAction SilentlyContinue
if ($recovery) {
    $hiddenEntry = Join-Path $PSScriptRoot 'scheduled-checkin.vbs'
    if (-not $recovery.Actions.Arguments.Contains($runner) -and $recovery.Actions.Arguments -ne ('"' + $hiddenEntry + '"')) { throw 'Recovery task belongs to a different project.' }
    Unregister-ScheduledTask -TaskName 'LaowangForumCheckinRecovery' -Confirm:$false
    Write-Output 'Removed the recovery task.'
}

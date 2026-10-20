$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$wscriptPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$definitions = @(
    @{ Project='forum-checkin-lab'; Name='LaowangForumCheckinRecovery' },
    @{ Project='hjd2048-checkin'; Name='Hjd2048CheckinRecovery' }
)
foreach ($definition in $definitions) {
    $runner = Join-Path $workspace ($definition.Project + '\run-checkin.ps1')
    $hiddenEntry = Join-Path $workspace ($definition.Project + '\scheduled-checkin.vbs')
    $existing = Get-ScheduledTask -TaskName $definition.Name -ErrorAction SilentlyContinue
    if ($existing -and -not ($existing.Actions.Arguments -like ('*"' + $runner + '"*')) -and -not ($existing.Actions.Arguments -eq ('"' + $hiddenEntry + '"'))) { throw 'Existing task points outside this workspace; refusing replacement' }
    $command = 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runner + '" -Scheduled'
    $content = 'Set shell = CreateObject("WScript.Shell")' + "`r`n" + 'WScript.Quit shell.Run("' + $command.Replace('"', '""') + '", 0, True)' + "`r`n"
    [IO.File]::WriteAllText($hiddenEntry, $content, [Text.Encoding]::Unicode)
    # 启动文件夹开启当日登录周期；任务仅补试该周期，不自行开启新日期。
    $action = New-ScheduledTaskAction -Execute $wscriptPath -Argument ('"' + $hiddenEntry + '"') -WorkingDirectory (Split-Path -Parent $runner)
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 5)
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 14)
    Register-ScheduledTask -TaskName $definition.Name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Retry only a check-in cycle started by Windows login today; no independent midnight check-in; headless.' -Force | Out-Null
    $installed = Get-ScheduledTask -TaskName $definition.Name
    if ($installed.Principal.LogonType -ne 'Interactive' -or $installed.Actions.Arguments -ne ('"' + $hiddenEntry + '"')) { throw 'Installed task validation failed' }
    Write-Output ('Installed and verified: ' + $definition.Name)
}

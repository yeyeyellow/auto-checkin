param([ValidateSet('Logon', 'Boot')][string]$Mode = 'Logon')
$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$runner = Join-Path $projectDir 'run-checkin.ps1'
$taskName = 'LaowangForumCheckin'
$startupPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'LaowangForumCheckin.vbs'
if ($Mode -eq 'Logon') {
    $command = 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runner + '" -DelaySeconds 180'
    $content = 'Set shell = CreateObject("WScript.Shell")' + "`r`n" + 'shell.Run "' + $command.Replace('"', '""') + '", 0, False' + "`r`n"
    if (Test-Path -LiteralPath $startupPath) {
        if ([IO.File]::ReadAllText($startupPath) -ne $content) { throw 'A different startup entry already exists. Inspect it before replacing.' }
    } else {
        [IO.File]::WriteAllText($startupPath, $content, [Text.Encoding]::Unicode)
    }
    Write-Output ('Installed: ' + $startupPath)
} else {
    $admin = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (!$admin) { throw 'Boot mode requires an administrator PowerShell.' }
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing) { throw 'A scheduled task with this name already exists. Inspect it before replacing.' }
    $powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $action = New-ScheduledTaskAction -Execute $powershellPath -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runner + '"') -WorkingDirectory $projectDir
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $trigger.Delay = 'PT3M'
    $userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType S4U -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Headless forum check-in, three minutes after Windows starts.' | Out-Null
    Write-Output ('Installed task: ' + $taskName)
}

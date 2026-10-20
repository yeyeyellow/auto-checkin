$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'run-checkin.ps1'
$startupPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Hjd2048Checkin.vbs'
$command = 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runner + '" -DelaySeconds 180'
$content = 'Set shell = CreateObject("WScript.Shell")' + "`r`n" + 'shell.Run "' + $command.Replace('"', '""') + '", 0, False' + "`r`n"
if (Test-Path -LiteralPath $startupPath) {
    if ([IO.File]::ReadAllText($startupPath) -ne $content) { throw 'A different startup entry already exists; inspect it before replacing.' }
} else {
    [IO.File]::WriteAllText($startupPath, $content, [Text.Encoding]::Unicode)
}
Write-Output ('Installed: ' + $startupPath)

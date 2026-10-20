param([string]$ProjectDir, [switch]$Scheduled, [switch]$FromLogon)
$ErrorActionPreference = 'Stop'
$artifactDir = Join-Path $ProjectDir 'artifacts'
New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null
$logPath = Join-Path $artifactDir 'startup.log'
. (Join-Path $PSScriptRoot 'login-cycle.ps1')
if ($Scheduled -or $FromLogon) {
    $hkZone = [TimeZoneInfo]::FindSystemTimeZoneById('China Standard Time')
    $cycleDate = [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $hkZone).ToString('yyyy-MM-dd')
    $bootTime = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')
    try { $bootId = Get-CheckinBootId }
    catch {
        ('[{0}] BOOT_ID_UNAVAILABLE: {1}; recovery task will check again' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $_.Exception.Message) | Out-File -LiteralPath $logPath -Encoding utf8 -Append
        exit 4
    }
    $cyclePath = Join-Path $artifactDir 'login-cycle.json'
    if ($FromLogon) {
        $cycle = @{ date=$cycleDate; bootTime=$bootTime; bootId=$bootId }
        $cycleTemp = $cyclePath + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
        [IO.File]::WriteAllText($cycleTemp, ($cycle | ConvertTo-Json), [Text.Encoding]::UTF8)
        Move-Item -LiteralPath $cycleTemp -Destination $cyclePath -Force
    } else {
        $cycle = $null
        if (Test-Path -LiteralPath $cyclePath) {
            try { $cycle = Get-Content -LiteralPath $cyclePath -Raw | ConvertFrom-Json } catch { }
        }
        if (-not (Test-CheckinLoginCycle -Cycle $cycle -Date $cycleDate -BootTime $bootTime -BootId $bootId)) {
            ('[{0}] SKIP NO_LOGIN_CYCLE: no check-in started by Windows login today' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) | Out-File -LiteralPath $logPath -Encoding utf8 -Append
            exit 0
        }
        if ([string]::IsNullOrWhiteSpace($cycle.bootId)) {
            $cycle | Add-Member -NotePropertyName bootId -NotePropertyValue $bootId -Force
            $cycleTemp = $cyclePath + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
            [IO.File]::WriteAllText($cycleTemp, ($cycle | ConvertTo-Json), [Text.Encoding]::UTF8)
            Move-Item -LiteralPath $cycleTemp -Destination $cyclePath -Force
        }
    }
}
# 恢复任务不能抢在用户登录后 3 分钟之前启动浏览器。
if ($Scheduled) {
    $sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
    $explorer = Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" | Where-Object { $_.SessionId -eq $sessionId } | Sort-Object CreationDate -Descending | Select-Object -First 1
    if ($null -ne $explorer -and ((Get-Date) - $explorer.CreationDate).TotalSeconds -lt 180) {
        ('[{0}] Waiting for login grace period' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) | Out-File -LiteralPath $logPath -Encoding utf8 -Append
        exit 0
    }
}
$exitCode = 4
$child = $null
try {
    ('[{0}] Starting check-in' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = 'C:\Program Files\nodejs\node.exe'
    $startInfo.Arguments = '"' + (Join-Path $ProjectDir 'checkin.mjs') + '"'
    if ($Scheduled) { $startInfo.Arguments += ' --scheduled' }
    $startInfo.WorkingDirectory = $ProjectDir
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
    $startInfo.StandardErrorEncoding = [Text.Encoding]::UTF8
    $child = [Diagnostics.Process]::Start($startInfo)
    $childStarted = $child.StartTime.ToUniversalTime().Ticks
    $stdout = $child.StandardOutput.ReadLineAsync()
    $stderr = $child.StandardError.ReadLineAsync()
    $stdoutDone = $false
    $stderrDone = $false
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while (-not ($child.HasExited -and $stdoutDone -and $stderrDone)) {
        if (-not $stdoutDone -and $stdout.IsCompleted) {
            $line = $stdout.Result
            if ($null -eq $line) { $stdoutDone = $true }
            else { $line | Out-File -LiteralPath $logPath -Encoding utf8 -Append; $stdout = $child.StandardOutput.ReadLineAsync() }
        }
        if (-not $stderrDone -and $stderr.IsCompleted) {
            $line = $stderr.Result
            if ($null -eq $line) { $stderrDone = $true }
            else { $line | Out-File -LiteralPath $logPath -Encoding utf8 -Append; $stderr = $child.StandardError.ReadLineAsync() }
        }
        if ($clock.Elapsed.TotalSeconds -gt 735) {
            $current = [Diagnostics.Process]::GetProcessById($child.Id)
            if (-not $current.HasExited -and $current.StartTime.ToUniversalTime().Ticks -eq $childStarted) {
                & "$env:SystemRoot\System32\taskkill.exe" /PID $child.Id /T /F | Out-Null
            }
            throw '运行超时，已核实并终止本次进程树；当日运行记录供下次恢复'
        }
        Start-Sleep -Milliseconds 50
    }
    $exitCode = $child.ExitCode
    if ($exitCode -ne 0 -and $exitCode -ne 5) {
        ('[{0}] Worker failed; inspect artifacts/runs and daily control' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    }
} catch {
    $_.Exception.Message | Out-File -LiteralPath $logPath -Encoding utf8 -Append
} finally {
    if ($null -ne $child) { $child.Dispose() }
    ('[{0}] Exit code: {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $exitCode) | Out-File -LiteralPath $logPath -Encoding utf8 -Append
}
exit $exitCode

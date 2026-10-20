param([string]$Name, [int]$OwnerPid, [int]$TimeoutSeconds = 300)
$ErrorActionPreference = 'Stop'
$owner = [Diagnostics.Process]::GetProcessById($OwnerPid)
$ownerStarted = $owner.StartTime.ToUniversalTime().Ticks
$mutex = [Threading.Mutex]::new($false, $Name)
$held = $false
try {
    try { $held = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $held = $true }
    if (-not $held) { [Console]::WriteLine('BUSY'); exit 5 }
    [Console]::WriteLine('ACQUIRED')
    # Console.In 的同步包装可能阻塞 ReadLineAsync；直接读取重定向管道。
    # 不在每次冷启动时编译 C#，减少开机负载。
    $reader = [IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.Encoding]::UTF8)
    $inputTask = $reader.ReadLineAsync()
    $elapsed = [Diagnostics.Stopwatch]::StartNew()
    while (-not $inputTask.Wait(1000)) {
        if ($owner.HasExited) { break }
        if ($elapsed.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
            # 同一进程对象、创建时间和存活状态共同确认；只终止拥有者的进程树。
            $current = [Diagnostics.Process]::GetProcessById($OwnerPid)
            if (-not $current.HasExited -and $current.StartTime.ToUniversalTime().Ticks -eq $ownerStarted) {
                & "$env:SystemRoot\System32\taskkill.exe" /PID $OwnerPid /T /F | Out-Null
            }
            break
        }
    }
} finally {
    if ($held) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
    if ($null -ne $reader) { $reader.Dispose() }
    $owner.Dispose()
}

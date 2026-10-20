function Get-CheckinBootId {
    # 事件记录中的时间不会随系统校时改变；不要用动态计算的 LastBootUpTime 作标识。
    $bootEvent = Get-WinEvent -FilterHashtable @{ LogName='System'; ProviderName='Microsoft-Windows-Kernel-General'; Id=12 } -MaxEvents 1 -ErrorAction Stop
    return ('system-boot:{0}:{1}' -f $bootEvent.RecordId, $bootEvent.TimeCreated.ToUniversalTime().Ticks)
}

function Test-CheckinLoginCycle {
    param($Cycle, [string]$Date, [string]$BootTime, [string]$BootId)
    if ($null -eq $Cycle -or $Cycle.date -ne $Date -or [string]::IsNullOrWhiteSpace($BootId)) { return $false }
    if (-not [string]::IsNullOrWhiteSpace($Cycle.bootId)) { return ($Cycle.bootId -eq $BootId) }

    # 只为旧记录迁移容忍小于一秒的校时误差；迁移后始终比较固定启动标识。
    $savedBoot = [DateTimeOffset]::MinValue
    $currentBoot = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse($Cycle.bootTime, [ref]$savedBoot) -or
        -not [DateTimeOffset]::TryParse($BootTime, [ref]$currentBoot)) { return $false }
    return ([Math]::Abs(($savedBoot - $currentBoot).TotalSeconds) -lt 1)
}

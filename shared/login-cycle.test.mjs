import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./login-cycle.ps1', import.meta.url)).replaceAll("'", "''");
const runner = fileURLToPath(new URL('./runner.ps1', import.meta.url)).replaceAll("'", "''");
function powershell(command) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.Encoding]::UTF8; ${command}`], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}

test('stable boot identity tolerates clock changes but rejects another boot, date, or missing identity', () => {
  const output = powershell(`
    . '${script}'
    $cycle = @{ date='2026-10-13'; bootTime='2026-10-08T13:52:47.6592070Z'; bootId='boot-a' }
    Test-CheckinLoginCycle -Cycle $null -Date '2026-10-13' -BootId 'boot-a'
    Test-CheckinLoginCycle -Cycle $cycle -Date '2026-10-13' -BootId 'boot-a' -BootTime '2026-10-08T14:52:47Z'
    Test-CheckinLoginCycle -Cycle $cycle -Date '2026-10-14' -BootId 'boot-a'
    Test-CheckinLoginCycle -Cycle $cycle -Date '2026-10-13' -BootId 'boot-b'
    Test-CheckinLoginCycle -Cycle $cycle -Date '2026-10-13'
  `);
  assert.deepEqual(output.split(/\r?\n/), ['False', 'True', 'False', 'False', 'False']);
});

test('legacy migration accepts the observed 0.731 ms drift and rejects reboot-sized drift or damaged records', () => {
  const output = powershell(`
    . '${script}'
    $cycle = @{ date='2026-10-13'; bootTime='2026-10-08T13:52:47.6592070Z' }
    Test-CheckinLoginCycle -Cycle $cycle -Date '2026-10-13' -BootId 'boot-a' -BootTime '2026-10-08T13:52:47.6599380Z'
    Test-CheckinLoginCycle -Cycle $cycle -Date '2026-10-13' -BootId 'boot-a' -BootTime '2026-10-08T13:52:47.6584760Z'
    Test-CheckinLoginCycle -Cycle $cycle -Date '2026-10-13' -BootId 'boot-a' -BootTime '2026-10-08T13:52:48.6592070Z'
    Test-CheckinLoginCycle -Cycle $cycle -Date '2026-10-13' -BootId 'boot-a' -BootTime '2026-10-09T13:52:47Z'
    Test-CheckinLoginCycle -Cycle $cycle -Date '2026-10-14' -BootId 'boot-a' -BootTime $cycle.bootTime
    $cycle.bootTime = 'damaged'
    Test-CheckinLoginCycle -Cycle $cycle -Date '2026-10-13' -BootId 'boot-a' -BootTime '2026-10-08T13:52:47Z'
    $cycle.bootTime = $null
    Test-CheckinLoginCycle -Cycle $cycle -Date '2026-10-13' -BootId 'boot-a' -BootTime '2026-10-08T13:52:47Z'
  `);
  assert.deepEqual(output.split(/\r?\n/), ['True', 'True', 'False', 'False', 'False', 'False', 'False']);
});

test('scheduled runner migrates an old cycle, survives clock changes, and skips invalid cycles without launching a worker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'checkin-login-cycle-'));
  const quotedRoot = root.replaceAll("'", "''");
  const cyclePath = join(root, 'artifacts', 'login-cycle.json');
  try {
    await mkdir(join(root, 'artifacts'));
    // A local worker records each launch; it does not connect to either forum.
    await writeFile(join(root, 'checkin.mjs'), `import { appendFileSync } from 'node:fs'; appendFileSync('worker-starts.txt', 'started\\n');`);
    powershell(`
      $boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().AddTicks(-7310).ToString('o')
      $cycle = @{ date=[TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, [TimeZoneInfo]::FindSystemTimeZoneById('China Standard Time')).ToString('yyyy-MM-dd'); bootTime=$boot }
      $cycle | ConvertTo-Json | Set-Content -LiteralPath '${quotedRoot}\\artifacts\\login-cycle.json' -Encoding UTF8
      & '${runner}' -ProjectDir '${quotedRoot}' -Scheduled
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    `);
    const migrated = JSON.parse((await readFile(cyclePath, 'utf8')).replace(/^\uFEFF/, ''));
    assert.match(migrated.bootId, /^system-boot:/);
    assert.equal((await readFile(join(root, 'worker-starts.txt'), 'utf8')).trim(), 'started');
    const runScheduled = () => powershell(`& '${runner}' -ProjectDir '${quotedRoot}' -Scheduled; exit $LASTEXITCODE`);
    await writeFile(cyclePath, JSON.stringify({ ...migrated, bootTime: '2000-01-01T00:00:00Z' }));
    runScheduled();
    assert.equal((await readFile(join(root, 'worker-starts.txt'), 'utf8')).trim().split('\n').length, 2);
    for (const invalid of [
      { ...migrated, bootId: 'another-boot' },
      { ...migrated, date: '2000-01-01' },
      null,
    ]) {
      await writeFile(cyclePath, JSON.stringify(invalid));
      runScheduled();
    }
    assert.equal((await readFile(join(root, 'worker-starts.txt'), 'utf8')).trim().split('\n').length, 2);
    assert.equal((await readFile(join(root, 'artifacts', 'startup.log'), 'utf8')).match(/NO_LOGIN_CYCLE/g).length, 3);
    powershell(`& '${runner}' -ProjectDir '${quotedRoot}' -Scheduled -FromLogon; exit $LASTEXITCODE`);
    const fresh = JSON.parse((await readFile(cyclePath, 'utf8')).replace(/^\uFEFF/, ''));
    assert.equal(fresh.bootId, migrated.bootId);
    assert.equal((await readFile(join(root, 'worker-starts.txt'), 'utf8')).trim().split('\n').length, 3);
    const unavailable = powershell(`
      function Get-WinEvent { throw 'boot event unavailable' }
      & '${runner}' -ProjectDir '${quotedRoot}' -Scheduled
      $LASTEXITCODE
      exit 0
    `);
    assert.equal(unavailable, '4');
    assert.equal((await readFile(join(root, 'worker-starts.txt'), 'utf8')).trim().split('\n').length, 3);
    assert.match(await readFile(join(root, 'artifacts', 'startup.log'), 'utf8'), /BOOT_ID_UNAVAILABLE/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

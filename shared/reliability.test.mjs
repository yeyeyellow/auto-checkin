import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { acquireRunLock } from './run-lock.mjs';
import { atomicJson, readJson, loadSession } from './io.mjs';
import { gate, day, classify, Fault } from './policy.mjs';

test('mutex excludes concurrency and releases after owner is forcibly killed, ignoring stale files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'checkin-mutex-'));
  const path = join(dir, 'run.lock');
  try {
    await writeFile(path, '');
    await writeFile(`${path}.recovery`, 'broken');
    const release = await acquireRunLock(path);
    assert.equal(await acquireRunLock(path), null);
    await release();
    const script = `import { acquireRunLock } from ${JSON.stringify(new URL('./run-lock.mjs', import.meta.url).href)}; await acquireRunLock(${JSON.stringify(path)}); console.log('READY'); setInterval(()=>{},1000);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { windowsHide: true });
    await new Promise((r, reject) => { child.stdout.once('data', r); child.once('error', reject); child.once('exit', code => reject(new Error('owner exited: ' + code))); });
    assert.equal(await acquireRunLock(path), null);
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    // helper observes EOF and releases the OS mutex; no PID or file cleanup needed.
    let recovered;
    for (let i = 0; i < 5 && !recovered; i++) recovered = await acquireRunLock(path);
    assert.equal(typeof recovered, 'function');
    await recovered();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('atomic session update keeps valid backup; damaged file recovers without exposing cookies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'checkin-session-'));
  const path = join(dir, 'state.json');
  try {
    const old = { cookies: [], origins: [] };
    const newer = { cookies: [], origins: [], revision: 2 };
    await atomicJson(path, old);
    await atomicJson(path, newer, { backup: true });
    assert.deepEqual(await readJson(`${path}.bak`), old);
    await writeFile(path, '{truncated');
    assert.deepEqual(await loadSession(path), old);
    await Promise.all(Array.from({ length: 10 }, (_, index) => atomicJson(path, { index })));
    assert.equal(Number.isInteger(JSON.parse(await readFile(path, 'utf8')).index), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('watchdog terminates only its hung owner tree and releases mutex', async () => {
  const path = join(tmpdir(), 'checkin-watchdog-' + Date.now());
  const script = `import { acquireRunLock } from ${JSON.stringify(new URL('./run-lock.mjs', import.meta.url).href)}; await acquireRunLock(${JSON.stringify(path)}, {timeoutSeconds:1}); console.log('READY'); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { windowsHide: true });
  const exited = once(child, 'exit');
  let expired = false;
  const fallback = setTimeout(() => { expired = true; child.kill(); }, 6000);
  await exited;
  clearTimeout(fallback);
  assert.equal(expired, false, 'watchdog did not enforce deadline');
  const release = await acquireRunLock(path);
  assert.equal(typeof release, 'function');
  await release();
});

test('retry policy keeps recovering, distinguishes login change, and uses Hong Kong midnight', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  assert.equal(gate({ verified: true, sessionHash: 'a' }, 'a', now), 'CONFIRMED_TODAY');
  assert.equal(gate({ attempts: 60 }, 'a', now), null);
  assert.equal(gate({ nextAt: '2026-10-08T12:10:00Z' }, 'a', now), 'WAIT_RETRY');
  assert.equal(gate({ stop: true, code: 'STRUCTURE' }, 'b', now), 'NEEDS_ATTENTION');
  assert.equal(gate({ stop: true, code: 'LOGIN_EXPIRED', sessionHash: 'a' }, 'b', now), null);
  assert.equal(day(new Date('2026-10-08T15:59:59Z')), '2026-10-08');
  assert.equal(day(new Date('2026-10-08T16:00:00Z')), '2026-10-09');
  assert.equal(classify(new Error('page.goto: net::ERR_CONNECTION_CLOSED')).retryable, true);
  assert.equal(classify(new Error('locator.waitFor: Timeout 15000ms')).retryable, true);
  assert.equal(classify(new Error('unexpected local failure')).retryable, true);
  assert.equal(classify(new Fault('STRUCTURE', 'unknown form')).retryable, false);
  assert.equal(classify(new Fault('REPLY_PENDING', 'uncertain')).retryable, false);
  assert.equal(classify(new Fault('RATE_LIMIT', 'slow down')).retryable, true);
});

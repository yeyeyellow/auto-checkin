import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson, readJson } from './io.mjs';
import { day } from './policy.mjs';
import { runCheckin, Fault } from './runtime.mjs';

const run = (root, mode, scheduled = false) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./runtime-fixture.mjs', import.meta.url)), ...(scheduled ? ['--scheduled'] : [])], { windowsHide: true, env: { ...process.env, CHECKIN_TEST_ROOT: root, CHECKIN_TEST_MODE: mode } });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  child.once('error', reject);
  child.once('exit', code => resolve({ code, output }));
});

test('ten fresh captcha rounds use nine 20-second waits, stop on success, and cache the confirmed result', async () => {
  const root = (await mkdtemp(join(tmpdir(), 'checkin-rapid-success-'))) + '/';
  try {
    await atomicJson(`${root}session/state.json`, { cookies: [], origins: [] });
    const result = await run(root, 'rapid-success', true);
    assert.equal(result.code, 0, result.output);
    assert.equal((await readFile(`${root}challenges.txt`, 'utf8')).trim().split('\n').length, 10);
    assert.equal((await readFile(`${root}browsers.txt`, 'utf8')).trim().split('\n').length, 10);
    assert.deepEqual((await readFile(`${root}waits.txt`, 'utf8')).trim().split('\n'), Array(9).fill('20000'));
    assert.equal((await readFile(`${root}submits.txt`, 'utf8')).trim().split('\n').length, 1);
    const control = await readJson(`${root}artifacts/days/${day()}.json`);
    assert.equal(control.rounds, 10);
    assert.equal(control.verified, true);
    assert.equal(control.nextAt, null);
    assert.match((await run(root, 'rapid-fail', true)).output, /CONFIRMED_TODAY/);
    assert.equal((await readFile(`${root}browsers.txt`, 'utf8')).trim().split('\n').length, 10);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ten failed rounds switch to minute backoff and a later process does not restart the fast phase', async () => {
  const root = (await mkdtemp(join(tmpdir(), 'checkin-rapid-exhausted-'))) + '/';
  const daily = `${root}artifacts/days/${day()}.json`;
  try {
    await atomicJson(`${root}session/state.json`, { cookies: [], origins: [] });
    const result = await run(root, 'rapid-fail', true);
    assert.equal(result.code, 3, result.output);
    let control = await readJson(daily);
    assert.equal(control.rounds, 10);
    assert.equal(control.stop, false);
    assert.ok(Date.parse(control.nextAt) - Date.parse(control.lastFinishedAt) >= 120000);
    assert.deepEqual((await readFile(`${root}waits.txt`, 'utf8')).trim().split('\n'), Array(9).fill('20000'));
    assert.match((await run(root, 'rapid-fail', true)).output, /WAIT_RETRY/);
    await atomicJson(daily, { ...control, nextAt: new Date(0).toISOString() });
    assert.equal((await run(root, 'rapid-fail', true)).code, 3);
    control = await readJson(daily);
    assert.equal(control.rounds, 11);
    assert.equal((await readFile(`${root}challenges.txt`, 'utf8')).trim().split('\n').length, 11);
    assert.equal((await readFile(`${root}waits.txt`, 'utf8')).trim().split('\n').length, 9);
    assert.ok(Date.parse(control.nextAt) - Date.parse(control.lastFinishedAt) >= 5 * 60000);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rate limits, pending replies, uncertain submissions, and unknown pages do not enter rapid retry', async () => {
  for (const [mode, code] of [['rate-limit', 'RATE_LIMIT'], ['reply-pending', 'REPLY_PENDING'], ['unsigned', 'SUBMIT_UNCERTAIN'], ['unknown', 'STRUCTURE']]) {
    const root = (await mkdtemp(join(tmpdir(), 'checkin-rapid-guard-'))) + '/';
    try {
      await atomicJson(`${root}session/state.json`, { cookies: [], origins: [] });
      await run(root, mode, true);
      const control = await readJson(`${root}artifacts/days/${day()}.json`);
      assert.equal(control.code, code);
      assert.equal(control.rounds, 1);
      assert.equal(await readFile(`${root}waits.txt`, 'utf8').catch(() => null), null);
      if (['RATE_LIMIT', 'REPLY_PENDING'].includes(code)) assert.ok(Date.parse(control.nextAt) - Date.parse(control.lastFinishedAt) >= 30 * 60000);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('clock drift requests attention without submitting, and recovers after clock repair', async () => {
  const root = (await mkdtemp(join(tmpdir(), 'checkin-clock-skew-'))) + '/';
  try {
    await atomicJson(`${root}session/state.json`, { cookies: [], origins: [] });
    const failure = await run(root, 'clock-skew', true);
    assert.equal(failure.code, 4, failure.output);
    const control = await readJson(`${root}artifacts/days/${day()}.json`);
    assert.equal(control.code, 'CLOCK_SKEW');
    assert.equal(control.rounds, 1);
    assert.equal(control.stop, false);
    assert.equal(control.verified, false);
    assert.ok(Date.parse(control.nextAt) - Date.parse(control.lastFinishedAt) >= 30 * 60000);
    assert.equal((await readJson(`${root}artifacts/attention.json`)).attention, true);
    assert.equal(await readFile(`${root}submits.txt`, 'utf8').catch(() => null), null);
    assert.equal(await readFile(`${root}waits.txt`, 'utf8').catch(() => null), null);
    const recovery = await run(root, 'signed');
    assert.equal(recovery.code, 0, recovery.output);
    assert.equal((await readJson(`${root}artifacts/days/${day()}.json`)).verified, true);
    assert.equal((await readJson(`${root}artifacts/attention.json`)).attention, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a post-submit redirect only retries state reads and never repeats a successful submission', async () => {
  const root = (await mkdtemp(join(tmpdir(), 'checkin-navigation-race-'))) + '/';
  try {
    await atomicJson(`${root}session/state.json`, { cookies: [], origins: [] });
    const result = await run(root, 'navigation-race', true);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /STATUS_READ_RETRY/);
    assert.equal((await readFile(`${root}submits.txt`, 'utf8')).trim().split('\n').length, 1);
    assert.equal(await readFile(`${root}waits.txt`, 'utf8').catch(() => null), null);
    const control = await readJson(`${root}artifacts/days/${day()}.json`);
    assert.equal(control.rounds, 1);
    assert.equal(control.verified, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the production timer really waits 20 seconds and stops after an earlier successful round', { timeout: 45000 }, async () => {
  const root = (await mkdtemp(join(tmpdir(), 'checkin-rapid-timer-'))) + '/';
  let submissions = 0;
  const starts = [];
  const page = { setDefaultTimeout() {}, async screenshot() {} };
  const context = { async newPage() { return page; }, pages() { return [page]; }, async storageState() { return { cookies: [], origins: [] }; } };
  try {
    await atomicJson(`${root}session/state.json`, { cookies: [], origins: [] });
    await runCheckin({ root, chrome: '',
      chromium: { async launch() { starts.push(performance.now()); return { async newContext() { return context; }, async close() {} }; } },
      load: async () => ({ state: submissions === 2 ? 'ALREADY_SIGNED' : 'NOT_SIGNED', uid: 1 }),
      submit: async () => { if (++submissions === 1) throw new Fault('CAPTCHA', '图片定位置信度不足', true); },
    });
    assert.equal(starts.length, 2);
    assert.ok(starts[1] - starts[0] >= 20000);
    assert.equal((await readJson(`${root}artifacts/days/${day()}.json`)).verified, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('offline preflight never submits or spends an attempt; captcha timeout recovers rather than stopping today', async () => {
  const root = (await mkdtemp(join(tmpdir(), 'checkin-preflight-'))) + '/';
  const daily = `${root}artifacts/days/${day()}.json`;
  try {
    await atomicJson(`${root}session/state.json`, { cookies: [], origins: [] });
    const offline = await run(root, 'offline-preflight');
    assert.equal(offline.code, 4, offline.output);
    let control = await readJson(daily);
    assert.equal(control.attempts, 0);
    assert.equal(control.stop, false);
    assert.equal(control.code, 'SITE_UNAVAILABLE');
    assert.ok(control.nextAt);
    assert.equal(await readFile(`${root}submits.txt`, 'utf8').catch(() => null), null);
    const deferred = await run(root, 'signed', true);
    assert.match(deferred.output, /WAIT_RETRY/);
    const timeout = await run(root, 'captcha-timeout');
    assert.equal(timeout.code, 4, timeout.output);
    control = await readJson(daily);
    assert.equal(control.stop, false);
    assert.equal(control.attempts, 1);
    assert.ok(control.nextAt);
    assert.equal(await readFile(`${root}submits.txt`, 'utf8').catch(() => null), null);
    await atomicJson(daily, { ...control, nextAt: new Date(0).toISOString() });
    const recovered = await run(root, 'signed', true);
    assert.equal(recovered.code, 0, recovered.output);
    assert.equal((await readJson(daily)).verified, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('network and browser crash are recoverable; scheduler respects backoff and continues after six failures; unconfirmed submit is never success', async () => {
  const root = (await mkdtemp(join(tmpdir(), 'checkin-runtime-'))) + '/';
  const daily = `${root}artifacts/days/${day()}.json`;
  try {
    await atomicJson(`${root}session/state.json`, { cookies: [], origins: [] });
    const first = await run(root, 'network');
    assert.equal(first.code, 4, first.output);
    assert.equal((await readJson(`${root}artifacts/last-result.json`)).retryable, true);
    assert.equal((await readJson(daily)).attempts, 10);
    const deferred = await run(root, 'unsigned', true);
    assert.match(deferred.output, /WAIT_RETRY/);
    assert.equal((await readJson(daily)).attempts, 10);
    const crash = await run(root, 'real-crash');
    assert.equal(crash.code, 4, crash.output);
    assert.equal((await readJson(`${root}artifacts/last-result.json`)).retryable, true);
    await run(root, 'unsigned');
    assert.equal((await readJson(`${root}artifacts/last-result.json`)).code, 'SUBMIT_UNCERTAIN');
    const recovered = await run(root, 'lost-response');
    assert.equal(recovered.code, 0, recovered.output);
    assert.equal((await readJson(`${root}artifacts/last-result.json`)).status, 'SUCCESS');
    assert.equal((await readFile(`${root}submits.txt`, 'utf8')).trim().split('\n').length, 2);
    const reconciled = await run(root, 'submit-error');
    assert.match(reconciled.output, /RECONCILE_AFTER_ERROR/);
    assert.equal(reconciled.code, 0, reconciled.output);
    assert.equal((await readJson(`${root}artifacts/last-result.json`)).status, 'SUCCESS');
    const cached = await run(root, 'unsigned', true);
    assert.match(cached.output, /CONFIRMED_TODAY/);
    await atomicJson(daily, { date: day(), attempts: 6, verified: false });
    assert.match((await run(root, 'signed', true)).output, /CONFIRMED/);
    assert.equal((await readJson(daily)).attempts, 7);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('killed run leaves durable RUNNING record and next run reconciles; structural failure stops scheduled submission', async () => {
  const root = (await mkdtemp(join(tmpdir(), 'checkin-interrupt-'))) + '/';
  try {
    await atomicJson(`${root}session/state.json`, { cookies: [], origins: [] });
    const child = spawn(process.execPath, [fileURLToPath(new URL('./runtime-fixture.mjs', import.meta.url))], { windowsHide: true, env: { ...process.env, CHECKIN_TEST_ROOT: root, CHECKIN_TEST_MODE: 'hang' } });
    await new Promise((resolve, reject) => { let output = ''; child.stdout.on('data', data => { output += data; if (output.includes('HANG_READY')) resolve(); }); child.once('error', reject); });
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill(); await exited;
    assert.equal((await readJson(`${root}artifacts/days/${day()}.json`)).status, 'RUNNING');
    const recovered = await run(root, 'signed');
    assert.match(recovered.output, /RECOVER_INTERRUPTED/);
    assert.equal(recovered.code, 0, recovered.output);
    await run(root, 'unknown');
    const stopped = await run(root, 'unsigned', true);
    assert.match(stopped.output, /NEEDS_ATTENTION/);
    assert.equal((await readJson(`${root}artifacts/last-result.json`)).code, 'STRUCTURE');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('valid JSON with damaged daily fields stops before browser or submit; missing session requires login', async () => {
  const root = (await mkdtemp(join(tmpdir(), 'checkin-corrupt-'))) + '/';
  try {
    const noSession = await run(root, 'unsigned');
    assert.equal(noSession.code, 2, noSession.output);
    await atomicJson(`${root}session/state.json`, { cookies: [], origins: [] });
    await atomicJson(`${root}artifacts/days/${day()}.json`, { attempts: 'invalid' });
    const corrupt = await run(root, 'unsigned', true);
    assert.equal(corrupt.code, 4, corrupt.output);
    assert.equal((await readJson(`${root}artifacts/last-result.json`)).code, 'CONTROL_DAMAGED');
    assert.deepEqual(await readJson(`${root}artifacts/days/${day()}.json`), { attempts: 'invalid' });
    assert.equal(await readFile(`${root}submits.txt`, 'utf8').catch(() => null), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

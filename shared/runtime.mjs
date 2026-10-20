import { mkdir, appendFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireRunLock } from './run-lock.mjs';
import { atomicJson, readJson, loadSession } from './io.mjs';
import { day, gate, retryPlan, rapidRetryRounds, rapidRetryIntervalMs, Fault, classify } from './policy.mjs';
import { checkSite } from './connectivity.mjs';

export { Fault, atomicJson, day };
export async function runCheckin(config, { wait = delay } = {}) {
  const { root } = config;
  let release;
  try { release = await acquireRunLock(`${root}run.lock`, { timeoutSeconds: 660 }); }
  catch (error) {
    const failure = { date: day(), time: new Date().toISOString(), status: 'ERROR', code: 'MUTEX_INIT', message: '运行初始化失败', detail: error.message.split('\n')[0], retryable: true };
    await atomicJson(`${root}artifacts/startup-errors/${day()}-${Date.now()}.json`, failure);
    await atomicJson(`${root}artifacts/last-startup-error.json`, failure);
    console.error(`${failure.message}：${failure.detail}；恢复任务稍后重新检查`);
    process.exitCode = 4;
    return;
  }
  if (!release) { console.log('已有签到程序运行，本次跳过'); process.exitCode = 5; return; }
  const started = performance.now();
  let continuation = false;
  try {
    while (true) {
      const outcome = await runAttempt(config, continuation);
      if (!outcome?.rapid) return;
      // Leave a minute before the eleven-minute watchdog for the final round to finish.
      if (performance.now() - started + rapidRetryIntervalMs >= 600000) {
        console.log('[RAPID_DEFERRED] 本次运行接近超时期限，剩余轮次由恢复任务继续');
        return;
      }
      await wait(rapidRetryIntervalMs);
      if (day() !== outcome.date) { console.log('[DAY_CHANGED] 已跨日，等待新日期的登录入口'); return; }
      continuation = true;
    }
  } finally { await release(); }
}

async function runAttempt({ root, chromium, chrome, siteUrl, options = async () => ({}), load, submit }, continuation = false) {
  let browser, context, result, control, controlPath, runDir, expectedUid;
  let rapid = false;
  const date = day(), id = `${date}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const statePath = `${root}session/state.json`;
  const hashState = state => createHash('sha256').update(JSON.stringify(state)).digest('hex');
  const log = async (stage, detail = '') => {
    const event = { time: new Date().toISOString(), runId: id, stage, detail };
    if (runDir) await appendFile(`${runDir}/events.jsonl`, JSON.stringify(event) + '\n');
    console.log(`[${stage}] ${detail}`);
  };
  const assertDay = () => { if (day() !== date) throw new Fault('DAY_CHANGED', '运行跨越午夜，下次按新日期重新核实', true); };
  try {
    await mkdir(`${root}artifacts`, { recursive: true });
    const state = process.argv.includes('--no-session') ? null : await loadSession(statePath);
    const hash = hashState(state);
    controlPath = `${root}artifacts/days/${date}.json`;
    const savedControl = await readJson(controlPath).catch(e => { throw new Fault('CONTROL_DAMAGED', '当日运行记录损坏，停止自动提交并保留文件'); });
    if (savedControl && (savedControl.date !== date || !Number.isInteger(savedControl.attempts) || savedControl.attempts < 0 || typeof savedControl.verified !== 'boolean' || (savedControl.rounds !== undefined && (!Number.isInteger(savedControl.rounds) || savedControl.rounds < 0)))) throw new Fault('CONTROL_DAMAGED', '当日运行记录字段异常，停止自动提交并保留文件');
    control = savedControl;
    const skip = !process.argv.includes('--force') && (process.argv.includes('--scheduled') ? gate(control, hash) : control?.stop && !(control.code === 'LOGIN_EXPIRED' && control.sessionHash !== hash) ? 'NEEDS_ATTENTION' : null);
    if (skip && !(continuation && skip === 'WAIT_RETRY')) { await log('SKIP', skip); process.exitCode = 0; return; }
    runDir = `${root}artifacts/runs/${id}`;
    await mkdir(runDir, { recursive: true });
    await log('START');
    if (control?.code === 'LOGIN_EXPIRED' && control.sessionHash !== hash) control.stop = false;
    if (control?.status === 'RUNNING') await log('RECOVER_INTERRUPTED', '上次运行未正常结束，本次先读取论坛状态');
    control = { ...control, date, firstTriggeredAt: control?.firstTriggeredAt || new Date().toISOString(), attempts: (control?.attempts || 0) + 1, rounds: (control?.rounds || 0) + 1, status: 'RUNNING', runId: id, sessionHash: hash, verified: false, stop: false, nextAt: new Date(Date.now() + 10 * 60000).toISOString() };
    await atomicJson(controlPath, control);
    await atomicJson(`${root}artifacts/last-attempt.json`, control);
    if (!state) throw new Fault('LOGIN_EXPIRED', '没有完整登录会话，请运行 npm run login');
    await log('BROWSER_START');
    browser = await chromium.launch({ executablePath: chrome, headless: true, timeout: 30000 });
    context = await browser.newContext({ ...await options(browser), storageState: state, viewport: { width: 1280, height: 900 } });
    if (siteUrl) {
      await log('SITE_ACCESS_CHECK', siteUrl);
      await checkSite(context, siteUrl);
      await log('SITE_ACCESS_OK', '已收到本站正常网页，继续核实登录与签到状态');
    }
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const read = async () => {
      await log('READ_STATUS');
      let s;
      try { s = await load(page); }
      catch (error) {
        if (!/Navigation .*is interrupted by another navigation/.test(error.message || '')) throw error;
        await log('STATUS_READ_RETRY', '论坛跳转打断状态查询，等待页面加载后只重新读取状态');
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
        s = await load(page);
      }
      if (expectedUid && s.uid && s.uid !== expectedUid) throw new Fault('LOGIN_EXPIRED', '运行中登录账号发生变化，停止操作');
      if (s.uid && !expectedUid) expectedUid = s.uid;
      await log('STATUS', s.state);
      return s;
    };
    const confirm = async () => {
      assertDay();
      const first = await read();
      if (first.state !== 'ALREADY_SIGNED') return first;
      const second = await read();
      assertDay();
      if (second.state !== 'ALREADY_SIGNED' || (first.uid && second.uid && first.uid !== second.uid)) throw new Fault('INCONSISTENT', '两次账号签到状态不一致');
      return second;
    };
    const before = await confirm();
    if (before.state === 'LOGIN_EXPIRED') throw new Fault('LOGIN_EXPIRED', '论坛确认登录过期');
    if (before.state === 'ALREADY_SIGNED') result = { status: 'ALREADY_SIGNED', message: '今日已签到', detail: '两次读取本人签到状态确认，跳过回复和提交', uid: before.uid };
    else {
      if (before.state !== 'NOT_SIGNED') throw new Fault('STRUCTURE', '无法确认本人签到状态，停止提交');
      let submitError;
      try { await submit({ page, root, runDir, log, assertDay, date, uid: before.uid }); }
      catch (e) {
        submitError = classify(e);
        if (!submitError.retryable) throw submitError;
        await log('RECONCILE_AFTER_ERROR', submitError.code);
      }
      const after = await confirm();
      if (after.state === 'LOGIN_EXPIRED') throw new Fault('LOGIN_EXPIRED', '提交后登录状态失效');
      if (after.state !== 'ALREADY_SIGNED') throw submitError || new Fault('SUBMIT_UNCERTAIN', '提交后尚未确认签到，下次先读取状态', true);
      result = { status: 'SUCCESS', message: '签到成功', detail: '提交后两次读取本人签到状态确认', uid: after.uid };
    }
    await log('CONFIRMED', result.status);
  } catch (error) {
    const failure = classify(error);
    result = { status: failure.code === 'LOGIN_EXPIRED' ? 'LOGIN_EXPIRED' : failure.code === 'CAPTCHA' ? 'VERIFICATION_FAILED' : failure.code === 'REPLY_PENDING' ? 'REPLY_FAILED' : 'ERROR', message: failure.code === 'LOGIN_EXPIRED' ? '登录过期' : failure.code === 'CAPTCHA' ? '验证失败' : '运行失败', detail: failure.message, code: failure.code, retryable: failure.retryable };
    if (runDir) await log('FAILED', `${failure.code}: ${failure.message}`).catch(() => {});
    if (context) for (const [index, page] of context.pages().entries()) await page.screenshot({ path: `${runDir}/failure-${index}.png`, fullPage: true, timeout: 5000 }).catch(() => {});
  } finally {
    try {
      if (result) {
        result = { ...result, date, runId: id, time: new Date().toISOString() };
        if (context && result.status !== 'LOGIN_EXPIRED') {
          try { await atomicJson(statePath, await context.storageState(), { backup: true }); }
          catch (e) { await log('SESSION_SAVE_FAILED', e.message.split('\n')[0]).catch(() => {}); }
        }
        if (control && controlPath) {
          const success = ['SUCCESS', 'ALREADY_SIGNED'].includes(result.status);
          const attempts = Math.max(0, control.attempts - (result.code === 'SITE_UNAVAILABLE' ? 1 : 0));
          const plan = retryPlan(result, control.rounds);
          rapid = plan.rapid;
          control = { ...control, attempts, status: result.status, code: result.code, verified: success, automaticVerified: control.automaticVerified || (success && process.argv.includes('--scheduled')), uid: result.uid, stop: !success && !result.retryable, lastFinishedAt: result.time, sessionHash: hashState(await loadSession(statePath)), nextAt: !success && result.retryable ? new Date(Date.now() + plan.delayMs).toISOString() : null };
          await atomicJson(controlPath, control);
        }
        if (runDir) await atomicJson(`${runDir}/result.json`, result);
        await atomicJson(`${root}artifacts/last-result.json`, result);
        if (['SUCCESS', 'ALREADY_SIGNED'].includes(result.status)) {
          await atomicJson(`${root}artifacts/last-success.json`, result);
          await atomicJson(`${root}artifacts/attention.json`, { ...result, attention: false });
        }
        else await atomicJson(`${root}artifacts/attention.json`, { ...result, attention: !result.retryable || result.code === 'CLOCK_SKEW', nextAt: control?.nextAt });
        if (result.retryable) await log('WAIT_RETRY', `尚未确认签到成功，下次检查时间 ${control?.nextAt}`);
        if (rapid) await log('RAPID_RETRY', `第 ${control.rounds}/${rapidRetryRounds} 轮失败，20 秒后重新读取状态并获取新验证码`);
        await log('RESULT_SAVED', result.status);
        console.log(`${result.message}：${result.detail}`);
        process.exitCode = ['SUCCESS', 'ALREADY_SIGNED'].includes(result.status) ? 0 : result.status === 'LOGIN_EXPIRED' ? 2 : result.status === 'VERIFICATION_FAILED' ? 3 : 4;
      }
    } finally { if (browser) await browser.close(); }
  }
  return { rapid, date };
}

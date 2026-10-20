// 离线故障演练入口，永不连接论坛或启动 Chrome。
import { runCheckin, Fault } from './runtime.mjs';
import { appendFile } from 'node:fs/promises';
const root = process.env.CHECKIN_TEST_ROOT;
if (!root) throw new Error('CHECKIN_TEST_ROOT required');
const mode = process.env.CHECKIN_TEST_MODE;
let reads = 0;
let submits = 0;
const page = { setDefaultTimeout() {}, async screenshot() {}, async waitForLoadState() {} };
const context = { request: { async get() { throw new Error('ECONNREFUSED'); } }, async newPage() { return page; }, pages() { return [page]; }, async storageState() { return { cookies: [], origins: [] }; } };
const browser = { async newContext() { return context; }, async close() {} };
const chromium = mode === 'real-crash' ? (await import('../forum-checkin-lab/node_modules/playwright/index.mjs')).chromium : { async launch() { await appendFile(`${root}browsers.txt`, 'browser\n'); return browser; } };
await runCheckin({ root, chromium, siteUrl: mode === 'offline-preflight' ? 'https://offline.invalid/' : undefined, chrome: mode === 'real-crash' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '',
  load: async actualPage => {
    if (mode === 'clock-skew') throw new Fault('CLOCK_SKEW', '电脑时间慢了 8 小时，未提交验证码', true);
    if (mode === 'real-crash') { await actualPage.context().browser().close(); return actualPage.goto('about:blank'); }
    if (mode === 'network') throw new Error('page.goto: net::ERR_CONNECTION_CLOSED');
    if (mode === 'crash') throw new Error('Target page, context or browser has been closed');
    if (mode === 'hang') { console.log('HANG_READY'); await new Promise(() => {}); }
    if (mode === 'unknown') return { state: 'UNKNOWN' };
    if (mode === 'navigation-race') {
      const read = reads++;
      if (read === 1) throw new Error('page.goto: Navigation to "https://forum.invalid/sign" is interrupted by another navigation to "https://forum.invalid/sign&"');
      return { state: read === 0 ? 'NOT_SIGNED' : 'ALREADY_SIGNED', uid: 1 };
    }
    if (['unsigned', 'captcha-timeout', 'rapid-fail', 'rate-limit', 'reply-pending'].includes(mode)) return { state: 'NOT_SIGNED', uid: 1 };
    if (mode === 'rapid-success') return { state: submits >= 10 ? 'ALREADY_SIGNED' : 'NOT_SIGNED', uid: 1 };
    return { state: reads++ === 0 && ['lost-response', 'submit-error'].includes(mode) ? 'NOT_SIGNED' : 'ALREADY_SIGNED', uid: 1 };
  },
  submit: async () => {
    if (mode === 'captcha-timeout') throw new Error('locator.waitFor: Timeout 15000ms exceeded.');
    if (mode === 'rate-limit') throw new Fault('RATE_LIMIT', '网站限流');
    if (mode === 'reply-pending') throw new Fault('REPLY_PENDING', '回复待查证', true);
    if (['rapid-fail', 'rapid-success'].includes(mode)) {
      submits++;
      await appendFile(`${root}challenges.txt`, 'new-challenge\n');
      if (mode === 'rapid-fail' || submits < 10) throw new Fault('CAPTCHA', '图片定位置信度不足', true);
    }
    await appendFile(`${root}submits.txt`, 'submit\n');
    if (mode === 'submit-error') throw new Fault('CAPTCHA', '验证码响应不明确', true);
  },
}, { wait: ms => appendFile(`${root}waits.txt`, `${ms}\n`) });

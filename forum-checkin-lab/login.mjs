import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { atomicJson } from '../shared/io.mjs';
import { acquireRunLock } from '../shared/run-lock.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
const release = await acquireRunLock(`${root}run.lock`, { timeoutSeconds: 660 });
if (!release) throw new Error('签到正在运行，请稍后重新登录');
await mkdir(`${root}session`, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: false });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto('https://laowangrsc278.vip/member.php?mod=logging&action=login', { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log('请在独立 Chrome 窗口登录。最长等待 10 分钟，登录成功后自动保存会话并关闭。');
  await page.waitForFunction(() => Number(window.discuz_uid) > 0 && !!document.querySelector('a[href*="action=logout"]'), null, { timeout: 600000 });
  await atomicJson(`${root}session/state.json`, await context.storageState(), { backup: true });
  console.log('登录会话已保存。');
} catch (error) {
  console.error('未保存登录会话：' + error.message.split('\n')[0]);
  process.exitCode = 2;
} finally { try { await browser.close(); } finally { await release(); } }

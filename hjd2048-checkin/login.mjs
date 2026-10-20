import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { atomicJson } from '../shared/io.mjs';
import { acquireRunLock } from '../shared/run-lock.mjs';
import { fileURLToPath } from 'node:url';
import { dismissNotice } from './browser.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
const release = await acquireRunLock(`${root}run.lock`, { timeoutSeconds: 660 });
if (!release) throw new Error('签到正在运行，请稍后重新登录');
await mkdir(`${root}session`, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: false });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto('https://hjd2048.com/2048/login.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismissNotice(page);
  await page.bringToFront();
  console.log('请在独立 Chrome 窗口登录，最长等待十分钟。');
  await page.waitForFunction(() => Number(window.winduid) > 0 && [...document.querySelectorAll('a')].some(e => /退出/.test(e.innerText) && /login\.php/.test(e.getAttribute('href') || '')), null, { timeout: 600000 });
  await atomicJson(`${root}session/state.json`, await context.storageState(), { backup: true });
  await atomicJson(`${root}session/browser.json`, { userAgent: await page.evaluate(() => navigator.userAgent) }, { backup: true });
  console.log('登录会话已保存，窗口自动关闭。');
} catch (e) { console.error('登录未完成：' + e.message.split('\n')[0]); process.exitCode = 2; }
finally { try { await browser.close(); } finally { await release(); } }

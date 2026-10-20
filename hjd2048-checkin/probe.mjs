import { chromium } from 'playwright';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { contextOptions, readStatus } from './browser.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
await mkdir(`${root}artifacts`, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
try {
  const state = `${root}session/state.json`;
  const hasState = await access(state).then(() => true, () => false);
  const page = await browser.newPage(await contextOptions(browser, root, hasState));
  const r = await page.goto(process.argv[2] || 'https://hjd2048.com/2048/thread.php?fid=57', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  const data = await page.evaluate(() => ({ title: document.title, url: location.href, links: [...document.querySelectorAll('a')].map(e => ({text: e.innerText.trim(), href: e.getAttribute('href'), onclick: e.getAttribute('onclick')})).filter(e => /签到|簽到|登录|登入|登陆|退出|打卡|任务|任務/.test(e.text)), scripts: [...document.scripts].map(e => e.src).filter(Boolean), forms: [...document.forms].map(e => ({id: e.id, action: e.getAttribute('action'), inputs: [...e.querySelectorAll('input')].map(i=>({name:i.name,type:i.type}))})) }));
  await writeFile(`${root}artifacts/page.html`, await page.content());
  console.log(JSON.stringify({status:r?.status(), signState: await readStatus(page), uidPresent: await page.evaluate(() => Number(window.winduid) > 0), ...data}, null, 2));
} finally { await browser.close(); }

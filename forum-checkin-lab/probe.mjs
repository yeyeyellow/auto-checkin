import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
await mkdir(`${root}artifacts`, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  const resources = [];
  page.on('response', r => { if (/javascript|image/.test(r.headers()['content-type'] || '')) resources.push(r.url().split('?')[0]); });
  const response = await page.goto('https://laowangrsc278.vip/forum.php', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);
  const data = { status: response?.status(), title: await page.title(), url: page.url(), text: await page.locator('body').innerText(), links: await page.locator('a').evaluateAll(es => es.map(e => ({ text: e.innerText, href: e.getAttribute('href') })).filter(e => /签到|登录/.test(e.text))), resources };
  await writeFile(`${root}artifacts/probe.json`, JSON.stringify(data, null, 2));
  await page.screenshot({ path: `${root}artifacts/probe.png`, fullPage: true });
  console.log(JSON.stringify(data, null, 2));
} finally { await browser.close(); }

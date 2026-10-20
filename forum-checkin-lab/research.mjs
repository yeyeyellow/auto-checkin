import { chromium } from 'playwright';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
await mkdir(`${root}artifacts`, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
try {
  const state = `${root}session/state.json`;
  const authenticated = await access(state).then(() => true, () => false);
  const page = await browser.newPage(authenticated ? { storageState: state } : {});
  await page.goto('https://laowangrsc278.vip/sign.php', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const data = { url: page.url(), text: await page.locator('body').innerText(), forms: await page.locator('form').evaluateAll(es => es.map(e => ({ action: e.getAttribute('action'), html: e.outerHTML }))) };
  const name = authenticated ? 'sign-session' : 'sign-public';
  await writeFile(`${root}artifacts/${name}.json`, JSON.stringify(data, null, 2));
  await writeFile(`${root}artifacts/${name}.html`, await page.content());
  for (const name of ['tn_code.js', 'dz_fp.js']) {
    const r = await page.request.get(`https://laowangrsc278.vip/captcha/${name}`);
    await writeFile(`${root}artifacts/${name}`, await r.text());
  }
  console.log(JSON.stringify({ url: data.url, authenticated, panel: await page.locator('.qdleft').innerHTML(), uidPresent: await page.evaluate(() => Number(window.discuz_uid) > 0), logoutPresent: await page.locator('a[href*="action=logout"]').count() }, null, 2));
} finally { await browser.close(); }

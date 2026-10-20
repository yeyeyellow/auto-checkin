import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chrome, origin, dismissNotices, readStatus } from './browser.mjs';
import { estimateSlider } from './slider.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
const browser = await chromium.launch({ executablePath: chrome, headless: true });
try {
  const page = await browser.newPage({ storageState: `${root}session/state.json` });
  await page.goto(`${origin}/sign.php`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('状态', await readStatus(page));
  await dismissNotices(page);
  if (await page.locator('.qdleft a.btn').count()) {
    await page.locator('.qdleft a.btn').click();
    await page.waitForTimeout(2500);
  }
  await writeFile(`${root}artifacts/sign-dialog.html`, await page.content());
  console.log(JSON.stringify(await page.locator('.tncode,form[id*="sign"],div[id^="fwin"],button[type="submit"]').evaluateAll(es => es.map(e => ({ tag: e.tagName, id: e.id, action: e.getAttribute('action'), text: e.innerText, visible: !!e.getClientRects().length }))), null, 2));
  if (await page.locator('.tncode').count()) {
    await page.locator('.tncode').click();
    await page.waitForFunction(() => window.tncode?._img_loaded);
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = tncode._img.naturalWidth; canvas.height = tncode._img.naturalHeight;
      canvas.getContext('2d').drawImage(tncode._img, 0, 0);
      return canvas.toDataURL().split(',')[1];
    });
    await writeFile(`${root}artifacts/sign-challenge.png`, Buffer.from(png, 'base64'));
    console.log('定位', await estimateSlider(page).catch(e => ({ error: e.message })));
  }
} finally { await browser.close(); }

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dismissNotices } from './browser.mjs';
import { estimateSlider } from './slider.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
await mkdir(`${root}artifacts`, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('https://laowangrsc278.vip/member.php?mod=logging&action=login', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const css = await page.request.get('https://laowangrsc278.vip/source/plugin/k_misign/static/default/sign.css?v=1');
  await writeFile(`${root}artifacts/sign.css`, await css.text());
  await dismissNotices(page);
  await page.locator('.tncode').first().click();
  await page.waitForFunction(() => window.tncode?._img_loaded === true);
  console.log('图片定位实验（不提交验证）：', await estimateSlider(page).catch(e => ({ error: e.message })));
  await page.locator('#tncode_box').screenshot({ path: `${root}artifacts/captcha-before.png` });
  const b = await page.locator('#tncode_box .slide_block').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2, { steps: 10 });
  await page.locator('#tncode_box').screenshot({ path: `${root}artifacts/captcha-during.png` });
  console.log(JSON.stringify(await page.evaluate(() => ({ width: tncode._img_w, height: tncode._img_h, pieceWidth: tncode._mark_w, imageWidth: tncode._img.naturalWidth, imageHeight: tncode._img.naturalHeight, backgroundChanged: tncode._is_draw_bg, offset: tncode._mark_offset })), null, 2));
  // 关闭浏览器时仍按住滑块，不触发 mouseup，不向服务端提交验证码。
} finally { await browser.close(); }

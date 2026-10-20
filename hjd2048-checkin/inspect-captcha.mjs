import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chrome, signUrl, contextOptions, dismissNotice, readStatus } from './browser.mjs';
import { locateSlider } from './captcha.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
await mkdir(`${root}artifacts`, { recursive: true });
const browser = await chromium.launch({ executablePath: chrome, headless: true });
try {
  const page = await browser.newPage(await contextOptions(browser, root));
  page.on('dialog', d => { console.log('页面提示：' + d.message()); d.dismiss(); });
  await page.goto(signUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const status = await readStatus(page);
  console.log('签到状态', status);
  if (status.state !== 'NOT_SIGNED') process.exitCode = 0;
  else {
    await dismissNotice(page);
    await page.locator('form[name="form2"] input[name="qdxq"][value="kx"]').check();
    await page.locator('#submit_bbb').click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${root}artifacts/captcha.png`, fullPage: true });
    const captchaFrame = page.frames().find(f => /captcha\.gtimg\.com/.test(f.url()));
    if (captchaFrame) console.log('定位结果（尚未拖动）', await locateSlider(page, captchaFrame,root).catch(e=>({error:e.message})));
    for (const [i, frame] of page.frames().entries()) {
      await writeFile(`${root}artifacts/captcha-frame-${i}.html`, await frame.content());
      if (i > 0) console.log(JSON.stringify({ frame: i, host: new URL(frame.url()).host, controls: await frame.locator('.tc-bg-img,.tc-fg-item,.tc-bg-placeholder').evaluateAll(es=>es.map(e=>({tag:e.tagName,id:e.id,class:e.className,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,left:e.getBoundingClientRect().left,top:e.getBoundingClientRect().top,style:e.getAttribute('style')?.replace(/url\([^)]+\)/g,'url([resource])')}))) },null,2));
    }
  }
} finally { await browser.close(); }

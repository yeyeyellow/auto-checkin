import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chrome } from './browser.mjs';
import { locateSlider } from './captcha.mjs';

test('bright image separates outline using agreeing thresholds; repeated targets fail closed', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://captcha.qcloud.com/**', r => r.abort());
    const setup = async duplicate => {
      const images = await page.evaluate(duplicate => {
        const make = (w,h) => { const c = document.createElement('canvas'); c.width=w; c.height=h; return c; };
        const piece = make(100,100), p = piece.getContext('2d');
        p.fillStyle = 'rgb(212,212,212)'; p.fillRect(0,0,100,100);
        p.fillStyle = 'white'; p.fillRect(10,10,78,78);
        p.fillStyle = 'rgb(212,212,212)'; p.fillRect(12,12,74,74);
        const bg = make(360,160), b = bg.getContext('2d');
        b.fillStyle = 'rgb(90,90,90)'; b.fillRect(0,0,360,160);
        for (const left of duplicate ? [120,230] : [200]) {
          b.fillStyle = 'white'; b.fillRect(left+10,30,78,78);
          b.fillStyle = 'rgb(90,90,90)'; b.fillRect(left+12,32,74,74);
        }
        return [bg.toDataURL(),piece.toDataURL()];
      }, duplicate);
      await page.setContent('<div id="slideBg" style="width:360px;height:160px;background-image:url(https://captcha.qcloud.com/bg)"></div><div class="tc-fg-item" style="width:100px;height:100px;left:5px;top:20px;background-image:url(https://captcha.qcloud.com/piece);background-size:100px 100px;background-position:0px 0px;cursor:pointer"></div>');
      return { request: { get: async url => ({ ok: () => true, headers: () => ({ 'content-type': 'image/png' }), body: async () => Buffer.from(images[url.endsWith('/bg') ? 0 : 1].split(',')[1], 'base64') }) } };
    };
    const estimate = await locateSlider(await setup(false), page);
    assert.ok(Math.abs(estimate.left - 200) <= 1, JSON.stringify(estimate));
    assert.ok(estimate.threshold > 170);
    await assert.rejects(locateSlider(await setup(true), page), /置信度不足/);
  } finally { await browser.close(); }
});

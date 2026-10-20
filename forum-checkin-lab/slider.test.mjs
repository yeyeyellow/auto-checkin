import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chrome } from './browser.mjs';
import { estimateSlider } from './slider.mjs';

test('排除彩色描边后定位拼图；重复背景和未知尺寸必须停止', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    const setup = async uniform => page.evaluate(async uniform => {
      const canvas = document.createElement('canvas');
      canvas.width = 240; canvas.height = 450;
      const ctx = canvas.getContext('2d');
      const pixels = ctx.createImageData(240, 450);
      let seed = 12345;
      for (let y = 0; y < 150; y++) for (let x = 0; x < 240; x++) {
        for (let c = 0; c < 3; c++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          pixels.data[((y + 300) * 240 + x) * 4 + c] = uniform ? 180 : 90 + seed % 150;
        }
        pixels.data[((y + 300) * 240 + x) * 4 + 3] = 255;
      }
      for (let y = 40; y < 95; y++) for (let x = 8; x < 43; x++) {
        const i = ((y + 150) * 240 + x) * 4;
        const j = ((y + 300) * 240 + x + 121) * 4;
        const border = x < 11 || x > 39 || y < 43 || y > 91;
        for (let c = 0; c < 3; c++) pixels.data[i + c] = border ? [0, 255, 0][c] : pixels.data[j + c];
        pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      const img = new Image();
      img.src = canvas.toDataURL();
      await img.decode();
      window.tncode = { _img: img, _img_loaded: true, _img_w: 240, _img_h: 150, _mark_w: 50 };
    }, uniform);
    await setup(false);
    assert.equal((await estimateSlider(page)).offset, 121);
    await setup(true);
    await assert.rejects(estimateSlider(page), /置信度不足/);
    await page.evaluate(() => { tncode._img_w = 320; });
    await assert.rejects(estimateSlider(page), /组件已变化/);
  } finally { await browser.close(); }
});

// 从已加载图片比较拼图与完整背景，只通过页面鼠标事件提交一次验证。
export async function estimateSlider(page) {
  await page.waitForFunction(() => window.tncode?._img_loaded === true, null, { timeout: 15000 });
  const estimate = await page.evaluate(() => {
    const t = window.tncode;
    if (t._img_w !== 240 || t._img_h !== 150 || t._mark_w !== 50 || t._img.naturalHeight !== 450) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 240; canvas.height = 450;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(t._img, 0, 0);
    const data = ctx.getImageData(0, 0, 240, 450).data;
    const points = [];
    // 拼图边缘含绿色描边，与原图颜色不同；仅比较向内收缩后的区域。
    const mask = (x, y) => {
      const i = ((150 + y) * 240 + x) * 4;
      return data[i] + data[i + 1] + data[i + 2] >= 200;
    };
    for (let y = 3; y < 147; y++) for (let x = 5; x < 45; x++) {
      const i = ((150 + y) * 240 + x) * 4;
      let interior = true;
      for (let dy = -3; dy <= 3 && interior; dy++) for (let dx = -3; dx <= 3; dx++) {
        if (!mask(x + dx, y + dy)) { interior = false; break; }
      }
      if (interior) points.push({ x, y, i });
    }
    if (points.length < 100) return null;
    const scores = [];
    for (let offset = 5; offset <= 190; offset++) {
      let error = 0;
      for (const { x, y, i } of points) {
        const j = ((300 + y) * 240 + x + offset) * 4;
        for (let c = 0; c < 3; c++) error += (data[i + c] - data[j + c]) ** 2;
      }
      scores.push({ offset, error: error / points.length / 3 });
    }
    scores.sort((a, b) => a.error - b.error);
    const best = scores[0];
    const alternative = scores.find(s => Math.abs(s.offset - best.offset) >= 5);
    if (!alternative || best.error > 2000 || best.error >= alternative.error * 0.8) return null;
    return { offset: best.offset, error: best.error, points: points.length };
  });
  if (!estimate) throw new Error('图片定位置信度不足或验证码组件已变化，未提交验证');
  return estimate;
}
export async function solveSlider(page) {
  const estimate = await estimateSlider(page);
  const box = await page.locator('#tncode_box .slide_block').boundingBox();
  if (!box) throw new Error('未找到可见滑块');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 55; step++) {
    const p = step / 55;
    const progress = p < 0.85 ? (estimate.offset + 2) * (1 - (1 - p / 0.85) ** 2) : estimate.offset + 2 * (1 - (p - 0.85) / 0.15);
    await page.mouse.move(x + progress, y + 2 * Math.sin(p * Math.PI * 2) + (p < 1 ? Math.random() - 0.5 : 0));
    await page.waitForTimeout(18 + Math.floor(Math.random() * 25));
  }
  await page.mouse.up();
  await page.waitForFunction(() => window.tncode && !tncode._doing, null, { timeout: 15000 });
  if (!await page.evaluate(() => tncode._result === true)) {
    const reason = await page.locator('#tncode_box .tncode_msg_error').innerText();
    throw new Error('服务端未通过滑块验证：' + reason);
  }
  return estimate;
}

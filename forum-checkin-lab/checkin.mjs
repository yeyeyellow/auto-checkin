import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { chrome, origin, dismissNotices, readStatus } from './browser.mjs';
import { solveSlider } from './slider.mjs';
import { runCheckin, Fault } from '../shared/runtime.mjs';
import { assertServerClock } from './clock.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
await runCheckin({ root, chromium, chrome, siteUrl: `${origin}/`,
  load: async page => {
    const startedAt = Date.now();
    const response = await page.goto(`${origin}/sign.php`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (response?.status() === 429) throw new Fault('RATE_LIMIT', '网站限流，等待 30 分钟后补试');
    if (response?.status() >= 500) throw new Fault('SERVER', '签到服务暂不可用', true);
    if (!response?.ok() || new URL(page.url()).origin !== origin) throw new Fault('STRUCTURE', '签到页地址或响应异常');
    const status = await readStatus(page);
    if (status.state === 'NOT_SIGNED') assertServerClock(response, startedAt);
    return status;
  },
  submit: async ({ page, log, assertDay }) => {
    await dismissNotices(page);
    await page.locator('.qdleft a.btn').click();
    const captcha = page.locator('.tncode:visible');
    await captcha.first().waitFor({ state: 'visible' });
    if (await captcha.count() !== 1) throw new Fault('STRUCTURE', '未找到唯一签到验证码入口');
    const form = captcha.locator('xpath=ancestor::form[1]');
    if (await form.count() !== 1) throw new Fault('STRUCTURE', '未确认验证码所属签到表单');
    const target = new URL(await form.getAttribute('action') || page.url(), page.url());
    if (target.origin !== origin || target.pathname !== '/plugin.php' || target.searchParams.get('id') !== 'k_misign:sign' || target.searchParams.get('operation') !== 'qiandao') throw new Fault('STRUCTURE', '签到表单地址无法确认');
    assertDay();
    await log('CAPTCHA_OPEN');
    await captcha.click();
    const estimate = await solveSlider(page);
    await log('CAPTCHA_PASSED', `偏移 ${estimate.offset}`);
    await page.waitForFunction(() => document.querySelector('#tncode_box')?.style.display === 'none', null, { timeout: 5000 });
    const submit = form.getByRole('button', { name: /^\s*提交\s*$/ }).and(page.locator(':visible'));
    if (await submit.count() !== 1) throw new Fault('STRUCTURE', '未找到唯一外层提交按钮');
    assertDay();
    await log('SIGN_SUBMIT_INTENT');
    try {
      const [response] = await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && r.url() === target.href), submit.click()]);
      await response.finished();
      if (response.status() === 429) throw new Fault('RATE_LIMIT', '签到提交被限流');
      if (response.status() >= 400) throw new Fault('SUBMIT_UNCERTAIN', `签到提交 HTTP ${response.status()}`, true);
      await log('SIGN_RESPONSE', String(response.status()));
    } catch (e) {
      if (e.code === 'RATE_LIMIT') throw e;
      await log('SIGN_RESPONSE_UNCERTAIN', '响应未确认，转入论坛状态查证');
    }
  },
});

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { chrome, signUrl, origin, contextOptions, dismissNotice, readStatus } from './browser.mjs';
import { ensureReply } from './reply.mjs';
import { solveCaptcha } from './captcha.mjs';
import { runCheckin, Fault } from '../shared/runtime.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const load = async page => {
  const response = await page.goto(signUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (response?.status() === 429) throw new Fault('RATE_LIMIT', '网站限流，等待 30 分钟后补试');
  if (response?.status() >= 500) throw new Fault('SERVER', '签到服务暂不可用', true);
  if (!response?.ok() || new URL(page.url()).origin !== origin) throw new Fault('STRUCTURE', '签到页地址或响应异常');
  return readStatus(page);
};
await runCheckin({ root, chromium, chrome, load, siteUrl: `${origin}/2048/`,
  options: browser => contextOptions(browser, root, false),
  submit: async ({ page, root, runDir, log, assertDay, uid }) => {
    let blocked;
    page.on('dialog', async d => {
      if (/频繁|上限|禁止/.test(d.message())) blocked = new Fault('RATE_LIMIT', '网站明确拒绝或限制操作，等待 30 分钟后检查');
      await log('SITE_DIALOG', blocked ? '网站拒绝或限制操作' : '网站返回提示');
      await d.dismiss();
    });
    const hideMedia = r => ['image', 'media'].includes(r.request().resourceType()) ? r.abort() : r.continue();
    await log('REPLY_CHECK');
    await page.route('**/*', hideMedia);
    try { await ensureReply(page, root, { log, assertDay, runDir, expectedUid: uid }); }
    finally { await page.unroute('**/*', hideMedia); }
    if (blocked) throw blocked;
    const current = await load(page);
    if (current.state === 'ALREADY_SIGNED') return;
    if (current.state === 'LOGIN_EXPIRED') throw new Fault('LOGIN_EXPIRED', '回复后论坛登录过期');
    if (current.state !== 'NOT_SIGNED') throw new Fault('STRUCTURE', '回复后无法确认签到状态');
    await dismissNotice(page);
    await page.locator('form[name="form2"] input[name="qdxq"][value="kx"]').check();
    assertDay();
    await log('SIGN_SUBMIT_INTENT');
    const submitted = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).origin === origin && new URL(r.url()).pathname === '/2048/hack.php' && new URL(r.url()).searchParams.get('H_name') === 'qiandao', { timeout: 45000 }).catch(() => null);
    await page.locator('#submit_bbb').click();
    const iframe = page.locator('#tcaptcha_iframe_dy');
    const first = await Promise.race([submitted.then(response => ({ response })), iframe.waitFor({ state: 'visible', timeout: 15000 }).then(() => ({ challenge: true })).catch(() => ({ challenge: false }))]);
    if (first.challenge) {
      assertDay();
      await log('CAPTCHA_OPEN');
      try { await solveCaptcha(page, root, { artifactDir: `${runDir}/` }); }
      catch (error) { if (blocked) throw blocked; throw error; }
      await log('CAPTCHA_RELEASED');
    }
    const response = first.response || await submitted;
    if (blocked) throw blocked;
    if (response?.status() === 429) throw new Fault('RATE_LIMIT', '签到提交被限流');
    await log(response ? 'SIGN_RESPONSE' : 'SIGN_RESPONSE_UNCERTAIN', response ? String(response.status()) : '转入论坛状态查证');
  },
});

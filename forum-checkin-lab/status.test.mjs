import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chrome, readStatus } from './browser.mjs';

test('只有本人登录和专用签到状态共同成立时才确认已签到', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    const cases = [
      { uid: 0, html: '<div class="qdleft"><a class="btn" href="member.php?action=login"></a></div>', state: 'LOGIN_EXPIRED' },
      { uid: 1, html: '<a href="member.php?action=logout">退出</a><div class="qdleft"><span class="btn btnvisted"></span></div>', state: 'ALREADY_SIGNED' },
      { uid: 0, html: '<div class="qdleft"><span class="btn btnvisted"></span></div>', state: 'UNKNOWN' },
      { uid: 1, html: '<a href="member.php?action=logout">退出</a><div class="qdleft"><a class="btn" href="plugin.php?id=k_misign:sign">签到</a></div><p>别人今日已签到，验证码验证成功</p>', state: 'NOT_SIGNED' },
      { uid: 1, html: '<a href="member.php?action=logout">退出</a><p>签到成功</p>', state: 'UNKNOWN' },
      { uid: 1, html: '<a href="member.php?action=logout">退出</a><div class="qdleft"><span class="btnvisted"></span><a class="btn" href="sign.php">签到</a></div>', state: 'UNKNOWN' },
    ];
    for (const c of cases) {
      await page.setContent(c.html);
      await page.evaluate(uid => { window.discuz_uid = uid; }, c.uid);
      assert.equal((await readStatus(page)).state, c.state);
    }
  } finally { await browser.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chrome, origin } from './browser.mjs';
import { ensureReply, replyText, today, ownReply } from './reply.mjs';

test('newest ordinary thread may be from a previous day; reply is posted once and confirmed today', async () => {
  const root = (await mkdtemp(join(tmpdir(), 'checkin-latest-'))) + '/';
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  let posts = 0;
  try {
    const page = await browser.newPage();
    await page.route(`${origin}/**`, async route => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'POST') {
        posts++;
        assert.match(route.request().postData(), /tid=456/);
        await route.fulfill({ contentType: 'text/html', body: 'ok' });
        return;
      }
      const account = '<script>window.winduid=123; function orderThreads(){ location.href="thread.php?fid=57&order=postdate"; }</script>';
      const list = '<table><tr><td><a id="a_ajax_999">置顶</a></td></tr><tr class="tr2"><td>普通主题</td></tr><tr><td><a id="a_ajax_456">最新普通帖</a></td></tr><tr><td><a id="a_ajax_455">旧帖</a></td></tr></table>';
      const form = '<form name="FORM" action="post.php" method="POST"><input name="fid" value="57"><input name="action" value="reply"><input name="tid" value="456"><textarea name="atc_content"></textarea><input type="submit" name="Submit" value="发表"></form>';
      const oldDate = '<div id="td_tpc"><div class="tiptop"><span title="2000-01-01 12:00"></span></div></div>';
      const reply = posts ? `<table><tr><td><span class="user-infoWrap2"><span class="f12">123</span></span></td><td><div class="tiptop"><span title="${today()} 12:00"></span></div><div id="read_9">${replyText}</div></td></tr></table>` : '';
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: account + (url.pathname.endsWith('thread.php') ? list : oldDate + form + reply) });
    });
    await page.goto(`${origin}/2048/hack.php?H_name=qiandao`);
    await ensureReply(page, root, { expectedUid: 123 });
    assert.equal(posts, 1);
    for (let round = 2; round <= 10; round++) {
      await ensureReply(page, root, { expectedUid: 123 });
      assert.equal(posts, 1);
    }
    assert.equal((await readJson(`${root}session/reply-123-${today()}.json`)).status, 'CONFIRMED');
  } finally { await browser.close(); await rm(root, { recursive: true, force: true }); }
});
import { atomicJson, readJson } from '../shared/io.mjs';

test('pending response is recovered across pages with no POST; missing reply retains pending and blocks repost', async () => {
  const root = (await mkdtemp(join(tmpdir(), 'checkin-reply-'))) + '/';
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  let posts = 0, found = true;
  try {
    const page = await browser.newPage();
    const record = { uid: 123, date: today(), tid: '456', text: replyText, status: 'PENDING' };
    const path = `${root}session/reply-123-${today()}.json`;
    await atomicJson(path, record);
    await page.route(`${origin}/**`, async route => {
      if (route.request().method() === 'POST') { posts++; await route.abort(); return; }
      const second = new URL(route.request().url()).searchParams.get('page') === '2';
      const reply = second && found ? `<table><tr><td><span class="user-infoWrap2"><span class="f12">123</span></span></td><td><div class="tiptop"><span title="${today()} 12:00"></span></div><div id="read_9">${replyText}</div></td></tr></table>` : '';
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<script>window.winduid=123</script>${reply}<a href="read.php?tid=456&ordertype=desc&page=2">2</a>` });
    });
    await page.goto(`${origin}/2048/read.php?tid=456&ordertype=desc`);
    assert.match(await page.locator('a').getAttribute('href'), /page=2/);
    await page.goto(`${origin}/2048/read.php?tid=456&ordertype=desc&page=2`);
    assert.equal(await ownReply(page, 123, replyText), true, await page.content());
    await page.goto(`${origin}/2048/read.php?tid=456&ordertype=desc`);
    await ensureReply(page, root);
    assert.equal((await readJson(path)).status, 'CONFIRMED');
    assert.equal(posts, 0);
    found = false;
    await ensureReply(page, root);
    assert.equal((await readJson(path)).status, 'CONFIRMED');
    assert.equal(posts, 0);
    await atomicJson(path, record);
    await assert.rejects(ensureReply(page, root), e => e.code === 'REPLY_PENDING' && e.retryable);
    assert.equal((await readJson(path)).status, 'PENDING');
    assert.equal(posts, 0);
  } finally { await browser.close(); await rm(root, { recursive: true, force: true }); }
});

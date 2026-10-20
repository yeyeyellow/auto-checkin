import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chrome, readStatus } from './browser.mjs';
import { ownReply, replyText, today } from './reply.mjs';

test('本人签到状态与本人回复需要独立证据，榜单及引用不能作为成功', async()=>{
  const browser=await chromium.launch({executablePath:chrome,headless:true});
  try {
    const page=await browser.newPage();
    const logout='<a href="login.php?action=quit">退出</a>';
    const panel=state=>`<table><tr><td class="h">签到服务台</td></tr><tr><td>您累计已签到：192天【${state}】</td></tr></table>`;
    await page.setContent(logout+panel('今天未签到')+'<form name="form2"><input name="qdxq"></form><p>他人今天已签到</p>');
    await page.evaluate(()=>{window.winduid=123;});
    assert.equal((await readStatus(page)).state,'NOT_SIGNED');
    await page.setContent(logout+panel('今天已签到'));
    assert.equal((await readStatus(page)).state,'ALREADY_SIGNED');
    await page.setContent(logout+'<p>今天已签到</p>');
    assert.equal((await readStatus(page)).state,'UNKNOWN');
    await page.setContent('<a href="login.php">登录</a>');
    await page.evaluate(()=>{window.winduid='';});
    assert.equal((await readStatus(page)).state,'LOGIN_EXPIRED');
    const reply=(uid,date,body,id='read_1')=>`<table><tr><td><span class="user-infoWrap2">UID: <span class="f12">${uid}</span></span></td><td><div class="tiptop"><span title="${date} 03:05">发表于</span></div><div id="${id}"><div>仅楼主可见</div>${body}</div></td></tr></table>`;
    await page.setContent(reply(123,today(),replyText));
    assert.equal(await ownReply(page,123,replyText),true);
    await page.setContent(reply(456,today(),replyText));
    assert.equal(await ownReply(page,123,replyText),false);
    await page.setContent(reply(123,'2000-01-01',replyText));
    assert.equal(await ownReply(page,123,replyText),false);
    await page.setContent(reply(123,today(),`<blockquote>${replyText}</blockquote>`));
    assert.equal(await ownReply(page,123,replyText),false);
    await page.setContent(reply(123,today(),replyText,'read_tpc'));
    assert.equal(await ownReply(page,123,replyText),false);
  } finally {await browser.close();}
});

import { writeFile } from 'node:fs/promises';
import { atomicJson, readJson } from '../shared/io.mjs';
import { Fault } from '../shared/policy.mjs';
import { origin, forumUrl, dismissNotice } from './browser.mjs';
export const replyText = '感谢分享楼主好人';
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export async function ownReply(page, uid, text, date = today()) {
  return page.evaluate(({ uid, text, expectedDate }) => [...document.querySelectorAll('div[id^="read_"]')].some(e => {
    if (e.id === 'read_tpc' || ![...e.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim() === text)) return false;
    const row = e.closest('tr');
    const user = row?.querySelector('.user-infoWrap2 .f12');
    const date = row?.querySelector('.tiptop span[title]')?.getAttribute('title');
    return Number(user?.textContent) === uid && date?.startsWith(expectedDate);
  }), { uid, text, expectedDate: date });
}
export async function verifyRecordedReply(page, record) {
  const seen = new Set();
  let url = `${origin}/2048/read.php?tid=${record.tid}&ordertype=desc`;
  for (let index = 0; index < 3 && url; index++) {
    seen.add(url);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (response?.status() === 429) throw new Fault('RATE_LIMIT', '回复查证被限流');
    if (!response?.ok() || new URL(page.url()).origin !== origin) throw new Fault('TRANSIENT', '回复查证页面访问异常', true);
    if (await page.evaluate(() => Number(window.winduid)) !== record.uid) throw new Fault('LOGIN_EXPIRED', '回复查证时登录账号变化或过期');
    if (await ownReply(page, record.uid, record.text, record.date)) return true;
    const links = await page.locator('a[href*="read.php"]').evaluateAll(nodes => nodes.map(a => a.href));
    url = links.find(href => { const u = new URL(href); return u.origin === origin && u.pathname === '/2048/read.php' && u.searchParams.get('tid') === String(record.tid) && u.searchParams.has('page') && u.searchParams.get('ordertype') === 'desc' && !seen.has(href); });
  }
  return false;
}
export async function ensureReply(page, root, { log = async () => {}, assertDay = () => {}, runDir = `${root}artifacts`, expectedUid } = {}) {
  const date = today();
  const uid = await page.evaluate(() => Number(window.winduid));
  if (!(uid > 0) || (expectedUid && uid !== expectedUid)) throw new Fault('LOGIN_EXPIRED', '回复前未确认原登录账号');
  const path = `${root}session/reply-${uid}-${date}.json`;
  const existing = await readJson(path).catch(() => { throw new Fault('REPLY_PENDING', '回复记录损坏，保留文件并停止重复发布'); });
  if (existing) {
    if (existing.uid !== uid || existing.date !== date || existing.text !== replyText || !/^\d+$/.test(String(existing.tid)) || !['PENDING', 'CONFIRMED'].includes(existing.status)) throw new Fault('REPLY_PENDING', '回复记录与当天账号不符，停止重复发布');
    if (existing.status === 'CONFIRMED') {
      await log('REPLY_CONFIRMED', '当天本人回复已核实成功，直接继续签到');
      return;
    }
    if (await verifyRecordedReply(page, existing)) {
      await atomicJson(path, { ...existing, status: 'CONFIRMED' });
      await log('REPLY_CONFIRMED', '查证本人当天回复，跳过发布');
      return;
    }
    throw new Fault('REPLY_PENDING', '已有回复记录，本次尚未查证成功；稍后自动复查，不再次发布', true);
  }
  // 论坛自己的排序函数按发表时间排列；这里只改变列表排序。
  await page.goto(forumUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismissNotice(page);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }), page.evaluate(() => orderThreads('postdate'))]);
  const tid = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr')];
    const marker = rows.findIndex(e => e.classList.contains('tr2') && e.innerText.trim() === '普通主题');
    if (marker < 0) return null;
    const a = rows.slice(marker + 1).map(r => r.querySelector('a[id^="a_ajax_"]')).find(Boolean);
    return a?.id.replace('a_ajax_', '') || null;
  });
  if (!/^\d+$/.test(tid || '')) throw new Error('未找到普通主题，未回复');
  await page.goto(`${origin}/2048/read.php?tid=${tid}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismissNotice(page);
  const form = page.locator('form[name="FORM"]');
  if (await form.count() !== 1 || await form.locator('input[name="fid"]').inputValue() !== '57' || await form.locator('input[name="action"]').inputValue() !== 'reply' || await form.locator('input[name="tid"]').inputValue() !== tid) throw new Error('回复表单与聚友客栈帖子不匹配，未回复');
  const action = new URL(await form.getAttribute('action'), page.url());
  if (action.origin !== origin || action.pathname !== '/2048/post.php') throw new Error('回复提交地址无法确认');
  const record = { date, uid, tid, text: replyText, status: 'PENDING', time: new Date().toISOString() };
  if (await ownReply(page, uid, replyText, date)) {
    await atomicJson(path, { ...record, status: 'CONFIRMED' });
    await log('REPLY_CONFIRMED', '最新帖已找到本人同文回复，跳过发布');
    return;
  }
  await form.locator('textarea[name="atc_content"]').fill(replyText);
  const lastPage = form.locator('#go_lastpage');
  if (await lastPage.count()) await lastPage.check();
  // 点击之前记录提交意图；异常退出或响应丢失不会在下一次重复发布。
  assertDay();
  await atomicJson(path, record);
  await log('REPLY_SUBMIT_INTENT', `帖子 ${tid}`);
  assertDay();
  try {
    const [response] = await Promise.all([
      page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).origin === origin && new URL(r.url()).pathname === '/2048/post.php', { timeout: 60000 }),
      form.locator('input[name="Submit"]').click(),
    ]);
    await response.finished();
    if (response.status() === 429) throw new Fault('RATE_LIMIT', '回复提交被限流');
    await log('REPLY_RESPONSE', String(response.status()));
  } catch (e) {
    if (e.code === 'RATE_LIMIT') throw e;
    await log('REPLY_RESPONSE_UNCERTAIN', '响应未确认，仅查证，不再次发布');
  }
  if (!await verifyRecordedReply(page, record)) {
    await writeFile(`${runDir}/reply-result.html`, await page.content());
    throw new Fault('REPLY_PENDING', '论坛尚未确认本人回复，保留提交记录，稍后自动查证', true);
  }
  await atomicJson(path, { ...record, status: 'CONFIRMED' });
  await log('REPLY_CONFIRMED', `帖子 ${tid}`);
}

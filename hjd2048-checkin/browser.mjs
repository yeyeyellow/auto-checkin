import { atomicJson, readJson } from '../shared/io.mjs';
import { Fault } from '../shared/policy.mjs';
export const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
export const origin = 'https://hjd2048.com';
export const forumUrl = `${origin}/2048/thread.php?fid=57`;
export const signUrl = `${origin}/2048/hack.php?H_name=qiandao`;
export async function contextOptions(browser, root, hasState = true) {
  const path = `${root}session/browser.json`;
  let metadata;
  try { metadata = await readJson(path); }
  catch (e) {
    metadata = await readJson(`${path}.bak`).catch(() => null);
    if (!metadata?.userAgent) throw new Fault('LOGIN_EXPIRED', '浏览器会话元数据损坏且无完整备份，请重新登录');
    await atomicJson(path, metadata);
  }
  if (metadata && (typeof metadata.userAgent !== 'string' || !metadata.userAgent.includes('Chrome/'))) throw new Fault('LOGIN_EXPIRED', '浏览器会话元数据不完整，请重新登录');
  const userAgent = metadata?.userAgent || `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version().split('.')[0]}.0.0.0 Safari/537.36`;
  return { ...(hasState ? { storageState: `${root}session/state.json` } : {}), userAgent, viewport: { width: 1280, height: 900 } };
}
export async function readStatus(page) {
  return page.evaluate(() => {
    const uid = Number(window.winduid);
    const logout = [...document.querySelectorAll('a[href*="action=quit"]')].some(e => /退出/.test(e.innerText));
    const login = [...document.querySelectorAll('a[href="login.php"]')].some(e => /登录/.test(e.innerText));
    if (!(uid > 0) && !logout && login) return { state: 'LOGIN_EXPIRED' };
    if (!(uid > 0 && logout)) return { state: 'UNKNOWN' };
    const heading = [...document.querySelectorAll('td.h')].find(e => e.textContent.trim() === '签到服务台');
    const panel = heading?.closest('table');
    if (!panel) return { state: 'UNKNOWN' };
    const text = panel.innerText;
    const ownStats = /您累计已签到/.test(text);
    const already = /今天已签到/.test(text);
    const pending = /今天未签到/.test(text);
    const mood = document.querySelector('form[name="form2"] input[name="qdxq"]');
    if (ownStats && already && !pending) return { state: 'ALREADY_SIGNED', uid };
    if (ownStats && pending && !already && mood) return { state: 'NOT_SIGNED', uid };
    return { state: 'UNKNOWN' };
  });
}
export async function dismissNotice(page) {
  const close = page.locator('#pwDomainNoticeBtn');
  if (await close.isVisible()) await close.click();
}

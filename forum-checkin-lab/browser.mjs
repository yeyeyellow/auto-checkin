export const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
export const origin = 'https://laowangrsc278.vip';
export async function dismissNotices(page) {
  const language = page.locator('#zh-cvt-cn');
  if (await language.isVisible()) await language.click();
  const close = page.locator('#save_info').getByText('关闭', { exact: true });
  if (await close.isVisible()) await close.click();
}
export async function readStatus(page) {
  return page.evaluate(() => {
    const uid = Number(window.discuz_uid);
    const logout = !!document.querySelector('a[href*="action=logout"]');
    const panel = document.querySelector('.qdleft');
    const visited = !!panel?.querySelector('.btnvisted');
    const entry = panel?.querySelector('a.btn');
    const loginEntry = !!entry?.getAttribute('href')?.includes('action=login');
    if (uid === 0 && !logout && loginEntry) return { state: 'LOGIN_EXPIRED' };
    if (!(uid > 0 && logout && panel)) return { state: 'UNKNOWN' };
    if (visited && !entry) return { state: 'ALREADY_SIGNED', uid };
    if (entry && !loginEntry && !visited) return { state: 'NOT_SIGNED', uid };
    return { state: 'UNKNOWN' };
  });
}

import { Fault } from './policy.mjs';

export async function checkSite(context, url) {
  let response;
  try {
    response = await context.request.get(url, { timeout: 15000 });
    if (response.status() === 429) throw new Fault('RATE_LIMIT', '网站可访问性检查被限流，等待 30 分钟后补试', true);
    if (!response.ok() || new URL(response.url()).origin !== new URL(url).origin || !/text\/html/i.test(response.headers()['content-type'] || '')) {
      throw new Error(`HTTP ${response.status()}，未收到本站正常网页`);
    }
    if (!(await response.text()).trim()) throw new Error('网站返回空页面');
  } catch (error) {
    if (error instanceof Fault) throw error;
    throw new Fault('SITE_UNAVAILABLE', `网站可访问性检查失败：${error.message.split('\n')[0]}`, true);
  } finally {
    if (response) await response.dispose();
  }
}

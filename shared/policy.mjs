export const day = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export const retryMinutes = [2, 5, 10, 15, 30];
export const retryDelay = attempts => retryMinutes[Math.min(Math.max(attempts - 1, 0), retryMinutes.length - 1)];
export const rapidRetryRounds = 10;
export const rapidRetryIntervalMs = 20000;
export function retryPlan(result, rounds) {
  if (!result.retryable) return { rapid: false, delayMs: null };
  if (['RATE_LIMIT', 'REPLY_PENDING', 'CLOCK_SKEW', 'CLOCK_UNCHECKED'].includes(result.code)) return { rapid: false, delayMs: 30 * 60000 };
  const rapid = rounds < rapidRetryRounds && ['CAPTCHA', 'SITE_UNAVAILABLE', 'SERVER', 'TRANSIENT'].includes(result.code);
  return { rapid, delayMs: rapid ? rapidRetryIntervalMs : retryDelay(Math.max(1, rounds - rapidRetryRounds + 1)) * 60000 };
}
export function gate(control, hash, now = Date.now()) {
  if (!control) return null;
  if (control.verified && control.sessionHash === hash) return 'CONFIRMED_TODAY';
  if (control.stop && !(control.code === 'LOGIN_EXPIRED' && control.sessionHash !== hash)) return 'NEEDS_ATTENTION';
  if (control.nextAt && now < Date.parse(control.nextAt)) return 'WAIT_RETRY';
  return null;
}
export class Fault extends Error {
  constructor(code, message, retryable = false) { super(message); this.code = code; this.retryable = retryable; }
}
export function classify(error) {
  if (error instanceof Fault && error.code === 'RATE_LIMIT') return new Fault('RATE_LIMIT', error.message, true);
  if (error instanceof Fault) return error;
  const message = error.message?.split('\n')[0] || String(error);
  if (/net::|ECONN|ENOTFOUND|timed out|Timeout|browser.*closed|Target.*closed|Browser.*closed/i.test(message)) return new Fault('TRANSIENT', message, true);
  if (/置信度不足|服务端未通过滑块验证|验证码尚未通过/.test(message)) return new Fault('CAPTCHA', message, true);
  return new Fault('LOCAL_RETRY', message, true);
}

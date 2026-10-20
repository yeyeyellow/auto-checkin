import { Fault } from '../shared/policy.mjs';

// The site's timestamp check uses browser Date, so detect drift before opening a challenge.
export function assertServerClock(response, startedAt, finishedAt = Date.now()) {
  const headers = response.headers();
  const serverTime = Date.parse(headers.date);
  const age = Number(headers.age || 0);
  if (!Number.isFinite(serverTime) || !Number.isFinite(age) || age < 0) {
    throw new Fault('CLOCK_UNCHECKED', '无法读取论坛服务器时间，稍后重新检查', true);
  }
  const offset = serverTime + age * 1000 - (startedAt + finishedAt) / 2;
  // HTTP dates have one-second precision; also allow for the full response round trip.
  if (Math.abs(offset) > 60000 + (finishedAt - startedAt) / 2) {
    throw new Fault('CLOCK_SKEW', `电脑与论坛服务器时间相差约 ${Math.round(Math.abs(offset) / 1000)} 秒；请先同步 Windows 时间，未提交验证码`, true);
  }
}

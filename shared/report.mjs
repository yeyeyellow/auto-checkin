import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readJson } from './io.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const site of ['forum-checkin-lab', 'hjd2048-checkin']) {
  const directory = `${root}${site}/artifacts/days/`;
  const names = await readdir(directory).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  const days = await Promise.all(names.filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().map(async name => ({ date: name.slice(0,10), ...await readJson(`${directory}${name}`).catch(() => ({ damaged: true })) })));
  const startupErrors = await readdir(`${root}${site}/artifacts/startup-errors/`).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  for (const date of new Set(startupErrors.map(name => name.slice(0,10)))) if (!days.some(d => d.date === date)) days.push({ date, startupFailure: true });
  const automatic = days.filter(d => d.automaticVerified).length;
  const assisted = days.filter(d => d.verified && !d.automaticVerified).length;
  console.log(JSON.stringify({ site, observedDays: days.length, automaticSuccessDays: automatic, assistedSuccessDays: assisted, unconfirmedDays: days.length - automatic - assisted, automaticSuccessPercent: days.length ? Math.round(1000 * automatic / days.length) / 10 : null, sampleReady: days.length >= 30, note: '只统计留下当日运行记录的日期；关闭电脑等无运行机会日期不在分母中。当天未结束的失败可能仍在补试。' }));
}

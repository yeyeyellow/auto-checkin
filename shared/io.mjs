import { open, readFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export async function atomicJson(path, value, { backup = false } = {}) {
  await mkdir(dirname(path), { recursive: true });
  if (backup) {
    const old = await readFile(path, 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (old) { try { JSON.parse(old); await atomicJson(`${path}.bak`, JSON.parse(old)); } catch (e) { if (!(e instanceof SyntaxError)) throw e; } }
  }
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync(); } finally { await file.close(); }
    for (let attempt = 0; ; attempt++) {
      try { await rename(temp, path); break; }
      catch (e) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || attempt >= 5) throw e;
        await delay(25 * 2 ** attempt);
      }
    }
  } finally { await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
export async function readJson(path) {
  const raw = await readFile(path, 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  return raw === null ? null : JSON.parse(raw.replace(/^\uFEFF/, ''));
}
export async function loadSession(path) {
  const valid = state => state && Array.isArray(state.cookies) && state.cookies.every(c => ['name', 'value', 'domain', 'path'].every(k => typeof c[k] === 'string')) && Array.isArray(state.origins) && state.origins.every(o => typeof o.origin === 'string' && Array.isArray(o.localStorage));
  try { const state = await readJson(path); if (valid(state)) return state; }
  catch (e) { if (!(e instanceof SyntaxError)) throw e; }
  const backup = await readJson(`${path}.bak`).catch(e => { if (e instanceof SyntaxError) return null; throw e; });
  if (!valid(backup)) return null;
  await atomicJson(path, backup);
  console.log('会话文件损坏或缺失，已恢复完整备份；将以论坛登录状态复查');
  return backup;
}

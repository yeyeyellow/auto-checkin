import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function acquireRunLock(path, { timeoutSeconds = 300 } = {}) {
  const name = 'Global\\ForumCheckin-' + createHash('sha256').update(resolve(path).toLowerCase()).digest('hex');
  const helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./mutex.ps1', import.meta.url)), '-Name', name, '-OwnerPid', String(process.pid), '-TimeoutSeconds', String(timeoutSeconds)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let released = false, output = '', errors = '';
  helper.stderr.on('data', chunk => { errors += chunk; });
  helper.stdin.on('error', () => {});
  const held = await new Promise((resolveHeld, reject) => {
    const timer = setTimeout(() => { helper.kill(); reject(new Error('Windows 互斥初始化超时')); }, 45000);
    const finish = value => { clearTimeout(timer); resolveHeld(value); };
    helper.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('ACQUIRED')) finish(true);
      else if (output.includes('BUSY')) finish(false);
    });
    helper.once('error', error => { clearTimeout(timer); reject(error); });
    helper.once('exit', () => {
      clearTimeout(timer);
      if (!output.includes('ACQUIRED') && !output.includes('BUSY')) reject(new Error('Windows 互斥初始化失败：' + errors.split('\n')[0]));
      // 互斥拥有者异常消失时停止操作，避免失去并发保护后继续提交。
      if (output.includes('ACQUIRED') && !released) { console.error('互斥保护意外终止，停止运行'); process.exit(4); }
    });
  });
  if (!held) { helper.stdin.end(); return null; }
  return async () => {
    released = true;
    const exited = new Promise(r => helper.once('exit', r));
    helper.stdin.end('RELEASE\n');
    await exited;
  };
}

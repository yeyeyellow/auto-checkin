import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSite } from './connectivity.mjs';
import { retryDelay } from './policy.mjs';

test('site check accepts only reachable same-site HTML and releases responses', async () => {
  for (const kind of ['ok', 'server', 'redirect', 'empty', 'json', 'offline', 'rate-limit']) {
    let disposed = false;
    const context = { request: { async get() {
      if (kind === 'offline') throw new Error('ECONNREFUSED');
      return {
        ok: () => !['server', 'rate-limit'].includes(kind), status: () => kind === 'server' ? 503 : kind === 'rate-limit' ? 429 : 200,
        url: () => kind === 'redirect' ? 'https://other.invalid/' : 'https://forum.invalid/',
        headers: () => ({ 'content-type': kind === 'json' ? 'application/json' : 'text/html' }),
        text: async () => kind === 'empty' ? '' : '<html>Forum</html>',
        dispose: async () => { disposed = true; },
      };
    } } };
    if (kind === 'ok') await checkSite(context, 'https://forum.invalid/');
    else if (kind === 'rate-limit') await assert.rejects(checkSite(context, 'https://forum.invalid/'), e => e.code === 'RATE_LIMIT' && e.retryable);
    else await assert.rejects(checkSite(context, 'https://forum.invalid/'), e => e.code === 'SITE_UNAVAILABLE' && e.retryable);
    assert.equal(disposed, kind !== 'offline');
  }
  assert.equal(retryDelay(0), 2);
  assert.equal(retryDelay(100), 30);
});

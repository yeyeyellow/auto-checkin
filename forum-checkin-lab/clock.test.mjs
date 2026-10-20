import test from 'node:test';
import assert from 'node:assert/strict';
import { assertServerClock } from './clock.mjs';

const start = Date.parse('2026-10-20T06:00:00Z');
const response = (offset = 0, extra = {}) => ({ headers: () => ({ date: new Date(start + offset).toUTCString(), ...extra }) });

test('detects the observed eight-hour clock drift in either direction before CAPTCHA submission', () => {
  for (const offset of [8 * 3600000, -8 * 3600000]) {
    assert.throws(() => assertServerClock(response(offset), start, start + 1000), e => e.code === 'CLOCK_SKEW' && e.retryable && /2880[01] 秒/.test(e.message));
  }
  assert.doesNotThrow(() => assertServerClock(response(), start, start + 1000));
});

test('accounts for cached HTTP dates and round-trip delay without treating timezone text as an offset', () => {
  assert.doesNotThrow(() => assertServerClock(response(-120000, { age: '120' }), start, start + 1000));
  assert.doesNotThrow(() => assertServerClock(response(), start, start + 150000));
  assert.doesNotThrow(() => assertServerClock(response(59000), start, start + 1000));
  assert.throws(() => assertServerClock(response(90000), start, start + 1000), { code: 'CLOCK_SKEW' });
});

test('missing or invalid server time does not silently allow a timestamp-sensitive submission', () => {
  for (const headers of [{}, { date: 'invalid' }, { date: new Date(start).toUTCString(), age: 'invalid' }, { date: new Date(start).toUTCString(), age: '-1' }]) {
    assert.throws(() => assertServerClock({ headers: () => headers }, start, start + 1000), { code: 'CLOCK_UNCHECKED' });
  }
});

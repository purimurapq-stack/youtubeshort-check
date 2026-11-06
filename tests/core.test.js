import test from 'node:test';
import assert from 'node:assert/strict';
import { Measurement, parseVideoId, csv } from '../core.js';
const ids = ['abcdefghijk', '12345678901'];
function fixture(interval = 20) {
  let now = 0; const switches = [];
  const m = new Measurement({ now: () => now, date: () => '2026-11-06T00:00:00.000Z', onSwitch: v => switches.push(v.id) });
  m.start(ids, interval);
  return { m, switches, at(t, position, duration = 60) { now = t; m.sample(position, duration); }, time(t) { now = t; } };
}
test('URL formats and invalid hosts', () => {
  for (const url of ['https://youtube.com/shorts/abcdefghijk?si=x', 'https://www.youtube.com/watch?v=abcdefghijk&t=3', 'https://youtu.be/abcdefghijk']) assert.equal(parseVideoId(url), ids[0]);
  for (const url of ['javascript:alert(1)', 'https://youtube.com.evil.test/shorts/abcdefghijk', 'https://youtu.be/short', 'bad']) assert.equal(parseVideoId(url), null);
});
test('20 second deadline includes startup latency, wraps and resets position', () => {
  const f = fixture(); f.time(15000); f.m.setState(1, 0); assert.equal(f.m.visit.latency, 15000);
  f.at(20000, 5); assert.equal(f.m.visit.id, ids[1]); f.at(40000, 0);
  assert.deepEqual(f.switches, [ids[0], ids[1], ids[0]]); assert.equal(f.m.position, 0);
});
test('early end advances; interval change applies next visit', () => {
  const f = fixture(); f.m.interval = 5; assert.equal(f.m.deadline, 20000);
  f.time(1000); f.m.setState(0); assert.equal(f.m.visit.index, 1); assert.equal(f.m.deadline, 6000);
});
test('buffer count deduplicates, duration finalized on stop', () => {
  const f = fixture(); f.time(100); f.m.setState(3); f.time(600); f.m.setState(3);
  assert.equal(f.m.bufferCount, 1); f.time(1100); f.m.setState(1); assert.equal(f.m.bufferTotal, 1000);
  f.time(1500); f.m.setState(3); f.time(2000); f.m.stop(); assert.equal(f.m.bufferTotal, 1500);
});
test('stall threshold, deduplication and recovery', () => {
  const f = fixture(); f.m.setState(1); f.at(500, 0); f.at(1500, 0); assert.equal(f.m.stallCount, 0);
  f.at(2000, 0); f.at(2500, 0); assert.equal(f.m.stallCount, 1);
  f.at(3000, .5); assert.equal(f.m.stallTotal, 3000); assert.equal(f.m.visit.real, .5);
  f.at(5000, .5); assert.equal(f.m.stallCount, 2);
});
test('switching, manual pause and near end exclude stalls', () => {
  const f = fixture(); f.at(3000, 0); assert.equal(f.m.stallCount, 0);
  f.m.setState(2); f.at(6000, 0); assert.equal(f.m.stallCount, 0);
  f.m.setState(1, 59.5); f.at(9000, 59.5, 60); assert.equal(f.m.stallCount, 0);
});
test('real playing duration excludes seeks and pauses', () => {
  const f = fixture(); f.m.setState(1); f.at(500, .5); f.at(1000, 1); f.m.setState(2, 1);
  f.at(5000, 1); f.m.setState(1, 1); f.at(5500, 30); f.at(6000, 30.5); assert.equal(f.m.visit.real, 1.5);
});
test('stop freezes totals and ignores subsequent samples/events', () => {
  const f = fixture(); f.m.setState(3); f.time(1500); f.m.stop(); const count = f.m.rows.length;
  f.at(30000, 2); f.m.setState(1); assert.equal(f.m.rows.length, count); assert.equal(f.m.totals().elapsed, 1500); assert.equal(f.m.totals().buffer, 1500);
});
test('CSV BOM, CRLF, Japanese headers and escaping', () => {
  const f = fixture(); f.m.log('再生エラー', 1200, 'a,"b"\nnext'); const result = csv(f.m.rows);
  assert.equal(result.charCodeAt(0), 0xfeff); assert.ok(result.includes('"継続時間（秒）"'));
  assert.ok(result.includes('"a,""b""\nnext"')); assert.ok(result.endsWith('\r\n'));
});
test('invalid intervals and empty list rejected', () => {
  for (const i of [4, 121, NaN]) assert.throws(() => fixture(i));
  assert.throws(() => new Measurement().start([], 20));
});

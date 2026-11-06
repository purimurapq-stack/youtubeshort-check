export const STATES = { '-1': 'UNSTARTED', 0: 'ENDED', 1: 'PLAYING', 2: 'PAUSED', 3: 'BUFFERING', 5: 'CUED' };
export function parseVideoId(value) {
  let url;
  try { url = new URL(value.trim()); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase();
  let id;
  if (['youtu.be', 'www.youtu.be'].includes(host)) id = url.pathname.split('/')[1];
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
    if (url.pathname.startsWith('/shorts/')) id = url.pathname.split('/')[2];
    else if (url.pathname === '/watch') id = url.searchParams.get('v');
  }
  return /^[\w-]{11}$/.test(id || '') ? id : null;
}
export function csv(rows) {
  const columns = ['日時', '動画番号', '動画ID', 'イベント', '再生位置（秒）', '継続時間（秒）', '詳細'];
  const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  return '\uFEFF' + [columns, ...rows.map(r => [r.date, r.number, r.id, r.event, r.position.toFixed(3), r.duration == null ? '' : (r.duration / 1000).toFixed(3), r.detail])].map(r => r.map(quote).join(',')).join('\r\n') + '\r\n';
}
export class Measurement {
  constructor({ now = () => performance.now(), date = () => new Date().toISOString(), onLog = () => {}, onSwitch = () => {}, onStop = () => {} } = {}) {
    Object.assign(this, { now, date, onLog, onSwitch, onStop });
    this.rows = []; this.visits = []; this.active = false;
  }
  log(event, duration = null, detail = '') {
    const v = this.visit;
    const row = { date: this.date(), number: v ? v.index + 1 : '', id: v?.id || '', event, position: this.position || 0, duration, detail };
    this.rows.push(row); this.onLog(row);
  }
  start(ids, interval) {
    if (!ids.length || !Number.isFinite(interval) || interval < 5 || interval > 120) throw new Error('動画と5〜120秒の切替間隔が必要です');
    this.ids = [...ids]; this.interval = interval; this.rows = []; this.visits = [];
    this.started = this.now(); this.stopped = null; this.active = true;
    this.bufferCount = 0; this.stallCount = 0; this.bufferTotal = 0; this.stallTotal = 0;
    this.visit = null; this.position = 0; this.log('計測開始'); this.switchTo(0);
  }
  switchTo(index) {
    if (!this.active) return;
    this.closeVisit();
    const t = this.now();
    this.visit = { id: this.ids[index], index, switched: t, latency: null, real: 0, buffer: 0, stall: 0 };
    this.visits.push(this.visit); this.deadline = t + this.interval * 1000;
    this.position = 0; this.state = -1; this.lastSample = t; this.lastPosition = 0; this.noProgress = t;
    this.bufferStart = null; this.stallStart = null;
    this.log('動画切替開始'); this.onSwitch(this.visit);
  }
  next() { this.switchTo((this.visit.index + 1) % this.ids.length); }
  endBuffer(t) {
    if (this.bufferStart == null) return;
    const d = t - this.bufferStart; this.bufferTotal += d; this.visit.buffer += d;
    this.bufferStart = null; this.log('バッファリング終了', d);
  }
  endStall(t) {
    if (this.stallStart == null) return;
    const d = t - this.stallStart; this.stallTotal += d; this.visit.stall += d;
    this.stallStart = null; this.log('再生停滞終了', d);
  }
  closeVisit() {
    if (!this.visit) return;
    const t = this.now(); this.endBuffer(t); this.endStall(t);
    this.log('動画別計測結果', this.visit.real * 1000, `実再生時間=${this.visit.real.toFixed(3)}秒; バッファリング=${(this.visit.buffer / 1000).toFixed(3)}秒; 停滞=${(this.visit.stall / 1000).toFixed(3)}秒`);
  }
  setState(state, position = this.position) {
    if (!this.active || !Object.hasOwn(STATES, state)) return;
    if (this.now() >= this.deadline) { this.next(); return; }
    const t = this.now();
    this.sample(position, 0, false);
    if (state === this.state) return;
    this.endBuffer(t); this.endStall(t);
    this.state = state; this.noProgress = t; this.lastSample = t; this.lastPosition = position;
    this.log('状態変更', null, STATES[state]);
    if (state === 3) { this.bufferCount++; this.bufferStart = t; this.log('バッファリング開始'); }
    if (state === 1 && this.visit.latency == null) { this.visit.latency = t - this.visit.switched; this.log('動画再生開始', this.visit.latency); }
    if (state === 0) { this.log('動画終了'); this.next(); }
  }
  sample(position, duration = 0, detect = true) {
    if (!this.active) return;
    const t = this.now();
    if (detect && t >= this.deadline) { this.sample(position, duration, false); this.next(); return; }
    if (!Number.isFinite(position)) return;
    const elapsed = Math.max(0, (t - this.lastSample) / 1000);
    const delta = position - this.lastPosition;
    this.position = position;
    if (this.state === 1 && delta > 0 && delta <= elapsed + 0.5) this.visit.real += Math.min(delta, elapsed);
    const nearEnd = duration > 0 && duration - position <= 1;
    if (this.state !== 1 || nearEnd || !detect || delta < -0.05 || delta > elapsed + 0.5) {
      this.endStall(t); this.noProgress = t;
    } else if (delta > 0.01) { this.endStall(t); this.noProgress = t; }
    else if (this.visit.latency != null && t - this.noProgress >= 2000 && this.stallStart == null) {
      this.stallStart = this.noProgress; this.stallCount++; this.log('再生停滞開始', null, '再生位置が2秒以上進まないため検出（開始時点からの時間を集計）');
    }
    this.lastPosition = position; this.lastSample = t;
  }
  stop() {
    if (!this.active) return;
    this.closeVisit(); this.stopped = this.now(); this.log('計測終了', this.stopped - this.started);
    this.active = false; this.onStop();
  }
  totals() {
    const t = this.active ? this.now() : this.stopped;
    return { buffer: (this.bufferTotal || 0) + (this.bufferStart == null ? 0 : t - this.bufferStart), stall: (this.stallTotal || 0) + (this.stallStart == null ? 0 : t - this.stallStart), elapsed: this.started == null ? 0 : t - this.started };
  }
}

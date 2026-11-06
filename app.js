import { Measurement, STATES, parseVideoId, csv } from './core.js';
const $ = id => document.getElementById(id);
let ids = [], player = null, apiReady = false, generation = 0, switchTimer, pollTimer, autoplayTimer;
try { const saved = JSON.parse(localStorage.getItem('shorts-lab-v1') || '[]'); if (Array.isArray(saved)) ids = saved.filter(id => typeof id === 'string' && /^[\w-]{11}$/.test(id)); } catch { /* Storage is optional. */ }
const warn = message => { $('warning').textContent = message; $('warning').hidden = !message; };
const seconds = ms => (ms / 1000).toFixed(1);
function renderList() {
  $('videoList').replaceChildren();
  ids.forEach((id, index) => {
    const li = document.createElement('li');
    if (measurement.active && measurement.visit.index === index) li.className = 'active';
    const number = document.createElement('b'); number.textContent = String(index + 1).padStart(2, '0');
    const name = document.createElement('span'); name.textContent = id;
    const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label', `${id} を削除`); remove.disabled = measurement.active;
    remove.onclick = () => { ids.splice(index, 1); saveList(); };
    li.append(number, name, remove); $('videoList').append(li);
  });
  $('listCount').textContent = `${ids.length}本`; $('emptyList').hidden = ids.length > 0;
  $('start').disabled = !apiReady || measurement.active || ids.length === 0;
  $('stop').disabled = !measurement.active;
  $('videoUrl').disabled = measurement.active; $('addForm').querySelector('button').disabled = measurement.active;
}
function saveList() { try { localStorage.setItem('shorts-lab-v1', JSON.stringify(ids)); } catch { $('listMessage').textContent = 'ブラウザへの保存ができません。リストはこの画面内のみ有効です。'; } renderList(); }
$('addForm').onsubmit = event => {
  event.preventDefault(); if (measurement.active) return;
  const id = parseVideoId($('videoUrl').value);
  if (!id) { $('listMessage').textContent = '対応するYouTubeのURL（11文字の動画ID）を入力してください。'; return; }
  if (ids.includes(id)) { $('listMessage').textContent = 'この動画は登録済みです。'; return; }
  ids.push(id); $('videoUrl').value = ''; $('listMessage').textContent = '動画を追加しました。'; saveList();
};
function addLog(row) {
  $('emptyLog').hidden = true;
  const tr = document.createElement('tr');
  const values = [new Date(row.date).toLocaleString('ja-JP', { hour12: false }), row.number, row.id, row.event, row.position.toFixed(2) + ' 秒', row.duration == null ? '—' : seconds(row.duration) + ' 秒', row.detail];
  for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
  const container = document.querySelector('.table-scroll'); const atBottom = container.scrollHeight - container.clientHeight - container.scrollTop < 70;
  $('logs').append(tr); if ($('logs').children.length > 500) $('logs').firstElementChild.remove();
  if (atBottom) container.scrollTop = container.scrollHeight;
  $('download').disabled = false;
}
function read(method, fallback = 0) { try { return player?.[method]?.() ?? fallback; } catch { return fallback; } }
function clearVisitTimers() { clearTimeout(switchTimer); clearTimeout(autoplayTimer); clearInterval(pollTimer); }
function scheduleSwitch() {
  clearTimeout(switchTimer);
  switchTimer = setTimeout(() => { if (measurement.active) { measurement.sample(read('getCurrentTime'), read('getDuration'), false); measurement.next(); } }, Math.max(0, measurement.deadline - performance.now()));
}
function switchVideo(visit) {
  clearVisitTimers(); const token = ++generation;
  if (player) { player.destroy(); player = null; }
  $('playerHost').replaceChildren(); const mount = document.createElement('div'); $('playerHost').append(mount);
  $('loaded').innerHTML = '0<small> %</small>'; warn('');
  player = new YT.Player(mount, {
    width: '100%', height: '100%',
    playerVars: { playsinline: 1, controls: 1, rel: 0, origin: location.origin },
    events: {
      onReady(event) {
        if (!measurement.active || token !== generation) return;
        if ($('mute').checked) event.target.mute(); else event.target.unMute();
        event.target.loadVideoById({ videoId: visit.id, startSeconds: 0 });
      },
      onStateChange(event) {
        if (!measurement.active || token !== generation) return;
        measurement.setState(event.data, read('getCurrentTime'));
        if (token !== generation) return;
        if (event.data === 1) { clearTimeout(autoplayTimer); warn(''); }
        if (event.data === 2) warn('一時停止中です。プレーヤーで再開できます。切替タイマーは継続します。');
        render();
      },
      onAutoplayBlocked() {
        if (!measurement.active || token !== generation) return;
        warn('自動再生がブロックされました。プレーヤーの再生ボタンを押してください。');
        measurement.log('自動再生ブロック');
      },
      onError(event) {
        if (!measurement.active || token !== generation) return;
        const errors = { 2: '動画IDまたはパラメーターが無効', 5: 'HTML5プレーヤーで再生できません', 100: '削除済み、非公開、または動画が見つかりません', 101: '埋め込み再生が許可されていません', 150: '埋め込み再生が許可されていません', 153: 'Refererまたはクライアント識別情報がありません' };
        const message = `エラー ${event.data}: ${errors[event.data] || '再生できません'}`;
        measurement.log('再生エラー', null, message); warn(`${message}。設定した切替時刻に次へ進みます。`);
      }
    }
  });
  scheduleSwitch();
  autoplayTimer = setTimeout(() => {
    if (measurement.active && token === generation && measurement.visit.latency == null) {
      warn('まだ再生が開始していません。自動再生制限・通信・動画の再生制限を確認し、必要ならプレーヤーの再生ボタンを押してください。');
      measurement.log('再生開始待ち', performance.now() - visit.switched);
    }
  }, 5000);
  pollTimer = setInterval(() => {
    if (!measurement.active || token !== generation) return;
    measurement.sample(read('getCurrentTime'), read('getDuration'), !document.hidden);
    if (token === generation) render();
  }, 500);
  renderList(); render();
}
const measurement = new Measurement({ onLog: addLog, onSwitch: switchVideo, onStop() {
  clearVisitTimers(); ++generation;
  try { player?.stopVideo(); } catch { /* Already removed player. */ }
  renderList(); render(); warn('');
} });
function render() {
  const totals = measurement.totals(); const v = measurement.visit;
  $('sessionBadge').textContent = measurement.active ? '● 計測中' : measurement.started != null ? '■ 計測終了' : '● 待機中';
  $('videoNumber').textContent = v ? `VIDEO ${String(v.index + 1).padStart(2, '0')} / ${measurement.ids.length}` : 'VIDEO — / —';
  $('currentVideo').textContent = v?.id || '未選択';
  $('state').textContent = measurement.active ? STATES[measurement.state] : 'STOPPED';
  $('position').textContent = (measurement.position || 0).toFixed(1);
  const remaining = measurement.active ? Math.max(0, measurement.deadline - performance.now()) / 1000 : 0;
  $('remaining').textContent = measurement.active ? remaining.toFixed(1) : '—';
  $('progressFill').style.width = measurement.active ? `${Math.max(0, Math.min(100, remaining * 100000 / (measurement.deadline - v.switched)))}%` : '0%';
  $('buffers').innerHTML = `${measurement.bufferCount || 0}<small> 回</small>`;
  $('stalls').innerHTML = `${measurement.stallCount || 0}<small> 回</small>`;
  $('stoppedTime').innerHTML = `${seconds(totals.buffer + totals.stall)}<small> 秒</small>`;
  $('latency').textContent = v?.latency == null ? '—' : seconds(v.latency) + ' 秒';
  if (measurement.active) $('loaded').innerHTML = `${(Math.max(0, Math.min(1, read('getVideoLoadedFraction'))) * 100).toFixed(0)}<small> %</small>`;
  const elapsed = Math.floor(totals.elapsed / 1000); $('elapsed').textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
}
$('start').onclick = () => {
  if (measurement.active || !apiReady || !ids.length) return;
  if (!$('interval').reportValidity()) return;
  $('logs').replaceChildren(); $('emptyLog').hidden = false; warn('');
  measurement.start(ids, Number($('interval').value));
};
$('stop').onclick = () => {
  if (measurement.active) { measurement.sample(read('getCurrentTime'), read('getDuration'), false); measurement.stop(); }
};
$('interval').onchange = () => {
  if (!$('interval').reportValidity()) return;
  if (measurement.active) measurement.interval = Number($('interval').value);
};
$('mute').onchange = () => { if (player?.mute) { if ($('mute').checked) player.mute(); else player.unMute(); } };
$('download').onclick = () => {
  const rows = [...measurement.rows];
  if (measurement.active) {
    for (const v of measurement.visits) rows.push({ date: new Date().toISOString(), number: v.index + 1, id: v.id, event: '実再生時間（出力時点）', position: 0, duration: v.real * 1000, detail: '各訪問の再生位置増分を集計（シークを除外）' });
  }
  const url = URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `shorts-lab-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
document.addEventListener('visibilitychange', () => {
  $('backgroundWarning').hidden = !document.hidden;
  if (measurement.active) {
    measurement.log(document.hidden ? 'バックグラウンド移行' : '画面復帰', null, 'タイマー制限により計測精度が低下する可能性があります');
    measurement.sample(read('getCurrentTime'), read('getDuration'), false);
    if (!document.hidden && performance.now() >= measurement.deadline) measurement.next();
    render();
  }
});
window.onYouTubeIframeAPIReady = () => { apiReady = true; clearTimeout(apiTimeout); $('apiStatus').textContent = '準備完了 · ミュート再生を推奨'; renderList(); };
const apiTimeout = setTimeout(() => { if (!apiReady) { $('apiStatus').textContent = 'YouTube APIを読み込めません。通信状態を確認して再読み込みしてください。'; warn('YouTubeへの接続が必要です。ネットワーク制限や拡張機能も確認してください。'); } }, 15000);
const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.onerror = () => { $('apiStatus').textContent = 'YouTube APIの読み込みに失敗しました。再読み込みしてください。'; }; document.head.append(script);
renderList(); render();

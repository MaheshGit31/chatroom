(() => {
'use strict';
const C = window.__core, U = window.__ui, X = window.__ext;
const { S, el, ic, toast, sendWS } = C;
const { modal } = U;

const W = 1000, H = 600, SPEED = 260;
const EMOTES = { wave: 'wave', heart: 'heart', laugh: 'haha', fire: 'fire', gg: 'gg', sad: 'sad' };
const hueOf = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };
const TREES = [[90, 90], [880, 80], [120, 500], [900, 510], [500, 60], [60, 300], [940, 300]];
const POND = { x: 520, y: 330, rx: 110, ry: 60 };

let live = null;

function worldModal(c, focusTrivia) {
  if (live) return;
  const canvas = el('canvas', { width: W, height: H, class: 'worldcv' });
  const g = canvas.getContext('2d');
  const players = new Map(), coins = new Map();
  const st = { me: S.me.id, roundEnds: 0, trivia: null, keys: new Set(), target: null, last: performance.now(), lastSent: 0, name: c.name, raf: 0, over: null };
  const board = el('div', { class: 'worldboard' });
  const timer = el('span', { class: 'muted small' });
  const triviaBox = el('div', { class: 'worldtrivia' });
  const input = el('input', { placeholder: 'say something (enter)', maxLength: 80 });
  const emoteRow = el('div', { class: 'row gap-s wraprow' }, Object.entries(EMOTES).map(([k, l]) => el('button', { class: 'btn small', onclick: () => sendWS({ t: 'world_emote', e: k }) }, l)));
  const trBtn = el('button', { class: 'btn small primary', onclick: () => sendWS({ t: 'world_trivia_start' }) }, ic('trophy', 14), 'big trivia');
  const body = el('div', { class: 'col gap-s' },
    el('div', { class: 'row between', style: 'align-items:center' }, el('span', { class: 'muted small' }, 'walk with wasd, arrows or tap. grab coins. everyone in this room can be here.'), timer),
    el('div', { class: 'worldwrap' }, canvas, triviaBox),
    board,
    el('div', { class: 'row gap-s' }, input, trBtn),
    emoteRow);
  const m = modal('hangout · ' + c.name, body, { wide: true, onClose: stop });
  m.box.style.width = 'min(94vw, 860px)'; m.box.style.maxWidth = 'min(94vw, 860px)';

  function stop() {
    cancelAnimationFrame(st.raf);
    document.removeEventListener('keydown', kd); document.removeEventListener('keyup', ku);
    sendWS({ t: 'world_leave' });
    X.onWorld = null; live = null;
  }
  live = { stop };

  const pl = (id) => players.get(id);
  const addPlayer = (p) => players.set(p.id, { id: p.id, name: p.name, x: p.x, y: p.y, tx: p.x, ty: p.y, say: '', sayUntil: 0, emo: '', emoUntil: 0, score: p.score || 0 });

  X.onWorld = (e) => {
    switch (e.t) {
      case 'world_state':
        players.clear(); coins.clear();
        e.players.forEach(addPlayer); e.coins.forEach((k) => coins.set(k.id, k));
        st.roundEnds = e.roundEnds; st.trivia = e.trivia; drawTrivia(); drawBoard(); break;
      case 'world_join': addPlayer(e); drawBoard(); break;
      case 'world_leave': players.delete(e.id); drawBoard(); break;
      case 'world_pos': e.p.forEach(([id, x, y]) => { const p = pl(id); if (p && id !== st.me) { p.tx = x; p.ty = y; } }); break;
      case 'world_say': { const p = pl(e.id); if (p) { p.say = e.text; p.sayUntil = performance.now() + 5000; } break; }
      case 'world_emote': { const p = pl(e.id); if (p) { p.emo = EMOTES[e.e]; p.emoUntil = performance.now() + 2500; } break; }
      case 'world_coin_new': coins.set(e.id, e); break;
      case 'world_coin': { coins.delete(e.id); const p = pl(e.by); if (p) p.score = e.score; drawBoard(); break; }
      case 'world_round': { players.forEach((p) => { p.score = 0; }); st.roundEnds = e.next; st.over = { top: e.top, until: performance.now() + 7000 }; drawBoard(); break; }
      case 'world_trivia': st.trivia = e.phase === 'end' ? { phase: 'end', top: e.top, until: performance.now() + 9000 } : e; drawTrivia(); break;
      case 'world_answered': st.answered = e.i; drawTrivia(); break;
      case 'world_error': toast(e.message, 'error'); break;
    }
  };

  function drawBoard() {
    const top = [...players.values()].sort((a, b) => b.score - a.score).slice(0, 5);
    board.replaceChildren(el('span', { class: 'muted small' }, players.size + ' here'), ...top.map((p, i) => el('span', { class: 'tag' + (p.id === st.me ? ' gold' : '') }, `${i + 1}. ${p.name} ${p.score}`)));
  }

  function drawTrivia() {
    const t = st.trivia;
    if (!t) { triviaBox.style.display = 'none'; return; }
    triviaBox.style.display = 'flex';
    if (t.phase === 'end') {
      triviaBox.replaceChildren(el('div', { class: 'ctitle' }, ic('trophy', 16), 'big trivia results'), ...t.top.map((r, i) => el('div', null, `${i + 1}. ${r.name} - ${r.score}`)), !t.top.length ? el('div', { class: 'muted' }, 'nobody scored') : null);
      setTimeout(() => { if (st.trivia && st.trivia.phase === 'end') { st.trivia = null; drawTrivia(); } }, 9000);
      return;
    }
    const mine = st.answered === t.i;
    triviaBox.replaceChildren(
      el('div', { class: 'muted small' }, `question ${t.i + 1} of ${t.total}`),
      el('div', { class: 'ctitle' }, t.q),
      ...t.o.map((o, i) => el('button', { class: 'btn' + (t.phase === 'reveal' && t.a === i ? ' primary' : ''), disabled: t.phase !== 'q' || mine, onclick: () => { st.answered = t.i; sendWS({ t: 'world_answer', i: t.i, a: i }); drawTrivia(); } }, o)),
      t.phase === 'reveal' ? el('div', { class: 'muted small' }, 'top: ' + (t.top || []).map((r) => `${r.name} ${r.score}`).join(', ')) : mine ? el('div', { class: 'muted small' }, 'locked in') : null);
  }

  const kd = (e) => {
    if (e.target === input) { if (e.key === 'Enter' && input.value.trim()) { sendWS({ t: 'world_say', text: input.value }); input.value = ''; } e.stopPropagation(); return; }
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { st.keys.add(k); st.target = null; e.preventDefault(); }
  };
  const ku = (e) => st.keys.delete(e.key.toLowerCase());
  document.addEventListener('keydown', kd, true); document.addEventListener('keyup', ku);

  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    st.target = { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  });

  function step(now) {
    const dt = Math.min(0.05, (now - st.last) / 1000); st.last = now;
    const me = pl(st.me);
    if (me) {
      let dx = 0, dy = 0;
      if (st.keys.has('a') || st.keys.has('arrowleft')) dx -= 1;
      if (st.keys.has('d') || st.keys.has('arrowright')) dx += 1;
      if (st.keys.has('w') || st.keys.has('arrowup')) dy -= 1;
      if (st.keys.has('s') || st.keys.has('arrowdown')) dy += 1;
      if (!dx && !dy && st.target) {
        const vx = st.target.x - me.x, vy = st.target.y - me.y, d = Math.hypot(vx, vy);
        if (d < 6) st.target = null; else { dx = vx / d; dy = vy / d; }
      }
      if (dx || dy) {
        const l = Math.hypot(dx, dy) || 1;
        me.x = Math.min(W - 12, Math.max(12, me.x + dx / l * SPEED * dt)); me.y = Math.min(H - 12, Math.max(12, me.y + dy / l * SPEED * dt));
        if (now - st.lastSent > 70) { st.lastSent = now; sendWS({ t: 'world_move', x: Math.round(me.x), y: Math.round(me.y) }); }
        coins.forEach((k) => { if (Math.hypot(k.x - me.x, k.y - me.y) < 34 && !k.asked) { k.asked = true; sendWS({ t: 'world_coin', id: k.id }); } });
      }
    }
    players.forEach((p) => { if (p.id !== st.me) { p.x += (p.tx - p.x) * Math.min(1, dt * 12); p.y += (p.ty - p.y) * Math.min(1, dt * 12); } });
    draw(now);
    const left = Math.max(0, Math.round((st.roundEnds - Date.now()) / 1000));
    timer.textContent = st.roundEnds ? `coin round ends in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '';
    st.raf = requestAnimationFrame(step);
  }

  function draw(now) {
    g.fillStyle = '#86b36a'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.07)';
    for (let i = 0; i < 40; i++) g.fillRect((i * 173) % W, (i * 97) % H, 60, 10);
    g.fillStyle = '#5aa0c8'; g.beginPath(); g.ellipse(POND.x, POND.y, POND.rx, POND.ry, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 3; g.stroke();
    TREES.forEach(([x, y]) => { g.fillStyle = '#6b4a2f'; g.fillRect(x - 5, y, 10, 26); g.fillStyle = '#3f7a3a'; g.beginPath(); g.arc(x, y, 30, 0, 7); g.fill(); });
    coins.forEach((k) => { g.fillStyle = '#f2c230'; g.beginPath(); g.arc(k.x, k.y, 10, 0, 7); g.fill(); g.strokeStyle = '#b8891a'; g.lineWidth = 2; g.stroke(); });
    [...players.values()].sort((a, b) => a.y - b.y).forEach((p) => {
      g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.ellipse(p.x, p.y + 15, 14, 5, 0, 0, 7); g.fill();
      g.fillStyle = `hsl(${hueOf(p.name)} 60% 55%)`; g.beginPath(); g.arc(p.x, p.y, 16, 0, 7); g.fill();
      g.lineWidth = p.id === st.me ? 3 : 1.5; g.strokeStyle = p.id === st.me ? '#fff' : 'rgba(0,0,0,.4)'; g.stroke();
      g.fillStyle = '#fff'; g.font = 'bold 15px sans-serif'; g.textAlign = 'center'; g.fillText((p.name[0] || '?').toUpperCase(), p.x, p.y + 5);
      g.font = '12px sans-serif'; g.fillStyle = '#10200f'; g.fillText(p.name.slice(0, 14), p.x, p.y + 32);
      if (p.sayUntil > now && p.say) bubble(p.x, p.y - 28, p.say);
      if (p.emoUntil > now && p.emo) { g.font = 'bold 14px sans-serif'; g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeText(p.emo, p.x, p.y - 24 - (1 - (p.emoUntil - now) / 2500) * 20); g.fillText(p.emo, p.x, p.y - 24 - (1 - (p.emoUntil - now) / 2500) * 20); }
    });
    if (st.over && st.over.until > now) {
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(W / 2 - 200, 20, 400, 40 + st.over.top.length * 26);
      g.fillStyle = '#fff'; g.font = 'bold 18px sans-serif'; g.textAlign = 'center'; g.fillText('coin round over', W / 2, 48);
      st.over.top.forEach((r, i) => g.fillText(`${i + 1}. ${r.name} - ${r.score}`, W / 2, 76 + i * 26));
    }
  }
  function bubble(x, y, text) {
    g.font = '13px sans-serif'; const w = Math.min(220, g.measureText(text).width + 16);
    g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1;
    g.beginPath(); g.roundRect(x - w / 2, y - 26, w, 24, 8); g.fill(); g.stroke();
    g.fillStyle = '#222'; g.textAlign = 'center'; g.fillText(text.length > 30 ? text.slice(0, 29) + '…' : text, x, y - 9);
  }

  sendWS({ t: 'world_join', convId: c.id });
  if (focusTrivia) setTimeout(() => sendWS({ t: 'world_trivia_start' }), 900);
  st.raf = requestAnimationFrame(step);
}

Object.assign(window.__ext, { worldModal, onWorld: null });
})();

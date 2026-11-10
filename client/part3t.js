{
const C = window.__core, S = C.S, el = C.el, ic = C.ic, api = C.api, toast = C.toast, fmtTime = C.fmtTime, avatar = C.avatar;
const live = () => !!(window.__ext && window.__ext.dropOn && window.__ext.dropOn());
const pad = (n) => String(n).padStart(2, '0');
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + pad(s % 60); };
const B = { ev: null, off: 0, next: [], pill: null, announced: null };
let G = null;
const nowS = () => Date.now() + B.off;
const ARENA = { w: 2400, h: 1800 };
const BUS_MS = 30000;
const CX = 1200, CY = 820;

const css = document.createElement('style');
css.textContent = `
.bosspill{position:fixed;top:calc(env(safe-area-inset-top,0px) + 8px);left:50%;transform:translateX(-50%);z-index:280;display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:#2a0f0b;color:#ffd9c7;border:1px solid #7a2a1a;font:700 13px/1 var(--mono);letter-spacing:.03em;cursor:pointer;white-space:nowrap;max-width:calc(100vw - 24px)}
.bosspill b{font-family:var(--display);font-weight:800;color:#ff9a6b}
.bosspill.live{background:#b8321a;color:#fff;border-color:#ff7a45;animation:bosspulse 1.1s ease-in-out infinite}
.bosspill.live b{color:#fff}
.bosspill.idle{opacity:.75;font-weight:600;padding:6px 12px;font-size:12px}
@keyframes bosspulse{0%,100%{box-shadow:0 0 0 0 rgba(255,90,40,.6)}50%{box-shadow:0 0 0 10px rgba(255,90,40,0)}}
.bossgame{position:fixed;inset:0;z-index:285;background:#0a0606;touch-action:none;user-select:none;-webkit-user-select:none;overflow:hidden;color:#fff;font-family:var(--body)}
.bossgame canvas{position:absolute;inset:0;width:100%;height:100%;display:block;image-rendering:pixelated}
.bg-top{position:absolute;left:0;right:0;top:0;padding:max(8px,env(safe-area-inset-top)) 10px 0;pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:4px}
.bg-name{font:800 13px var(--display);letter-spacing:.2em;color:#ff9a6b;text-shadow:0 2px 0 #000}
.bg-bar{width:min(560px,92vw);height:16px;border:3px solid #000;background:#2b0d09;box-shadow:0 0 0 2px #7a2a1a}
.bg-bar i{display:block;height:100%;width:100%;background:linear-gradient(#ff5a2b,#c4321a)}
.bg-sub{font:700 12px var(--mono);color:#ffd9c7;text-shadow:0 2px 0 #000}
.bg-left{position:absolute;left:10px;top:max(64px,calc(env(safe-area-inset-top) + 56px));pointer-events:none;display:flex;flex-direction:column;gap:6px}
.bg-hearts{display:flex;gap:4px}
.bg-hearts span{width:18px;height:16px;background:#ff3b3b;clip-path:polygon(50% 100%,0 40%,0 15%,20% 0,50% 20%,80% 0,100% 15%,100% 40%);filter:drop-shadow(0 2px 0 #000)}
.bg-hearts span.off{background:#4a2a2a}
.bg-me{font:700 12px var(--mono);text-shadow:0 2px 0 #000}
.bg-top5{position:absolute;right:10px;top:max(64px,calc(env(safe-area-inset-top) + 56px));pointer-events:none;font:700 11px var(--mono);text-shadow:0 2px 0 #000;text-align:right;display:flex;flex-direction:column;gap:2px;max-width:42vw}
.bg-top5 div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bg-x{position:absolute;right:10px;top:max(8px,env(safe-area-inset-top));z-index:5;width:38px;height:38px;border-radius:10px;background:#000a;color:#fff;display:flex;align-items:center;justify-content:center}
.bg-msg{position:absolute;left:0;right:0;top:36%;text-align:center;pointer-events:none;font:800 clamp(22px,6vw,48px) var(--display);text-shadow:0 4px 0 #000;letter-spacing:.06em;opacity:0;transition:opacity .25s}
.bg-msg.on{opacity:1}
.bg-jump{position:absolute;left:50%;bottom:max(28px,env(safe-area-inset-bottom));transform:translateX(-50%);padding:16px 38px;border-radius:14px;background:#ffb02e;color:#2a1600;font:800 20px var(--display);letter-spacing:.08em;border:4px solid #000;box-shadow:0 5px 0 #000;z-index:4}
.bg-over{position:absolute;inset:0;background:#000d;display:flex;align-items:center;justify-content:center;z-index:6;padding:16px;overflow:auto}
.bg-card{width:min(440px,100%);background:#1a0d09;border:3px solid #7a2a1a;border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:10px}
.bg-card h2{margin:0;font:800 26px var(--display);text-align:center;color:#ff9a6b}
.bg-row{display:flex;gap:8px;align-items:center;font:700 14px var(--body);padding:4px 6px;border-radius:8px}
.bg-row.me{background:#ff5a2b33}
.bg-row .r{width:28px;color:#ffb02e;font-family:var(--mono)}
.bg-row .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bg-row .d{font-family:var(--mono);color:#ffd9c7}
.bg-row .g{font-size:11px;color:#6fe38a}
`;
document.head.append(css);

const sendWS = (o) => { try { C.sendWS(o); } catch {} };

async function load() {
  if (!live() || !S.me) return renderPill();
  try {
    const t0 = Date.now();
    const d = await api('GET', '/api/boss', null, { quiet: true });
    B.off = (d.ev ? d.ev.now : Date.now()) + (Date.now() - t0) / 2 - Date.now();
    B.ev = d.ev; B.next = d.next || [];
  } catch {}
  renderPill();
}

function renderPill() {
  const ok = live() && S.me;
  if (!ok) { if (B.pill) { B.pill.remove(); B.pill = null; } return; }
  if (S.drop && S.drop.phase !== 'done' && !S.me.isAdmin) { if (B.pill) { B.pill.remove(); B.pill = null; } return; }
  if (G) { if (B.pill) B.pill.style.display = 'none'; return; }
  const ev = B.ev;
  let text = null, cls = 'bosspill', fn = infoModal;
  if (ev && ev.status !== 'ended') {
    const left = ev.startsAt - nowS();
    if (left > 0) { text = ['BOSS FIGHT in ', mmss(left)]; fn = openGame; cls += ' live'; if (left > 60000) cls = 'bosspill'; }
    else { text = ['BOSS FIGHT LIVE', ' - join']; cls += ' live'; fn = openGame; }
    if (ev.test) text[0] = 'TEST ' + text[0];
  } else if (ev && ev.status === 'ended') { text = ['FIGHT OVER', ' - results']; fn = () => resultsModal('last'); }
  else if (B.next[0]) { text = ['next boss fight ', fmtTime(B.next[0])]; cls += ' idle'; }
  if (!text) { if (B.pill) { B.pill.remove(); B.pill = null; } return; }
  if (!B.pill) { B.pill = el('button', { class: cls }); document.body.append(B.pill); }
  B.pill.style.display = '';
  B.pill.className = cls;
  B.pill.onclick = fn;
  B.pill.replaceChildren(ic('timer', 14), el('b', null, text[0]), el('span', null, text[1]));
}

function announce(ev) {
  if (!ev || ev.status === 'ended' || B.announced === ev.id) return;
  B.announced = ev.id;
  toast(ev.test ? 'test boss fight is starting' : 'the boss is coming, tap the red pill to join', 'success');
}

function rowsEl(rows, myName) {
  return rows.length ? rows.map((r) => el('div', { class: 'bg-row' + (S.me && r.username === S.me.username ? ' me' : '') }, el('span', { class: 'r' }, '#' + r.rank), el('span', { class: 'n' }, r.name || r.username), el('span', { class: 'd' }, (r.damage || 0).toLocaleString()), r.mins ? el('span', { class: 'g' }, '+' + Math.round(r.mins / 1440) + 'd') : null)) : [el('div', { class: 'muted pad' }, 'nobody yet')];
}
async function resultsModal(scope) {
  const body = el('div', null);
  const tabs = el('div', { class: 'seg', style: 'margin-bottom:10px' });
  const list = el('div', null, el('div', { class: 'muted pad' }, '...'));
  const draw = async (sc) => {
    tabs.replaceChildren(...[['last', 'last fight'], ['today', 'today'], ['all', 'all time']].map(([k, l]) => el('button', { class: sc === k ? 'on' : '', onclick: () => draw(k) }, l)));
    list.replaceChildren(el('div', { class: 'muted pad' }, '...'));
    try { const d = await api('GET', '/api/boss/leaderboard?scope=' + sc, null, { quiet: true }); list.replaceChildren(...(d.won === true ? [el('div', { class: 'small good', style: 'margin-bottom:6px' }, 'the boss was defeated')] : d.won === false ? [el('div', { class: 'small muted', style: 'margin-bottom:6px' }, 'the boss survived')] : []), ...rowsEl(d.rows)); } catch (e) { list.replaceChildren(el('div', { class: 'muted pad' }, e.message)); }
  };
  body.append(tabs, list);
  window.__ui.modal('boss leaderboard', body);
  draw(scope);
}
function infoModal() {
  const body = el('div', null,
    el('p', { class: 'muted', style: 'margin-top:0' }, 'twice a day the doomsclock boss attacks. drop from the bus, fight it together, and the top 10 damage dealers win beta: 3 days for 1st, 2 days for 2nd and 3rd, 1 day for 4th to 10th.'),
    el('div', { class: 'card-s' }, ic('timer', 16), el('span', { class: 'grow' }, B.next.length ? 'next fights: ' + B.next.map((t) => fmtTime(t)).join(', ') : 'no fight scheduled'), null),
    el('button', { class: 'btn primary', style: 'margin-top:10px', onclick: () => { resultsModal('last'); } }, ic('crown', 16), 'leaderboard'));
  window.__ui.modal('boss fight', body);
}

function rng(s) { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const bossAt = (T) => ({ x: CX + Math.sin(T / 4200) * 160, y: CY + Math.cos(T / 5600) * 90 });
const LOOKS = {
  skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a0522d'],
  hair: ['#2b1b0e', '#7a4a21', '#d9a441', '#c4572c', '#3a3a3a', '#6d3a9c', '#2a7a6a'],
  shirt: ['#c4572c', '#587a82', '#7a8c55', '#8c5a6c', '#b8843a', '#6c7596', '#d0d0d0', '#3a6ad0'],
  pants: ['#2c3a55', '#3b2f2f', '#2f4a3b', '#4a3a55', '#555555'],
};
const hashS = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const lookOf = (name) => { const h = hashS(name); const p = (a, k) => a[(h >>> k) % a.length]; return { skin: p(LOOKS.skin, 0), hair: p(LOOKS.hair, 3), shirt: p(LOOKS.shirt, 6), pants: p(LOOKS.pants, 9) }; };

function drawChar(g, x, y, ang, look, t, firing) {
  const s = 3;
  g.save(); g.translate(Math.round(x), Math.round(y));
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(-9, 12, 18, 5);
  const step = Math.floor(t / 130) % 2;
  g.fillStyle = look.pants; g.fillRect(-2 * s, 3 * s, 2 * s, 3 * s + (step ? 0 : -1)); g.fillRect(0, 3 * s, 2 * s, 3 * s + (step ? -1 : 0));
  g.fillStyle = look.shirt; g.fillRect(-3 * s, -1 * s, 6 * s, 4 * s);
  g.fillStyle = look.skin; g.fillRect(-2 * s, -5 * s, 4 * s, 4 * s);
  g.fillStyle = look.hair; g.fillRect(-2 * s, -6 * s, 4 * s, 2 * s); g.fillRect(-3 * s, -5 * s, s, 2 * s);
  g.fillStyle = '#000'; const fx = Math.cos(ang) > 0 ? 1 : -1; g.fillRect(fx > 0 ? s : -2 * s, -3 * s, s, s);
  g.rotate(ang);
  g.fillStyle = '#222'; g.fillRect(6, -2, 16, 5);
  g.fillStyle = '#777'; g.fillRect(6, -2, 16, 2);
  if (firing) { g.fillStyle = '#ffe14a'; g.fillRect(22, -3, 6, 7); }
  g.restore();
}

let bossSprite = null;
function makeBoss() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const disc = (cx, cy, rad, col) => { g.fillStyle = col; for (let y = -rad; y <= rad; y++) { const w = Math.floor(Math.sqrt(rad * rad - y * y)); g.fillRect(cx - w, cy + y, w * 2, 1); } };
  const tri = (x0, y0, dir, h, w, col) => { g.fillStyle = col; for (let i = 0; i < h; i++) { const ww = Math.max(1, Math.round(w * (1 - i / h))); g.fillRect(x0 - (dir > 0 ? 0 : ww), y0 - i, ww, 1); } };
  tri(14, 14, 1, 14, 7, '#1c1c24'); tri(50, 14, -1, 14, 7, '#1c1c24');
  disc(32, 36, 28, '#1c1c24'); disc(32, 36, 26, '#a8721f'); disc(32, 36, 23, '#e8b86a');
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; const x = Math.round(32 + Math.sin(a) * 19), y = Math.round(36 - Math.cos(a) * 19); r(x - 1, y - 1, i % 3 ? 2 : 3, i % 3 ? 2 : 3, '#7a2a1a'); }
  r(18, 20, 10, 6, '#fff3d6'); r(36, 20, 10, 6, '#fff3d6');
  r(20, 21, 7, 5, '#ff3b1f'); r(37, 21, 7, 5, '#ff3b1f');
  r(23, 20, 2, 7, '#000'); r(40, 20, 2, 7, '#000');
  r(15, 16, 13, 3, '#1c1c24'); r(36, 16, 13, 3, '#1c1c24');
  r(18, 44, 28, 10, '#14070a');
  for (let i = 0; i < 6; i++) { tri(20 + i * 5, 44, 1, 4, 4, '#fff6dc'); r(20 + i * 5, 50, 3, 4, '#fff6dc'); }
  return c;
}

function openGame() {
  if (G || !B.ev || B.ev.status === 'ended') return;
  const root = el('div', { class: 'bossgame' });
  const cv = el('canvas');
  const g = cv.getContext('2d');
  const bar = el('i');
  const nameEl = el('div', { class: 'bg-name' }, 'THE DOOMSCLOCK');
  const sub = el('div', { class: 'bg-sub' }, '');
  const hearts = el('div', { class: 'bg-hearts' }, [0, 1, 2, 3, 4].map(() => el('span')));
  const meEl = el('div', { class: 'bg-me' }, '');
  const top5 = el('div', { class: 'bg-top5' });
  const msg = el('div', { class: 'bg-msg' });
  const jump = el('button', { class: 'bg-jump', style: 'display:none' }, 'JUMP');
  const xbtn = el('button', { class: 'bg-x', title: 'leave', onclick: () => leave() }, ic('x', 20));
  root.append(cv, el('div', { class: 'bg-top' }, nameEl, el('div', { class: 'bg-bar' }, bar), sub), el('div', { class: 'bg-left' }, hearts, meEl), top5, msg, jump, xbtn);
  document.body.append(root);
  if (!bossSprite) bossSprite = makeBoss();
  G = {
    root, cv, g, bar, sub, hearts, meEl, top5, msg, jump, ev: B.ev, joined: false, phase: 'lobby', raf: 0, last: performance.now(), W: 0, H: 0, dpr: 1,
    me: { x: 200, y: 200, hp: 5, alive: false, fall: -1, inv: 0, ang: 0, cd: 0, rapid: 0, jumped: false, dmg: 0, rank: 0, of: 0, deadAt: 0, moving: 0 },
    keys: {}, aim: { x: 0, y: 0, down: false }, sticks: { l: null, r: null }, touch: false, bullets: [], parts: [], floats: [], ghosts: new Map(), hp: B.ev.hp, hpShow: B.ev.hp, max: B.ev.max, st: B.ev.status,
    top: [], pend: 0, taken: new Set(), flash: 0, shake: 0, camx: CX, camy: CY, z: 0.3, sender: 0, ui: 0, msgT: 0, over: null, bossFlash: 0, lastPh: 1, hitFx: 0, joinSent: false, tm: 0,
  };
  const Z = G;
  const resize = () => { Z.dpr = Math.min(2, window.devicePixelRatio || 1); Z.W = window.innerWidth; Z.H = window.innerHeight; cv.width = Math.round(Z.W * Z.dpr); cv.height = Math.round(Z.H * Z.dpr); };
  resize(); window.addEventListener('resize', resize);
  const kd = (e) => { if (e.target && /input|textarea/i.test(e.target.tagName)) return; const k = e.key.toLowerCase(); Z.keys[k] = true; if (k === ' ' || k.startsWith('arrow')) e.preventDefault(); if (k === ' ') doJump(); if (k === 'escape') leave(); };
  const ku = (e) => { Z.keys[e.key.toLowerCase()] = false; };
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
  const toWorld = (sx, sy) => ({ x: Z.camx + (sx - Z.W / 2) / Z.z, y: Z.camy + (sy - Z.H / 2) / Z.z });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    try { cv.setPointerCapture(e.pointerId); } catch {}
    if (e.pointerType === 'touch') {
      Z.touch = true;
      const side = e.clientX < Z.W / 2 ? 'l' : 'r';
      if (!Z.sticks[side]) Z.sticks[side] = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
    } else { Z.aim.down = true; Z.aim.x = e.clientX; Z.aim.y = e.clientY; }
  });
  cv.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') {
      for (const k of ['l', 'r']) { const s = Z.sticks[k]; if (s && s.id === e.pointerId) { let dx = e.clientX - s.ox, dy = e.clientY - s.oy; const L = Math.hypot(dx, dy), m = 56; if (L > m) { dx = dx / L * m; dy = dy / L * m; } s.x = dx / m; s.y = dy / m; } }
    } else { Z.aim.x = e.clientX; Z.aim.y = e.clientY; }
  });
  const up = (e) => { if (e.pointerType === 'touch') { for (const k of ['l', 'r']) if (Z.sticks[k] && Z.sticks[k].id === e.pointerId) Z.sticks[k] = null; } else Z.aim.down = false; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  jump.onclick = () => doJump();
  Z.cleanup = () => { cancelAnimationFrame(Z.raf); clearInterval(Z.ui); clearInterval(Z.sender); window.removeEventListener('resize', resize); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); root.remove(); };

  const bms = () => Z.ev.busMs || BUS_MS;
  const T = () => nowS() - (Z.ev.startsAt + bms());
  const busPos = () => { const u = Math.min(1, Math.max(0, (nowS() - Z.ev.startsAt) / bms())); return { x: 120 + u * 2160, y: 160 + u * 1480 }; };
  const say = (t, ms = 2200) => { Z.msg.textContent = t; Z.msg.classList.add('on'); Z.msgT = performance.now() + ms; };
  Z.say = say;
  const spawnFall = (x, y) => { const m = Z.me; m.x = Math.max(60, Math.min(ARENA.w - 60, x)); m.y = Math.max(60, Math.min(ARENA.h - 60, y)); m.fall = 0; m.alive = false; m.hp = 5; m.jumped = true; Z.phase = 'play'; Z.jump.style.display = 'none'; };
  function doJump() {
    if (Z.phase !== 'bus' || !Z.joined || Z.me.jumped) return;
    const p = busPos(); spawnFall(p.x, p.y);
  }
  function leave() { sendWS({ t: 'boss_leave' }); Z.cleanup(); G = null; renderPill(); }
  Z.leave = leave;

  const phaseNow = () => (Z.hp / Z.max > 0.66 ? 1 : Z.hp / Z.max > 0.33 ? 2 : 3);
  const hurt = () => {
    const m = Z.me;
    if (!m.alive || performance.now() < m.inv) return;
    m.hp--; m.inv = performance.now() + 1300; Z.shake = 10; Z.flash = 0.35;
    if (m.hp <= 0) { m.alive = false; m.deadAt = performance.now(); m.hp = 0; sendWS({ t: 'boss_die' }); say('you got clocked. respawning...', 2600); }
  };

  Z.sender = setInterval(() => {
    if (!Z.joined || !Z.me.jumped) return;
    const m = Z.me;
    sendWS({ t: 'boss_t', x: Math.round(m.x), y: Math.round(m.y), a: +m.ang.toFixed(2), f: Z.firing ? 1 : 0, h: Z.pend });
    Z.pend = 0;
  }, 600);

  Z.ui = setInterval(() => {
    const ev = Z.ev, now = nowS();
    const frac = Math.max(0, Math.min(1, Z.hpShow / Z.max));
    Z.bar.style.width = (frac * 100).toFixed(1) + '%';
    const t = T();
    if (Z.phase === 'over') return;
    if (now < ev.startsAt) Z.sub.textContent = 'bus leaves in ' + mmss(ev.startsAt - now);
    else if (t < 0) Z.sub.textContent = 'boss arrives in ' + mmss(-t);
    else Z.sub.textContent = Math.max(0, Math.round(Z.hp)).toLocaleString() + ' / ' + Z.max.toLocaleString() + '   time ' + mmss(ev.fightMs - t);
    [...Z.hearts.children].forEach((h, i) => h.classList.toggle('off', i >= Z.me.hp));
    Z.meEl.textContent = Z.me.jumped ? `damage ${Z.me.dmg.toLocaleString()}${Z.me.rank ? '  rank #' + Z.me.rank : ''}` : '';
    Z.top5.replaceChildren(...Z.top.map((r, i) => el('div', null, `${i + 1}. ${r[0]}  ${r[1].toLocaleString()}`)));
    if (performance.now() > Z.msgT) Z.msg.classList.remove('on');
  }, 250);

  const showEnd = (d) => {
    Z.phase = 'over';
    const won = d.ev && d.ev.won;
    const me = S.me;
    const mine = d.top.find((r) => me && r.username === me.username);
    const card = el('div', { class: 'bg-card' },
      el('h2', null, d.stopped ? 'fight stopped' : won ? 'THE BOSS IS DOWN' : 'THE CLOCK SURVIVED'),
      mine && mine.mins ? el('div', { style: 'text-align:center;color:#6fe38a;font-weight:800' }, `you placed #${mine.rank} and won ${Math.round(mine.mins / 1440)} day${mine.mins >= 2880 ? 's' : ''} of beta`) : (Z.me.dmg ? el('div', { style: 'text-align:center;color:#ffd9c7' }, `you dealt ${Z.me.dmg.toLocaleString()} damage${mine ? ' (#' + mine.rank + ')' : ''}`) : null),
      ...rowsEl(d.top.slice(0, 10)),
      el('button', { class: 'btn primary', onclick: () => leave() }, 'close'));
    Z.over = el('div', { class: 'bg-over' }, card);
    Z.root.append(Z.over);
  };
  Z.showEnd = showEnd;

  const loop = (nowMs) => {
    Z.raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (nowMs - Z.last) / 1000); Z.last = nowMs;
    update(dt, nowMs); draw(nowMs);
  };

  function update(dt, nowMs) {
    const ev = Z.ev, now = nowS(), m = Z.me, t = T();
    const startAt = ev.startsAt;
    if (!Z.joinSent && now >= startAt - 15000) { Z.joinSent = true; sendWS({ t: 'boss_join' }); }
    Z.st = now < startAt ? 'scheduled' : t < 0 ? 'bus' : 'fight';
    if (Z.joined && !m.jumped && Z.phase !== 'over') {
      if (t >= 0) spawnFall(300 + Math.random() * 1800, 300 + Math.random() * 1200);
      else if (now >= startAt && Z.phase !== 'bus') { Z.phase = 'bus'; Z.jump.style.display = ''; say('THE BATTLE BUS IS HERE - JUMP!', 3000); }
    }
    if (!Z.bossIntro && t >= 0 && m.jumped) { Z.bossIntro = true; say('THE DOOMSCLOCK AWAKENS', 3000); }
    const ph = phaseNow();
    if (t >= 0 && ph > Z.lastPh) { Z.lastPh = ph; say(ph === 2 ? 'PHASE 2' : 'FINAL PHASE', 2400); Z.shake = 14; }
    Z.hpShow += (Z.hp - Z.hpShow) * Math.min(1, dt * 6);
    if (Z.shake > 0) Z.shake = Math.max(0, Z.shake - dt * 30);
    if (Z.flash > 0) Z.flash = Math.max(0, Z.flash - dt);
    if (Z.hitFx > 0) Z.hitFx = Math.max(0, Z.hitFx - dt);

    if (m.fall >= 0) { m.fall += dt; if (m.fall >= 1.7) { m.fall = -1; m.alive = true; m.inv = nowMs + 2000; } }
    if (m.jumped && !m.alive && m.fall < 0 && m.hp <= 0 && nowMs - m.deadAt > 5000) { spawnFall(300 + Math.random() * 1800, 300 + Math.random() * 1200); }

    let mx = 0, my = 0;
    const K = Z.keys;
    if (K.w || K.arrowup) my -= 1; if (K.s || K.arrowdown) my += 1; if (K.a || K.arrowleft) mx -= 1; if (K.d || K.arrowright) mx += 1;
    const sl = Z.sticks.l, sr = Z.sticks.r;
    if (sl) { mx += sl.x; my += sl.y; }
    const L = Math.hypot(mx, my);
    if (L > 1) { mx /= L; my /= L; }
    let firing = false;
    if (m.alive || m.fall >= 0) {
      const sp = m.fall >= 0 ? 90 : 235;
      m.x = Math.max(30, Math.min(ARENA.w - 30, m.x + mx * sp * dt)); m.y = Math.max(30, Math.min(ARENA.h - 30, m.y + my * sp * dt));
      m.moving = L > 0.1 ? m.moving + dt : 0;
    }
    if (sr && Math.hypot(sr.x, sr.y) > 0.25) { m.ang = Math.atan2(sr.y, sr.x); firing = true; }
    else if (Z.aim.down || (!Z.touch && Z.aim.x)) { const w = toWorld(Z.aim.x, Z.aim.y); m.ang = Math.atan2(w.y - m.y, w.x - m.x); firing = Z.aim.down; }
    else if (L > 0.1 && Z.touch) m.ang = Math.atan2(my, mx);
    Z.firing = firing && m.alive;
    m.cd -= dt;
    if (Z.firing && m.cd <= 0) {
      m.cd = m.rapid > 0 ? 1 / 11 : 1 / 7;
      const jx = (Math.random() - 0.5) * 0.06;
      Z.bullets.push({ x: m.x + Math.cos(m.ang) * 22, y: m.y + Math.sin(m.ang) * 22, vx: Math.cos(m.ang + jx) * 700, vy: Math.sin(m.ang + jx) * 700, life: 1.05 });
    }
    if (m.rapid > 0) m.rapid -= dt;

    const bp = t >= 0 ? bossAt(t) : { x: CX, y: CY };
    for (let i = Z.bullets.length - 1; i >= 0; i--) {
      const b = Z.bullets[i]; b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0) { Z.bullets.splice(i, 1); continue; }
      if (Math.hypot(b.x - bp.x, b.y - bp.y) < 105 && Z.st !== 'scheduled') {
        Z.bullets.splice(i, 1);
        if (t >= 0 && Z.st === 'fight') { Z.pend++; Z.me.dmg += 10; Z.bossFlash = 0.07; if (Math.random() < 0.3) Z.floats.push({ x: b.x + (Math.random() - 0.5) * 30, y: b.y - 10, t: 0.7, v: '10' }); for (let k = 0; k < 2; k++) Z.parts.push({ x: b.x, y: b.y, vx: (Math.random() - 0.5) * 220, vy: (Math.random() - 0.5) * 220, life: 0.35, c: '#ffd24a' }); }
      }
    }
    if (Z.bossFlash > 0) Z.bossFlash -= dt;
    for (let i = Z.parts.length - 1; i >= 0; i--) { const p = Z.parts[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; if (p.life <= 0) Z.parts.splice(i, 1); }
    for (let i = Z.floats.length - 1; i >= 0; i--) { const f = Z.floats[i]; f.y -= 40 * dt; f.t -= dt; if (f.t <= 0) Z.floats.splice(i, 1); }

    if (t >= 0 && m.alive) {
      const hazards = hazardList(t, ph, bp);
      for (const h of hazards) {
        if (h.k === 'c' && Math.hypot(m.x - h.x, m.y - h.y) < h.r + 9) hurt();
        else if (h.k === 'b') {
          const dx = m.x - h.x, dy = m.y - h.y, c = Math.cos(h.a), s = Math.sin(h.a);
          const along = dx * c + dy * s, perp = Math.abs(-dx * s + dy * c);
          if (along > 0 && perp < h.w) hurt();
        }
      }
      if (Math.hypot(m.x - bp.x, m.y - bp.y) < 95) hurt();
      const pk = pickups(t);
      for (const p of pk) if (!Z.taken.has(p.k) && Math.hypot(m.x - p.x, m.y - p.y) < 34) { Z.taken.add(p.k); if (p.type === 'h') m.hp = Math.min(5, m.hp + 1); else m.rapid = 8; Z.floats.push({ x: p.x, y: p.y - 20, t: 0.9, v: p.type === 'h' ? '+heart' : 'rapid fire' }); }
    }
    const targetZ = (Z.phase === 'bus' || Z.phase === 'lobby') ? Math.min(Z.W / ARENA.w, Z.H / ARENA.h) * 0.95 : Math.max(0.55, Math.min(1.5, Math.min(Z.W, Z.H) / 620));
    const fallBlend = m.fall >= 0 ? Math.min(1, m.fall / 1.5) : (Z.phase === 'play' || Z.phase === 'over') ? 1 : 0;
    const zFinal = Math.max(0.55, Math.min(1.5, Math.min(Z.W, Z.H) / 620));
    const zBus = Math.min(Z.W / ARENA.w, Z.H / ARENA.h) * 0.95;
    const goalZ = Z.phase === 'play' || Z.phase === 'over' ? zFinal : zBus;
    Z.z += (goalZ - Z.z) * Math.min(1, dt * (m.fall >= 0 ? 2.5 : 4));
    if (Z.phase === 'play' || Z.phase === 'over') { Z.camx += (m.x - Z.camx) * Math.min(1, dt * 6); Z.camy += (m.y - Z.camy) * Math.min(1, dt * 6); }
    else { Z.camx += (CX - Z.camx) * Math.min(1, dt * 4); Z.camy += (900 - Z.camy) * Math.min(1, dt * 4); }
    void targetZ; void fallBlend;
  }

  function hazardList(t, ph, bp) {
    const out = [];
    const seed = Z.ev.seed;
    const k0 = Math.floor((t - 6000) / 1500);
    for (let k = Math.max(0, k0); k <= Math.floor(t / 1500); k++) {
      const fire = ph === 3 ? true : ph === 2 ? k % 3 !== 2 : k % 2 === 0;
      if (!fire) continue;
      const T0 = k * 1500, p0 = bossAt(T0), n = 12 + ph * 4, sp = 170 + ph * 30, off = rng(seed + k * 31) * 6.283;
      const age = (t - T0) / 1000;
      for (let i = 0; i < n; i++) { const a = off + i * 6.283 / n; out.push({ k: 'c', x: p0.x + Math.cos(a) * sp * age, y: p0.y + Math.sin(a) * sp * age, r: 8, ring: true }); }
    }
    const cyc = Math.floor(t / 15000), u = t - cyc * 15000;
    if (u >= 1500 && u < 6500) {
      const a0 = rng(seed + cyc * 7) * 6.283, dir = rng(seed + cyc * 3) < 0.5 ? -1 : 1, w = (0.8 + 0.25 * ph) * dir;
      const a = a0 + w * (u - 1500) / 1000;
      out.push({ k: 'b', x: bp.x, y: bp.y, a, w: 17 });
      if (ph === 3) out.push({ k: 'b', x: bp.x, y: bp.y, a: a + Math.PI, w: 17 });
    }
    const sk = Math.floor(t / 6000), su = t - sk * 6000;
    if (su >= 1500 && su < 1850) { const n = 4 + ph * 2; for (let i = 0; i < n; i++) out.push({ k: 'c', x: 200 + rng(seed * 13 + sk * 97 + i * 5) * 2000, y: 200 + rng(seed * 17 + sk * 89 + i * 7) * 1400, r: 100, slam: true }); }
    return out;
  }
  function warnings(t, ph, bp) {
    const out = [];
    const seed = Z.ev.seed;
    const cyc = Math.floor(t / 15000), u = t - cyc * 15000;
    if (u < 1500) { const a0 = rng(seed + cyc * 7) * 6.283; out.push({ k: 'b', x: bp.x, y: bp.y, a: a0, p: u / 1500 }); if (ph === 3) out.push({ k: 'b', x: bp.x, y: bp.y, a: a0 + Math.PI, p: u / 1500 }); }
    const sk = Math.floor(t / 6000), su = t - sk * 6000;
    if (su < 1500) { const n = 4 + ph * 2; for (let i = 0; i < n; i++) out.push({ k: 'c', x: 200 + rng(seed * 13 + sk * 97 + i * 5) * 2000, y: 200 + rng(seed * 17 + sk * 89 + i * 7) * 1400, r: 100, p: su / 1500 }); }
    return out;
  }
  function pickups(t) {
    const out = [];
    const k = Math.floor(t / 12000), u = t - k * 12000;
    if (u < 10000) { out.push({ k, x: 250 + rng(Z.ev.seed + k * 41) * 1900, y: 250 + rng(Z.ev.seed + k * 43) * 1300, type: rng(Z.ev.seed + k * 47) < 0.5 ? 'h' : 'r' }); }
    return out;
  }

  function draw(nowMs) {
    const ev = Z.ev, now = nowS(), t = T(), m = Z.me, ph = phaseNow();
    const W = Z.W, H = Z.H;
    g.setTransform(Z.dpr, 0, 0, Z.dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#0a0606'; g.fillRect(0, 0, W, H);
    const sx = Z.shake ? (Math.random() - 0.5) * Z.shake : 0, sy = Z.shake ? (Math.random() - 0.5) * Z.shake : 0;
    g.save();
    g.translate(W / 2 + sx, H / 2 + sy); g.scale(Z.z, Z.z); g.translate(-Z.camx, -Z.camy);
    g.fillStyle = '#17110f'; g.fillRect(0, 0, ARENA.w, ARENA.h);
    g.fillStyle = '#1d1512';
    for (let y = 0; y < ARENA.h; y += 120) for (let x = ((y / 120) % 2) * 120; x < ARENA.w; x += 240) g.fillRect(x, y, 120, 120);
    g.strokeStyle = '#3a1d14'; g.lineWidth = 10; g.strokeRect(5, 5, ARENA.w - 10, ARENA.h - 10);
    g.strokeStyle = '#2d1a12'; g.lineWidth = 6; g.beginPath(); g.arc(CX, CY, 330, 0, 6.283); g.stroke();
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.fillStyle = '#5a2a1c'; g.fillRect(CX + Math.sin(a) * 330 - 8, CY - Math.cos(a) * 330 - 8, 16, 16); }

    const bp = t >= 0 ? bossAt(t) : { x: CX, y: CY };
    if (t >= 0) {
      const ws = warnings(t, ph, bp);
      for (const w of ws) {
        if (w.k === 'b') { g.save(); g.translate(w.x, w.y); g.rotate(w.a); g.fillStyle = `rgba(255,60,30,${0.15 + w.p * 0.3})`; g.fillRect(0, -17, 1500, 34); g.restore(); }
        else { g.fillStyle = `rgba(255,60,30,${0.12 + w.p * 0.28})`; g.beginPath(); g.arc(w.x, w.y, w.r, 0, 6.283); g.fill(); g.strokeStyle = '#ff5a2b'; g.lineWidth = 4; g.beginPath(); g.arc(w.x, w.y, w.r * w.p, 0, 6.283); g.stroke(); }
      }
      const hz = hazardList(t, ph, bp);
      for (const h of hz) {
        if (h.k === 'b') { g.save(); g.translate(h.x, h.y); g.rotate(h.a); g.fillStyle = '#ff7a45'; g.fillRect(0, -h.w, 1500, h.w * 2); g.fillStyle = '#fff1d6'; g.fillRect(0, -h.w / 3, 1500, h.w * 0.66); g.restore(); }
        else if (h.slam) { g.fillStyle = 'rgba(255,200,120,.75)'; g.beginPath(); g.arc(h.x, h.y, h.r, 0, 6.283); g.fill(); }
        else { g.fillStyle = '#e8b86a'; g.fillRect(Math.round(h.x - 7), Math.round(h.y - 7), 14, 14); g.fillStyle = '#7a2a1a'; g.fillRect(Math.round(h.x - 3), Math.round(h.y - 3), 6, 6); }
      }
      for (const p of pickups(t)) if (!Z.taken.has(p.k)) { g.fillStyle = p.type === 'h' ? '#ff3b5a' : '#4ad6ff'; g.fillRect(p.x - 14, p.y - 14 + Math.sin(nowMs / 200) * 3, 28, 28); g.fillStyle = '#fff'; g.fillRect(p.x - 5, p.y - 5 + Math.sin(nowMs / 200) * 3, 10, 10); }
    }

    if (Z.st !== 'scheduled' || Z.phase === 'lobby') {
      g.save(); g.translate(bp.x, bp.y);
      const sc = 4.2; g.drawImage(bossSprite, -32 * sc, -36 * sc, 64 * sc, 64 * sc);
      const ang = t * 0.0021, ang2 = t * 0.00018;
      g.strokeStyle = '#1a0d09'; g.lineCap = 'butt';
      g.lineWidth = 12; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(ang2) * 62, -Math.cos(ang2) * 62); g.stroke();
      g.lineWidth = 8; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(ang) * 96, -Math.cos(ang) * 96); g.stroke();
      if (Z.bossFlash > 0) { g.globalAlpha = 0.45; g.drawImage(bossSprite, -32 * sc, -36 * sc, 64 * sc, 64 * sc); g.globalCompositeOperation = 'lighter'; g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, 100, 0, 6.283); g.fill(); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; }
      g.restore();
    }

    for (const b of Z.bullets) { g.fillStyle = '#7de3ff'; g.fillRect(Math.round(b.x - 4), Math.round(b.y - 4), 8, 8); g.fillStyle = '#fff'; g.fillRect(Math.round(b.x - 2), Math.round(b.y - 2), 4, 4); }
    for (const p of Z.parts) { g.fillStyle = p.c; g.fillRect(Math.round(p.x), Math.round(p.y), 5, 5); }

    for (const [id, o] of Z.ghosts) {
      if (nowMs - o.seen > 5000) { Z.ghosts.delete(id); continue; }
      o.dx += (o.x - o.dx) * 0.25; o.dy += (o.y - o.dy) * 0.25;
      if (!o.look) o.look = lookOf(o.username);
      drawChar(g, o.dx, o.dy, o.a, o.look, nowMs, o.f);
      g.font = '700 11px ui-monospace,monospace'; g.textAlign = 'center'; g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3;
      g.strokeText(o.name, o.dx, o.dy - 26); g.fillText(o.name, o.dx, o.dy - 26);
    }

    if (m.jumped) {
      const look = S.look || (S.look = lookOf(S.me.username));
      const blink = nowMs < m.inv && Math.floor(nowMs / 90) % 2;
      if (m.fall >= 0) {
        const h = Math.max(0, 1 - m.fall / 1.7), alt = h * h * 900;
        g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.ellipse(m.x, m.y + 14, 16, 6, 0, 0, 6.283); g.fill();
        drawChar(g, m.x, m.y - alt, m.ang, look, nowMs, false);
        g.fillStyle = '#ffb02e'; g.beginPath(); g.moveTo(m.x - 34, m.y - alt - 40); g.quadraticCurveTo(m.x, m.y - alt - 90, m.x + 34, m.y - alt - 40); g.closePath(); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(m.x - 30, m.y - alt - 40); g.lineTo(m.x - 2, m.y - alt - 14); g.moveTo(m.x + 30, m.y - alt - 40); g.lineTo(m.x + 2, m.y - alt - 14); g.stroke();
      } else if (m.alive) { if (!blink) drawChar(g, m.x, m.y, m.ang, look, m.moving ? nowMs : 0, Z.firing); }
      else { g.fillStyle = '#ff3b3b'; g.fillRect(m.x - 12, m.y - 4, 24, 8); }
    }
    if (Z.phase === 'bus' || Z.phase === 'lobby' || (now < ev.startsAt + bms() + 2000 && Z.phase !== 'over')) {
      const bpos = busPos();
      if (now < ev.startsAt + bms() + 1500) {
        g.save(); g.translate(bpos.x, bpos.y); g.rotate(Math.atan2(1480, 2160));
        g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(-70, 40, 140, 30);
        g.fillStyle = '#3a8dde'; g.fillRect(-70, -26, 140, 52); g.fillStyle = '#9fd0ff'; g.fillRect(-60, -18, 120, 14); g.fillStyle = '#ffb02e'; g.fillRect(-70, -26, 14, 52);
        g.fillStyle = '#1a1a1a'; for (let i = -50; i <= 40; i += 30) g.fillRect(i, 22, 14, 10);
        g.fillStyle = '#fff'; g.fillRect(-20, 4, 70, 8);
        g.restore();
      }
    }
    for (const f of Z.floats) { g.font = '800 16px ui-monospace,monospace'; g.textAlign = 'center'; g.fillStyle = '#ffe14a'; g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeText(f.v, f.x, f.y); g.fillText(f.v, f.x, f.y); }
    g.restore();

    if (Z.flash > 0) { g.fillStyle = `rgba(255,40,40,${Z.flash})`; g.fillRect(0, 0, W, H); }
    if (Z.touch) for (const k of ['l', 'r']) { const s = Z.sticks[k]; if (s) { g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 3; g.beginPath(); g.arc(s.ox, s.oy, 56, 0, 6.283); g.stroke(); g.fillStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.arc(s.ox + s.x * 56, s.oy + s.y * 56, 24, 0, 6.283); g.fill(); } }
    if (Z.phase === 'lobby' && !Z.over) {
      g.fillStyle = '#000a'; g.fillRect(0, H / 2 - 50, W, 100);
      g.fillStyle = '#fff'; g.font = '800 26px ui-sans-serif,system-ui'; g.textAlign = 'center';
      g.fillText(now < ev.startsAt ? 'the bus leaves in ' + mmss(ev.startsAt - now) : 'joining...', W / 2, H / 2 + 8);
      g.font = '600 14px ui-sans-serif,system-ui'; g.fillStyle = '#ffd9c7'; g.fillText('wasd to move, mouse to aim and shoot. on phones use the two thumb sticks', W / 2, H / 2 + 34);
    }
    if (m.jumped && !m.alive && m.fall < 0 && m.hp <= 0) { g.fillStyle = '#000a'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.font = '800 28px ui-sans-serif,system-ui'; g.textAlign = 'center'; g.fillText('respawning in ' + Math.max(0, Math.ceil(5 - (nowMs - m.deadAt) / 1000)), W / 2, H / 2); }
  }

  Z.onSnap = (s) => {
    Z.hp = s.hp; Z.max = s.max; Z.top = s.top || [];
    const meU = S.me.username, t = performance.now();
    for (const p of s.p) {
      if (p[5] === meU) continue;
      let o = Z.ghosts.get(p[0]);
      if (!o) { o = { dx: p[1], dy: p[2], x: p[1], y: p[2], a: p[3], f: p[4], username: p[5], name: p[6], seen: t }; Z.ghosts.set(p[0], o); }
      o.x = p[1]; o.y = p[2]; o.a = p[3]; o.f = p[4]; o.seen = t;
    }
  };
  say(B.ev.test ? 'TEST FIGHT' : 'GET READY', 2000);
  Z.raf = requestAnimationFrame(loop);
  if (B.ev.startsAt - nowS() <= 15000) { Z.joinSent = true; sendWS({ t: 'boss_join' }); }
  renderPill();
}

function onBoss(m) {
  if (m.t === 'boss_state') {
    const prevId = B.ev && B.ev.id;
    if (m.ev) B.off = m.ev.now - Date.now();
    B.ev = m.ev;
    if (m.ev && live()) { announce(m.ev); }
    if (G && m.ev) { G.ev = { ...G.ev, ...m.ev }; if (m.ev.id !== prevId && prevId) { G.leave(); } }
    if (!m.ev && G && G.phase !== 'over') G.leave();
    if (!m.ev) load();
    renderPill();
  } else if (m.t === 'boss_joined' && G) { G.joined = true; B.off = m.ev.now - Date.now(); G.ev = { ...G.ev, ...m.ev }; G.hp = m.ev.hp; G.max = m.ev.max; G.me.dmg = m.dmg || 0; }
  else if (m.t === 'boss_snap' && G) G.onSnap(m);
  else if (m.t === 'boss_me' && G) { G.me.dmg = m.dmg; G.me.rank = m.rank; G.me.of = m.of; }
  else if (m.t === 'boss_denied') { toast('you cannot join this fight', 'error'); if (G) G.leave(); }
  else if (m.t === 'boss_end') {
    B.ev = m.ev; renderPill();
    if (G) G.showEnd(m);
    else if (m.top && m.top.length) { const me = S.me && m.top.find((r) => r.username === S.me.username); toast(me && me.mins ? `boss fight over. you placed #${me.rank} and won beta!` : `boss fight over. top damage: ${m.top[0].name || m.top[0].username}`, me && me.mins ? 'success' : undefined); }
  }
}

async function adminBoss(box) {
  box.replaceChildren(el('div', { class: 'muted pad' }, '...'));
  let d;
  try { d = await api('GET', '/api/admin/boss', null, { quiet: true }); } catch (e) { return box.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
  const err = el('div', { class: 'form-err' });
  const status = el('div', { class: 'small muted', style: 'margin:8px 0' });
  const show = (x) => { status.textContent = x.ev ? `${x.ev.test ? 'test ' : ''}fight ${x.ev.status}: ${x.ev.hp.toLocaleString()} / ${x.ev.max.toLocaleString()} hp, ${x.ev.n} fighters` : 'no fight running. next: ' + ((x.next || []).map((t) => new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })).join(', ') || 'none'); };
  show(d);
  const t12 = (hhmm) => { const [h, mi] = hhmm.split(':').map(Number); return `${h % 12 || 12}:${pad(mi)} ${h < 12 ? 'AM' : 'PM'}`; };
  const times = el('div', { class: 'row gap wraprow' });
  let list = [...d.cfg.times];
  const drawTimes = () => times.replaceChildren(...list.map((t, i) => el('span', { class: 'tag' }, t12(t), d.isOwner ? el('button', { class: 'icon-btn tiny', style: 'margin-left:4px', onclick: () => { list.splice(i, 1); drawTimes(); } }, ic('x', 12)) : null)));
  drawTimes();
  const add = el('input', { type: 'time', value: '12:00', style: 'width:130px' });
  const en = el('input', { type: 'checkbox' }); en.checked = d.cfg.enabled;
  const de = el('input', { type: 'checkbox' }); de.checked = d.cfg.dropEvent;
  const act = async (fn) => { err.textContent = ''; try { const x = await fn(); if (x) show({ ...d, ...x }); } catch (e) { err.textContent = e.message; } };
  const refresh = async () => { try { d = await api('GET', '/api/admin/boss', null, { quiet: true }); show(d); } catch {} };
  const hist = el('div', { class: 'small muted' }, (d.history || []).map((h) => el('div', null, `${new Date(h.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}: ${h.test ? 'test, ' : ''}${h.won ? 'boss defeated' : 'boss survived'}, ${h.n} fighters`)));
  const owner = d.isOwner;
  box.replaceChildren(el('div', { class: 'pad' },
    el('h4', { style: 'margin:0 0 6px' }, 'boss fights'),
    el('p', { class: 'muted small', style: 'margin-top:0' }, 'all times are central time. fights last 10 minutes after a 30 second bus ride. top 10 damage win beta.'),
    times,
    owner ? el('div', { class: 'row gap', style: 'margin-top:8px' }, add, el('button', { class: 'btn small', onclick: () => { if (add.value && !list.includes(add.value) && list.length < 6) { list.push(add.value); list.sort(); drawTimes(); } } }, 'add time')) : null,
    owner ? el('label', { class: 'checkrow' }, en, 'run scheduled fights') : null,
    owner ? el('label', { class: 'checkrow' }, de, 'also fight when the doomsclock hits zero') : null,
    owner ? el('button', { class: 'btn primary', style: 'margin-top:8px', onclick: () => act(async () => { const x = await api('PUT', '/api/admin/boss', { times: list, enabled: en.checked, dropEvent: de.checked }, { quiet: true }); toast('saved', 'success'); return { next: x.next }; }) }, 'save schedule') : el('p', { class: 'muted small' }, 'only the owner can change the schedule.'),
    err, status,
    el('div', { class: 'row gap wraprow' },
      el('button', { class: 'btn', onclick: () => act(async () => { await api('POST', '/api/admin/boss/start', { test: true }, { quiet: true }); toast('test fight starts in 20 seconds, only admins can see it', 'success'); await refresh(); }) }, 'start test fight'),
      owner ? el('button', { class: 'btn', onclick: () => act(async () => { if (!(await window.__ui.confirmModal('start a real fight now?', 'everyone gets the bus in 20 seconds and the top 10 win beta.', 'start'))) return; await api('POST', '/api/admin/boss/start', {}, { quiet: true }); await refresh(); }) }, 'start real fight now') : null,
      el('button', { class: 'btn danger', onclick: () => act(async () => { await api('POST', '/api/admin/boss/stop', {}, { quiet: true }); await refresh(); }) }, 'stop fight')),
    el('h4', { style: 'margin:14px 0 4px' }, 'recent'), hist));
}

setInterval(() => { if (live() && S.me) renderPill(); }, 1000);
setInterval(() => { if (live() && S.me && !G) load(); }, 60000);
setTimeout(load, 5000);
Object.assign(window.__ext, { _boss: () => G, onBoss, bossLoad: load, adminBoss, openBoss: infoModal });
}

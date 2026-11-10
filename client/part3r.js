(() => {
'use strict';
const C = window.__core, S = C.S, el = C.el, ic = C.ic, api = C.api, toast = C.toast;
const D = { at: null, off: 0, hasVideo: false, released: false, timer: null, phase: 'idle', video: null, url: null, shade: null, pill: null, raf: 0 };
S.drop = D;

const seenKey = () => 'doom_seen_' + D.at;
const seen = () => { try { return localStorage.getItem(seenKey()) === '1'; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(seenKey(), '1'); } catch {} };
const now = () => Date.now() + D.off;
const pad = (n) => String(n).padStart(2, '0');
const parts = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 }; };
const label = (ms) => { const p = parts(ms); return p.d ? `${p.d}d ${pad(p.h)}:${pad(p.m)}:${pad(p.s)}` : p.h ? `${p.h}:${pad(p.m)}:${pad(p.s)}` : `${pad(p.m)}:${pad(p.s)}`; };

const css = el('style', null, `
.doompill{position:fixed;top:calc(env(safe-area-inset-top,0px) + 8px);left:50%;transform:translateX(-50%);z-index:8000;display:flex;align-items:center;gap:8px;padding:7px 14px 7px 11px;border-radius:999px;background:#2a0f0b;color:#ffd9c7;border:1px solid #7a2a1a;box-shadow:0 6px 24px rgba(180,50,20,.35);font:700 13px/1 var(--mono);letter-spacing:.04em;pointer-events:none;animation:doomglow 2.4s ease-in-out infinite}
.doompill b{font-family:var(--display);font-weight:800;letter-spacing:.02em;font-size:13px;color:#ff9a6b}
@keyframes doomglow{0%,100%{box-shadow:0 6px 24px rgba(180,50,20,.28)}50%{box-shadow:0 6px 34px rgba(220,70,30,.6)}}
.doomshade{position:fixed;inset:0;z-index:99999;background:#050303;color:#ffd9c7;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;user-select:none;-webkit-user-select:none;touch-action:none;animation:doomin .6s var(--ease)}
@keyframes doomin{from{opacity:0}to{opacity:1}}
.doomshade .t{font:800 clamp(14px,2.4vw,20px)/1 var(--display);letter-spacing:.38em;text-transform:uppercase;color:#ff7a45;margin-bottom:22px}
.doomshade .n{font:800 clamp(64px,19vw,220px)/1 var(--display);font-variant-numeric:tabular-nums;color:#fff1e6;text-shadow:0 0 40px rgba(255,90,40,.55)}
.doomshade.hot .n{animation:doompulse 1s ease-in-out infinite;color:#ff5a2b}
@keyframes doompulse{0%,100%{transform:scale(1)}50%{transform:scale(1.045)}}
.doomshade .s{margin-top:22px;color:#a08170;font:600 clamp(13px,1.8vw,16px)/1.4 var(--body)}
.doomshade video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;pointer-events:none}
.doomshade .tap{position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.72);cursor:pointer}
.doomshade .tap span{padding:16px 30px;border-radius:999px;background:#ff5a2b;color:#1b0803;font:800 17px var(--body)}
.doomshade .snd{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 22px);z-index:3;padding:10px 20px;border-radius:999px;background:rgba(255,90,43,.92);color:#1b0803;font:800 14px var(--body);cursor:pointer}
.doomshade.fade{animation:doomout 1.1s ease forwards}
@keyframes doomout{to{opacity:0}}
`);
document.head.appendChild(css);

function ensurePill() {
  if (!D.pill) { D.pill = el('div', { class: 'doompill' }, ic('timer', 14), el('b', null, 'THE DOOMSCLOCK'), el('span', { class: 'v' })); document.body.appendChild(D.pill); }
  return D.pill;
}
function dropPill() { if (D.pill) { D.pill.remove(); D.pill = null; } }

function shadeEl() {
  if (D.shade) return D.shade;
  D.shade = el('div', { class: 'doomshade' }, el('div', { class: 't' }, 'the doomsclock'), el('div', { class: 'n' }), el('div', { class: 's' }, ''));
  D.shade.addEventListener('contextmenu', (e) => e.preventDefault());
  D.shade.addEventListener('keydown', (e) => e.preventDefault(), true);
  document.body.appendChild(D.shade);
  return D.shade;
}
function dropShade(fade) {
  const sh = D.shade; if (!sh) return;
  D.shade = null;
  if (fade) { sh.classList.add('fade'); setTimeout(() => sh.remove(), 1200); } else sh.remove();
}

async function preload() {
  if (D.url || !D.hasVideo) return;
  D.url = 'pending';
  try {
    const d = await api('GET', '/api/drop/video-url', null, { quiet: true });
    D.url = API_BASE() + d.url;
    const v = document.createElement('video');
    v.preload = 'auto'; v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.controls = false; v.disablePictureInPicture = true;
    v.setAttribute('controlslist', 'nodownload noplaybackrate noremoteplayback');
    v.src = D.url; v.load();
    D.video = v;
  } catch { D.url = null; }
}
const API_BASE = () => (window.__core.API || '');

function unlock(withVideo) {
  if (D.phase === 'done') return;
  D.phase = 'done'; markSeen();
  cancelAnimationFrame(D.raf); clearInterval(D.timer);
  dropPill(); dropShade(true);
  if (D.video) { try { D.video.pause(); } catch {} D.video.removeAttribute('src'); D.video.load(); D.video = null; }
  window.__ui.renderAll();
  setTimeout(() => toast('the doomsclock hit zero. the update is here', 'success'), 900); if (window.__ext.bossLoad) setTimeout(window.__ext.bossLoad, 1500);
}

async function playVideo() {
  const sh = shadeEl(); sh.classList.remove('hot');
  const v = D.video || document.createElement('video');
  if (!D.video) { v.playsInline = true; v.setAttribute('playsinline', ''); v.controls = false; v.src = D.url && D.url !== 'pending' ? D.url : ''; D.video = v; }
  if (!v.src) return unlock(false);
  sh.replaceChildren(v);
  const expected = () => Math.max(0, (now() - D.at) / 1000);
  const start = () => {
    const dur = v.duration;
    if (isFinite(dur) && expected() >= dur - 0.4) return unlock(true);
    try { v.currentTime = Math.min(expected(), (dur || 1e9) - 0.2); } catch {}
    v.muted = false;
    const p = v.play();
    const askTap = () => {
      v.muted = true;
      v.play().then(() => {
        const b = el('div', { class: 'snd', onclick: () => { v.muted = false; b.remove(); } }, 'tap for sound');
        sh.appendChild(b);
      }).catch(() => {
        const t = el('div', { class: 'tap', onclick: () => { v.muted = false; v.currentTime = Math.min(expected(), (v.duration || 1e9) - 0.2); v.play().then(() => t.remove()).catch(() => {}); } }, el('span', null, 'tap to watch'));
        sh.appendChild(t);
      });
    };
    if (p && p.catch) p.catch(askTap);
  };
  v.onpause = () => { if (D.phase === 'video' && !v.ended) v.play().catch(() => {}); };
  v.onended = () => unlock(true);
  v.onerror = () => unlock(false);
  v.onseeking = () => { const e = expected(); if (Math.abs(v.currentTime - e) > 2.5 && !v.ended) { try { v.currentTime = e; } catch {} } };
  D.phase = 'video';
  if (v.readyState >= 1) start(); else v.onloadedmetadata = start;
  setTimeout(() => { if (D.phase === 'video' && !v.duration) unlock(false); }, 20000);
  const guard = () => { if (D.phase !== 'video') return; const e = expected(); if (!v.paused && Math.abs(v.currentTime - e) > 1.2 && !v.seeking) { try { v.currentTime = e; } catch {} } D.raf = setTimeout(guard, 2500); };
  D.raf = setTimeout(guard, 2500);
}

function tick() {
  if (!D.at) return;
  const left = D.at - now();
  if (D.phase === 'done') return;
  if (left > 0) { ensurePill().querySelector('.v').textContent = label(left); return; }
  if (seen() || D.released && now() - D.at > 6 * 3600_000) return finishQuiet();
  unlock(false);
}
function finishQuiet() { D.phase = 'done'; clearInterval(D.timer); dropPill(); dropShade(false); window.__ui.renderAll(); }

function apply(d) {
  const t0 = Date.now();
  D.off = d.now - t0;
  const changed = d.at !== D.at;
  D.hasVideo = d.hasVideo; D.released = d.released;
  if (changed) {
    D.at = d.at; D.phase = 'idle'; D.url = null;
    if (D.video) { try { D.video.pause(); } catch {} D.video = null; }
    clearInterval(D.timer); dropPill(); dropShade(false);
    if (!D.at) return;
    D.timer = setInterval(tick, 250); tick();
  }
  if (!D.at) { clearInterval(D.timer); dropPill(); }
  if (D.at && d.hasVideo && D.phase === 'idle') tick();
}

async function sync() {
  try { const t0 = Date.now(); const d = await fetch(window.__core.API + '/api/drop').then((r) => r.json()); const rtt = Date.now() - t0; d.now += rtt / 2; apply(d); } catch {}
}
function onDrop(m) { if (m.t === 'drop_update' && m.drop) apply({ ...m.drop }); }

const dropOn = () => !!(D.released || (D.at && now() >= D.at && D.phase === 'done') || (S.me && S.me.isAdmin));
setInterval(sync, 60_000);

function fmtLocal(ms) { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }

async function adminDrop(box) {
  box.replaceChildren(el('div', { class: 'muted pad' }, '...'));
  let d;
  try { d = await api('GET', '/api/admin/drop', null, { quiet: true }); } catch (e) { return box.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
  const status = el('div', { class: 'small muted', style: 'margin:8px 0' }, d.at ? 'drops ' + new Date(d.at).toLocaleString() : 'no drop scheduled');
  const bossBox = el('div', null);
  const bossPart = () => { if (window.__ext.adminBoss) window.__ext.adminBoss(bossBox); };
  if (!d.isOwner) return box.replaceChildren(el('p', { class: 'muted pad' }, 'only the owner can change the doomsclock.'), status, bossBox) || bossPart();
  const when = el('input', { type: 'datetime-local', value: d.at ? fmtLocal(d.at) : '' });
  const err = el('div', { class: 'form-err' });
  const save = el('button', { class: 'btn primary grow', onclick: async () => {
    err.textContent = '';
    const at = when.value ? new Date(when.value).getTime() : null;
    if (!at) { err.textContent = 'pick a date and time'; return; }
    try { const x = await api('PUT', '/api/admin/drop', { at }, { quiet: true }); status.textContent = 'drops ' + new Date(x.at).toLocaleString(); toast('the doomsclock is set', 'success'); } catch (e) { err.textContent = e.message; }
  } }, ic('timer', 16), 'set the doomsclock');
  const clear = el('button', { class: 'btn danger', onclick: async () => {
    if (!(await window.__ui.confirmModal('cancel the doomsclock?', 'the countdown disappears for everyone.', 'cancel it'))) return;
    try { await api('DELETE', '/api/admin/drop', null, { quiet: true }); status.textContent = 'no drop scheduled'; when.value = ''; } catch (e) { err.textContent = e.message; }
  } }, 'cancel');
  box.replaceChildren(el('div', { class: 'pad' },
    el('p', { class: 'muted small', style: 'margin-top:0' }, 'everyone sees a countdown. at zero the new features unlock and a minute later the first boss fight starts. admins can use the new features early.'),
    el('label', null, 'drop time (your local time)', when), err, status, el('div', { class: 'row gap' }, save, clear)), el('hr'), bossBox);
  bossPart();
}

Object.assign(window.__ext, { dropSync: sync, onDrop, dropOn, adminDrop });
})();

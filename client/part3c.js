/* ===== Chatroom client: beta features (beta tab, voice notes, polls, games, stickers, folders, edits, scheduling, timers, profile banners) ===== */
(() => {
'use strict';
const C = window.__core, U = window.__ui;
const { S, el, $, ic, avatar, api, toast, tone, convOf, sendPayload, encryptPayload, decryptMsg, convTitle, unb64, b64 } = C;
const { modal, confirmModal, startDM } = U;
const X0 = window.__ext;                                     // the older extras, merged into below

// ---------- shared bits ----------
const goBeta = () => { document.querySelectorAll('.modal-back').forEach((n) => n.querySelector('.modal-head button') && n.querySelector('.modal-head button').click()); S.view = 'beta'; U.renderAll(); };
function needBeta(what) {                                    // true when beta is on, otherwise sends the person to the beta tab
  if (C.betaActive()) return true;
  toast(`${what} is a beta feature`, 'error', goBeta);
  goBeta();
  return false;
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? +v : lo));
const bannerCss = (b) => { const cs = String(b || '').split(',').filter((x) => /^#[0-9a-f]{6}$/i.test(x)); return cs.length > 1 ? `linear-gradient(135deg,${cs[0]},${cs[1]})` : cs[0] || ''; };
const banner = (b) => (bannerCss(b) ? el('div', { class: 'banner', style: `background:${bannerCss(b)}` }) : null);
const ttlLabel = (s) => (s % 86400 === 0 ? `${s / 86400} day${s === 86400 ? '' : 's'}` : s % 3600 === 0 ? `${s / 3600} hour${s === 3600 ? '' : 's'}` : `${Math.round(s / 60)} minutes`);
const curConv = () => convOf(S.active);

// ---------- popover under the + button in the composer ----------
let plus = null;
const closePlus = () => { if (plus) { plus.remove(); plus = null; } };
document.addEventListener('mousedown', (e) => { if (plus && !plus.contains(e.target) && !e.target.closest('[data-plus]')) closePlus(); });
function plusMenu(anchor, c, input) {
  const had = !!plus; closePlus(); if (had) return;
  anchor.dataset.plus = 1;
  const on = C.betaActive();
  const item = (icon, label, fn, free) => el('button', { class: 'plusitem', onclick: () => { closePlus(); fn(); } }, ic(icon, 18), el('span', { class: 'grow' }, label), on || free ? null : el('span', { class: 'tag gold' }, 'beta'));
  const noImg = c.isPublic || c.systemKind;
  plus = el('div', { class: 'plusmenu' },
    noImg ? null : item('image', 'photo', () => window.__ext.pickPhoto(c)),
    c.type === 'dm' ? item('eye', 'view once', () => window.__ext.onceModal(c), true) : null,
    item('mic', 'voice note', () => needBeta('voice notes') && voiceModal(c)),
    item('sticker', 'sticker', () => needBeta('stickers') && stickerPicker(c)),
    item('poll', 'poll', () => needBeta('polls') && pollModal(c)),
    item('calendar', 'schedule a message', () => needBeta('scheduled messages') && scheduleModal(c, input)),
    c.type === 'dm' ? item('grid', 'tic-tac-toe', () => needBeta('mini games') && startGame(c, 'ttt')) : null,
    c.type === 'dm' ? item('users', 'rock paper scissors', () => needBeta('mini games') && startGame(c, 'rps')) : null,
    c.type === 'dm' ? item('grid', 'connect 4', () => needBeta('mini games') && startGame(c, 'c4')) : null,
    c.type === 'dm' ? item('book', 'word duel', () => needBeta('mini games') && startGame(c, 'wd')) : null,
    c.type === 'dm' ? item('trophy', 'trivia duel', () => needBeta('mini games') && startGame(c, 'tr')) : null,
    item('bell', 'my reminders', () => window.__ext.remindersModal()),
    item('palette', 'chat wallpaper', () => window.__ext.wallpaperModal(c)));
  document.body.append(plus);
  const r = anchor.getBoundingClientRect();
  plus.style.left = Math.max(8, Math.min(r.left, innerWidth - plus.offsetWidth - 8)) + 'px';
  plus.style.top = Math.max(8, r.top - plus.offsetHeight - 8) + 'px';
}

// ---------- editing your own message ----------
function editMessage(c, m) {
  if (!needBeta('editing')) return;
  const ta = el('textarea', { rows: 4, maxLength: 2000, value: (m._p && m._p.text) || '' });
  ta.value = (m._p && m._p.text) || '';
  const save = el('button', { class: 'btn primary', onclick: async () => {
    const text = C.expandShortcodes(ta.value.trim());
    if (!text) return;
    if (C.F.check(text)) return toast('keep it clean, that was not saved', 'error');
    save.disabled = true;
    try {
      const e = await encryptPayload(c, { t: 'text', text });
      const r = await api('PATCH', `/api/messages/${m.id}`, e, { quiet: true });
      Object.assign(m, { ciphertext: e.ciphertext, iv: e.iv, keyVersion: e.keyVersion, editedAt: r.editedAt, _p: { t: 'text', text } });
      if (c.lastMessage && c.lastMessage.id === m.id) { c.lastMessage = m; c._preview = C.previewText(m._p, true); }
      mm.close(); U.renderSide(); U.renderMessages(c);
    } catch (err) { toast(err.data && err.data.error === 'blocked_word' ? 'that was blocked, keep it clean' : err.message, 'error'); save.disabled = false; }
  } }, ic('check', 16), 'save');
  const mm = modal('edit message', el('div', null, ta, el('div', { class: 'row gap end', style: 'margin-top:12px' }, save)));
  setTimeout(() => ta.focus(), 50);
}

// ---------- voice notes (10 seconds max) ----------
const VOICE_MAX = 10, VOICE_BYTES = 26000;
function voiceModal(c) {
  if (!navigator.mediaDevices || !window.MediaRecorder) return toast('this browser cannot record audio', 'error');
  const body = el('div', { class: 'voicebox' });
  let rec = null, stream = null, chunks = [], t0 = 0, tick = 0, blob = null, secs = 0, mime = '';
  const stopStream = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
  const m = modal('voice note', body, { onClose: () => { clearInterval(tick); try { rec && rec.state === 'recording' && rec.stop(); } catch {} stopStream(); } });
  const bar = el('div', { class: 'vbar' }, el('i'));
  const label = el('div', { class: 'muted' }, 'up to 10 seconds');
  const go = el('button', { class: 'btn primary wide' }, ic('mic', 18), 'start recording');
  const idle = () => { body.replaceChildren(bar, label, go); bar.firstChild.style.width = '0'; };
  async function start() {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('allow the microphone to record', 'error'); }
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    mime = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    chunks = [];
    try { rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 16000 }); } catch { stopStream(); return toast('this browser cannot record audio', 'error'); }
    rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
    rec.onstop = () => { clearInterval(tick); stopStream(); blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }); secs = Math.min(VOICE_MAX, Math.max(1, Math.round((Date.now() - t0) / 1000))); review(); };
    rec.start(); t0 = Date.now();
    go.replaceChildren(ic('stop', 18), 'stop'); go.onclick = () => rec.state === 'recording' && rec.stop();
    tick = setInterval(() => {
      const s = (Date.now() - t0) / 1000;
      bar.firstChild.style.width = Math.min(100, s / VOICE_MAX * 100) + '%'; label.textContent = `${s.toFixed(1)}s of 10`;
      if (s >= VOICE_MAX) rec.stop();
    }, 100);
  }
  go.onclick = start;
  function review() {
    if (blob.size > VOICE_BYTES) { toast('that recording is too big, try again', 'error'); return idle(); }
    const url = URL.createObjectURL(blob);
    const audio = el('audio', { controls: true, src: url, style: 'width:100%' });
    const send = el('button', { class: 'btn primary grow', onclick: async () => {
      send.disabled = true;
      const buf = new Uint8Array(await blob.arrayBuffer());
      const ok = await sendPayload(c, { t: 'voice', d: secs, mime: blob.type.split(';')[0] || 'audio/webm', a: b64(buf) });
      if (ok) m.close(); else send.disabled = false;
    } }, ic('send', 16), 'send');
    body.replaceChildren(audio, el('div', { class: 'row gap', style: 'margin-top:12px' }, el('button', { class: 'btn grow', onclick: () => { URL.revokeObjectURL(url); idle(); } }, ic('undo', 16), 'redo'), send));
  }
  idle();
}
function voiceBody(p) {
  const okMime = ['audio/webm', 'audio/mp4', 'audio/ogg'];
  if (typeof p.a !== 'string' || p.a.length > 45000 || !okMime.includes(p.mime)) return el('div', { class: 'mtext muted-i' }, 'voice note unavailable');
  const d = clamp(p.d, 1, VOICE_MAX);
  let audio = null;
  const fill = el('i');
  const btn = el('button', { class: 'playbtn', title: 'play' }, ic('play', 18));
  btn.onclick = () => {
    if (!audio) {
      try { audio = new Audio(URL.createObjectURL(new Blob([unb64(p.a)], { type: p.mime }))); } catch { return toast('could not play that', 'error'); }
      audio.ontimeupdate = () => { fill.style.width = Math.min(100, audio.currentTime / d * 100) + '%'; };
      audio.onended = () => { btn.replaceChildren(ic('play', 18)); fill.style.width = '0'; };
    }
    if (audio.paused) { audio.play().catch(() => {}); btn.replaceChildren(ic('stop', 18)); } else { audio.pause(); btn.replaceChildren(ic('play', 18)); }
  };
  return el('div', { class: 'voicemsg' }, btn, el('div', { class: 'vbar' }, fill), el('span', { class: 'muted small' }, d + 's'));
}

// ---------- stickers (image links only, cropped to a square) ----------
const stickerOkUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && String(u).length <= 400; } catch { return false; } };
const cropOf = (c) => { c = c || {}; return { x: clamp(c.x ?? 50, 0, 100), y: clamp(c.y ?? 50, 0, 100), z: clamp(c.z ?? 1, 1, 4) }; };
function stickerEl(url, crop, size) {
  const cr = cropOf(crop);
  const img = el('img', { src: url, alt: 'sticker', loading: 'lazy', referrerPolicy: 'no-referrer', draggable: false, style: `object-position:${cr.x}% ${cr.y}%;transform:scale(${cr.z});transform-origin:${cr.x}% ${cr.y}%` });
  const box = el('div', { class: 'stk', style: size ? `width:${size}px;height:${size}px` : '' }, img);
  img.onerror = () => box.replaceChildren(el('span', { class: 'muted small' }, 'image gone'));
  return box;
}
function stickerBody(p) {
  if (!stickerOkUrl(p.url)) return el('div', { class: 'mtext muted-i' }, 'sticker blocked');
  return stickerEl(p.url, p.crop, 0);
}
async function loadStickers() { try { S.stickers = (await api('GET', '/api/stickers', null, { quiet: true })).stickers; } catch { S.stickers = S.stickers || []; } return S.stickers; }
async function stickerPicker(c) {
  const grid = el('div', { class: 'stkgrid' });
  const m = modal('stickers', el('div', null, grid, el('button', { class: 'btn wide', style: 'margin-top:12px', onclick: () => { m.close(); stickerManage(); } }, ic('plus', 16), 'add or edit stickers')));
  const list = await loadStickers();
  if (!list.length) return grid.replaceChildren(el('div', { class: 'muted pad' }, 'no stickers yet, add one with an image link'));
  grid.replaceChildren(...list.map((s) => el('button', { class: 'stkbtn', title: ':' + s.name + ':', onclick: async () => { if (await sendPayload(c, { t: 'sticker', url: s.url, crop: s.crop, name: s.name })) m.close(); } }, stickerEl(s.url, s.crop, 84))));
}
function cropEditor(url, crop, onChange) {                   // drag to move, slider to zoom; what you see is what gets saved
  let cr = cropOf(crop);
  const view = el('div', { class: 'cropview' });
  const draw = () => view.replaceChildren(stickerEl(url, cr, 0));
  const zoom = el('input', { type: 'range', min: 1, max: 4, step: 0.05, value: cr.z, oninput: () => { cr.z = +zoom.value; draw(); onChange(cr); } });
  let drag = null;
  view.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; view.setPointerCapture(e.pointerId); });
  view.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const s = view.clientWidth || 200;
    cr.x = clamp(cr.x - (e.clientX - drag.x) / s * 100, 0, 100); cr.y = clamp(cr.y - (e.clientY - drag.y) / s * 100, 0, 100);
    drag = { x: e.clientX, y: e.clientY }; draw(); onChange(cr);
  });
  view.addEventListener('pointerup', () => { drag = null; });
  draw();
  return el('div', { class: 'cropper' }, view, el('div', { class: 'row gap', style: 'align-items:center' }, el('span', { class: 'muted small' }, 'zoom'), zoom), el('div', { class: 'muted small' }, 'drag the picture to line it up'));
}
function howToLink() {
  const gif = el('img', { class: 'howto', src: API_BASE() + '/howto-image-link.gif', alt: 'how to copy an image link' });
  gif.onerror = () => gif.remove();
  return el('details', { class: 'howtobox' }, el('summary', null, 'how do i get an image link?'),
    gif,
    el('ol', { class: 'tips' }, el('li', null, 'find the picture online'), el('li', null, 'right click it and pick "copy image address" (on a phone, hold the picture and pick "copy image link")'), el('li', null, 'paste it here. it should be a link to the picture itself, often ending in .png .jpg .gif or .webp')));
}
const API_BASE = () => (C.SAME_ORIGIN ? '' : C.API);
function stickerManage() {
  if (!needBeta('stickers')) return;
  const listBox = el('div', { class: 'stklist' });
  const m = modal('your stickers', el('div', null, listBox), { wide: true });
  async function draw() {
    const list = await loadStickers();
    const name = el('input', { placeholder: 'name (letters, numbers, _)', maxLength: 16 });
    const link = el('input', { placeholder: 'https://... image link' });
    const stage = el('div');
    let crop = { x: 50, y: 50, z: 1 }, shown = '';
    const add = el('button', { class: 'btn primary', disabled: true, onclick: async () => {
      try { await api('POST', '/api/stickers', { name: name.value, url: link.value.trim(), crop }, { quiet: true }); toast('sticker added', 'success'); draw(); }
      catch (e) { toast(e.message, 'error'); }
    } }, ic('plus', 16), 'add sticker');
    link.oninput = () => {
      const u = link.value.trim();
      if (!stickerOkUrl(u)) { stage.replaceChildren(); add.disabled = true; shown = ''; return; }
      if (u === shown) return; shown = u; crop = { x: 50, y: 50, z: 1 };
      stage.replaceChildren(cropEditor(u, crop, (c2) => { crop = { ...c2 }; })); add.disabled = false;
    };
    listBox.replaceChildren(
      list.length ? el('div', { class: 'stkgrid' }, list.map((s) => el('div', { class: 'stkcell' }, stickerEl(s.url, s.crop, 84), el('div', { class: 'small' }, ':' + s.name + ':'),
        el('div', { class: 'row gap-s' }, el('button', { class: 'icon-btn tiny', title: 'crop', onclick: () => cropExisting(s, draw) }, ic('edit', 14)), el('button', { class: 'icon-btn tiny', title: 'delete', onclick: async () => { try { await api('DELETE', '/api/stickers/' + s.id); draw(); } catch (e) { toast(e.message, 'error'); } } }, ic('trash', 14)))))) : el('div', { class: 'muted pad' }, 'nothing here yet'),
      el('h4', null, 'add one'), el('div', { class: 'row gap' }, name, link), stage, howToLink(), el('div', { class: 'row end', style: 'margin-top:10px' }, add));
  }
  draw();
}
function cropExisting(s, done) {
  let crop = cropOf(s.crop);
  const mm = modal('crop :' + s.name + ':', el('div', null, cropEditor(s.url, crop, (c2) => { crop = { ...c2 }; }), el('div', { class: 'row gap end', style: 'margin-top:12px' }, el('button', { class: 'btn primary', onclick: async () => { try { await api('PATCH', '/api/stickers/' + s.id, { crop }); mm.close(); done(); } catch (e) { toast(e.message, 'error'); } } }, ic('check', 16), 'save'))));
}

// ---------- polls (2 to 10 options) ----------
function pollModal(c) {
  const q = el('input', { placeholder: 'ask something', maxLength: 120 });
  const opts = [el('input', { placeholder: 'option 1', maxLength: 40 }), el('input', { placeholder: 'option 2', maxLength: 40 })];
  const list = el('div', { class: 'polledit' });
  const draw = () => {
    list.replaceChildren(...opts.map((o, i) => el('div', { class: 'row gap-s' }, o, opts.length > 2 ? el('button', { class: 'icon-btn tiny', title: 'remove', onclick: () => { opts.splice(i, 1); draw(); } }, ic('x', 14)) : null)));
    add.disabled = opts.length >= 10; add.textContent = opts.length >= 10 ? 'that is the max (10)' : 'add option';
  };
  const add = el('button', { class: 'btn small', onclick: () => { opts.push(el('input', { placeholder: 'option ' + (opts.length + 1), maxLength: 40 })); draw(); opts[opts.length - 1].focus(); } });
  const send = el('button', { class: 'btn primary', onclick: async () => {
    const qq = q.value.trim(), oo = opts.map((o) => o.value.trim()).filter(Boolean);
    if (!qq || oo.length < 2) return toast('add a question and at least 2 options', 'error');
    if (C.F.check(qq) || oo.some((o) => C.F.check(o))) return toast('keep it clean', 'error');
    send.disabled = true;
    if (await sendPayload(c, { t: 'poll', q: qq, opts: oo })) {
      const id = c.lastMessage && c.lastMessage.id;
      try { await api('POST', `/api/messages/${id}/poll`, { n: oo.length }, { quiet: true }); } catch (e) { toast(e.message, 'error'); }
      m.close();
    } else send.disabled = false;
  } }, ic('send', 16), 'send poll');
  const m = modal('new poll', el('div', null, q, el('div', { style: 'height:10px' }), list, el('div', { class: 'row gap', style: 'margin-top:10px' }, add, el('div', { class: 'grow' }), send)));
  draw(); setTimeout(() => q.focus(), 50);
}
const extras = (c) => (c._extras = c._extras || { polls: {}, games: {} });
function pollBody(c, m, p) {
  if (typeof p.q !== 'string' || !Array.isArray(p.opts) || p.opts.length < 2 || p.opts.length > 10) return el('div', { class: 'mtext muted-i' }, 'poll unavailable');
  const x = extras(c).polls[m.id];
  const total = x ? x.counts.reduce((a, b) => a + b, 0) : 0;
  const vote = async (i) => {
    if (!x) return;
    try { const r = await api('POST', `/api/messages/${m.id}/vote`, { opt: x.mine === i ? -1 : i }, { quiet: true }); x.counts = r.counts; x.mine = r.mine; U.renderMessages(c); } catch (e) { toast(e.message, 'error'); }
  };
  return el('div', { class: 'poll' }, el('div', { class: 'pollq' }, ic('poll', 16), String(p.q).slice(0, 120)),
    p.opts.map((o, i) => { const n = x ? x.counts[i] || 0 : 0, pct = total ? Math.round(n / total * 100) : 0; return el('button', { class: 'pollopt' + (x && x.mine === i ? ' mine' : ''), disabled: !x, onclick: () => vote(i) }, el('i', { style: `width:${pct}%` }), el('span', { class: 'grow' }, String(o).slice(0, 40)), el('b', null, x ? n : '')); }),
    el('div', { class: 'muted small' }, x ? `${total} vote${total === 1 ? '' : 's'}${x.mine >= 0 ? ', tap yours again to undo' : ''}` : 'loading votes'));
}

// ---------- mini games: tic-tac-toe and rock paper scissors ----------
async function startGame(c, kind) {
  if (c.type !== 'dm') return toast('games work in a 1 on 1 chat', 'error');
  if (await sendPayload(c, { t: 'g2', kind })) {
    const id = c.lastMessage && c.lastMessage.id;
    try { await api('POST', `/api/messages/${id}/game`, { kind }, { quiet: true }); } catch (e) { toast(e.message, 'error'); }
  }
}
const GAME_NAME = { ttt: 'tic-tac-toe', rps: 'rock paper scissors', c4: 'connect 4', wd: 'word duel', tr: 'trivia duel' };
function gameBody(c, m, p) {
  if (!['ttt', 'rps', 'c4', 'wd', 'tr'].includes(p.kind)) return el('div', { class: 'mtext muted-i' }, 'game unavailable');
  const g = extras(c).games[m.id];
  if (!g) return el('div', { class: 'game' }, el('div', { class: 'gtitle' }, GAME_NAME[p.kind] || 'game'), el('div', { class: 'muted small' }, 'loading...'));
  const me1 = S.me.id === g.p1, other = (C.other(c) || {}).displayName || 'them';
  const move = async (body) => { try { const r = await api('POST', `/api/messages/${m.id}/move`, body, { quiet: true }); extras(c).games[m.id] = r.view; U.renderMessages(c); } catch (e) { toast(e.message, 'error'); } };
  const result = g.winner === 'draw' ? 'a draw' : g.winner ? ((g.winner === 'p1') === me1 ? 'you win' : other + ' wins') : null;
  if (g.kind === 'ttt') {
    const mine = g.turn === S.me.id && !g.winner;
    return el('div', { class: 'game' }, el('div', { class: 'gtitle' }, 'tic-tac-toe', el('span', { class: 'muted small' }, ` you are ${me1 ? 'X' : 'O'}`)),
      el('div', { class: 'ttt' }, g.board.map((v, i) => el('button', { class: 'cell ' + v, disabled: !mine || !!v, onclick: () => move({ cell: i }) }, v))),
      el('div', { class: 'muted small' }, result || (mine ? 'your turn' : `waiting for ${other}`)));
  }
  if (g.kind === 'c4') {
    const mine = g.turn === S.me.id && !g.winner;
    return el('div', { class: 'game' }, el('div', { class: 'gtitle' }, 'connect 4', el('span', { class: 'muted small' }, ` you are ${me1 ? 'red' : 'gold'}`)),
      el('div', { class: 'c4' }, [0, 1, 2, 3, 4, 5, 6].map((col) => el('button', { class: 'c4col', disabled: !mine || !!g.board[col], title: 'drop here', onclick: () => move({ col }) }, [0, 1, 2, 3, 4, 5].map((r) => { const v = g.board[r * 7 + col]; return el('i', { class: 'disc ' + (v === 'X' ? 'r' : v === 'O' ? 'y' : '') }); })))),
      el('div', { class: 'muted small' }, result || (mine ? 'your turn' : `waiting for ${other}`)));
  }
  if (g.kind === 'wd') {
    const done = !!g.winner || g.mine.length >= 6 || (g.mine.length && g.mine[g.mine.length - 1].fb === 'ggggg');
    const row = (w, fb) => el('div', { class: 'wdrow' }, [0, 1, 2, 3, 4].map((i) => el('span', { class: 'wdl ' + (fb ? fb[i] : '') }, w ? w[i] : '')));
    const inp = el('input', { maxLength: 5, placeholder: '5 letters', autocapitalize: 'none', autocomplete: 'off', spellcheck: false });
    const go = () => { const w = inp.value.trim().toLowerCase(); if (!/^[a-z]{5}$/.test(w)) return toast('type a 5 letter word', 'error'); move({ word: w }); };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); });
    return el('div', { class: 'game' }, el('div', { class: 'gtitle' }, 'word duel', el('span', { class: 'muted small' }, ' same secret word, first to guess it wins')),
      el('div', { class: 'wdboards' }, el('div', null, el('div', { class: 'muted small' }, 'you'), [0, 1, 2, 3, 4, 5].map((i) => g.mine[i] ? row(g.mine[i].w, g.mine[i].fb) : row('', ''))),
        el('div', null, el('div', { class: 'muted small' }, other), [0, 1, 2, 3, 4, 5].map((i) => row('', g.theirs[i] || '')))),
      done ? null : el('div', { class: 'row gap-s' }, inp, el('button', { class: 'btn small primary', onclick: go }, 'guess')),
      el('div', { class: 'muted small' }, g.winner ? `${result}, the word was ${g.word}` : done ? `out of guesses, waiting for ${other}` : `${6 - g.mine.length} guesses left`));
  }
  if (g.kind === 'tr') {
    const q = g.q;
    return el('div', { class: 'game' }, el('div', { class: 'gtitle' }, 'trivia duel', el('span', { class: 'muted small' }, ` ${Math.min(g.qi + 1, g.total)}/${g.total}`)),
      q ? el('div', null, el('div', { class: 'trq' }, q.t), el('div', { class: 'trs' }, q.o.map((o, i) => el('button', { class: 'btn small', onclick: () => move({ choice: i }) }, o))))
        : el('div', { class: 'muted small' }, g.winner ? '' : `you are done, waiting for ${other}`),
      el('div', { class: 'muted small' }, g.winner ? `you ${g.myScore}, ${other} ${g.theirScore}: ${result}` : `your score ${g.myScore} · ${other} answered ${g.theirDone}/${g.total}${g.lastRight === null ? '' : g.lastRight ? ' · last one right' : ' · last one wrong'}`));
  }
  const pick = (ch) => el('button', { class: 'btn small' + (g.mine === ch ? ' primary' : ''), disabled: !!g.mine || !!g.winner, onclick: () => move({ choice: ch }) }, ch);
  return el('div', { class: 'game' }, el('div', { class: 'gtitle' }, 'rock paper scissors'),
    el('div', { class: 'row gap-s' }, pick('rock'), pick('paper'), pick('scissors')),
    el('div', { class: 'muted small' }, g.winner ? `you ${g.mine}, ${other} ${g.theirs}: ${result}` : g.mine ? `you picked ${g.mine}, waiting for ${other}` : g.theirChosen ? `${other} already picked, your turn` : 'pick one'));
}
async function loadExtras(c) {
  try { const d = await api('GET', `/api/conversations/${c.id}/extras`, null, { quiet: true }); c._extras = { polls: d.polls || {}, games: d.games || {} }; } catch {}
}
function onExtra(m) {
  const c = convOf(m.convId); if (!c) return;
  const x = extras(c);
  if (m.kind === 'poll') { const old = x.polls[m.msgId]; x.polls[m.msgId] = { n: m.n, counts: m.counts, mine: old ? old.mine : -1 }; }
  else if (m.kind === 'game') x.games[m.msgId] = m.view;
  if (S.active === c.id && S.view === 'chats') U.renderMessages(c);
}
function extraBody(c, m, p) {                                // called for every message type the core does not know
  if (p.t === 'voice') return voiceBody(p);
  if (p.t === 'sticker') return stickerBody(p);
  if (p.t === 'poll') return pollBody(c, m, p);
  if (p.t === 'g2') return gameBody(c, m, p);
  if (p.t === 'coop') return window.__ext.coopBody(c, m, p);
  if (p.t === 'meme') return window.__ext.memeBody(c, m, p);
  return null;
}

// ---------- scheduled messages ----------
function scheduleModal(c, input) {
  const ta = el('textarea', { rows: 3, maxLength: 2000, placeholder: 'what should it say?' });
  ta.value = input ? input.value : '';
  const at = el('input', { type: 'datetime-local' });
  const plusMin = (min) => { const d = new Date(Date.now() + min * 60000); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  at.value = plusMin(60);
  const chip = (label, fn) => el('button', { class: 'chip-b', onclick: () => { at.value = fn(); } }, label);
  const send = el('button', { class: 'btn primary', onclick: async () => {
    const text = C.expandShortcodes(ta.value.trim());
    if (!text) return toast('write something first', 'error');
    if (C.F.check(text)) return toast('keep it clean', 'error');
    const when = new Date(at.value);
    if (!(when.getTime() > Date.now() + 30000)) return toast('pick a time at least a minute from now', 'error');
    send.disabled = true;
    try {
      const e = await encryptPayload(c, { t: 'text', text });
      await api('POST', '/api/scheduled', { convId: c.id, ...e, sendAt: when.toISOString() }, { quiet: true });
      if (input && input.value === ta.value) { input.value = ''; c.draft = ''; }
      toast('scheduled for ' + when.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }), 'success'); m.close();
    } catch (err) { toast(err.data && err.data.error === 'blocked_word' ? 'that was blocked, keep it clean' : err.message, 'error'); send.disabled = false; }
  } }, ic('calendar', 16), 'schedule');
  const m = modal('schedule a message', el('div', null, el('p', { class: 'muted small', style: 'margin-top:0' }, 'to ' + convTitle(c) + '. it sends by itself, even if you are offline. up to 7 days ahead.'), ta,
    el('div', { class: 'presets', style: 'margin:10px 0' }, chip('in 10 min', () => plusMin(10)), chip('in 1 hour', () => plusMin(60)), chip('tomorrow 9am', tomorrow)), at, el('div', { class: 'row gap end', style: 'margin-top:12px' }, send)));
}
async function scheduledList() {
  const body = el('div', null, el('div', { class: 'muted pad' }, '...'));
  modal('scheduled messages', body);
  try {
    const d = await api('GET', '/api/scheduled', null, { quiet: true });
    const rows = [];
    for (const s of d.items) {
      const c = convOf(s.convId); let text = 'encrypted message';
      if (c) { const p = await decryptMsg(c, { senderId: S.me.id, keyVersion: s.keyVersion, iv: s.iv, ciphertext: s.ciphertext }); if (p && p.text) text = p.text; }
      const row = el('div', { class: 'arow' }, el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, c ? convTitle(c) : 'a chat'), el('div', { class: 'small' }, text.slice(0, 120)), el('div', { class: 'muted small' }, new Date(s.sendAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))),
        el('button', { class: 'btn small', onclick: async () => { try { await api('DELETE', '/api/scheduled/' + s.id); row.remove(); } catch (e) { toast(e.message, 'error'); } } }, 'cancel'));
      rows.push(row);
    }
    body.replaceChildren(...(rows.length ? rows : [el('div', { class: 'muted pad' }, 'nothing scheduled. open a chat, tap + then "schedule a message"')]));
  } catch (e) { body.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
}

// ---------- disappearing messages ----------
function ttlModal(c) {
  const opts = [[null, 'normal (' + (S.ttlHours % 24 === 0 ? S.ttlHours / 24 + ' days' : S.ttlHours + ' hours') + ')'], [300, '5 minutes'], [3600, '1 hour'], [28800, '8 hours'], [86400, '1 day']];
  const body = el('div', null, C.betaActive() ? null : el('div', { class: 'betacard' }, ic('star', 20), el('div', { class: 'grow' }, el('b', null, 'beta feature'), el('div', { class: 'muted small' }, 'turn beta on to set a timer')), el('button', { class: 'btn small primary', onclick: goBeta }, 'beta tab')),
    el('p', { class: 'muted small' }, 'messages in this chat vanish after the time you pick. pinned ones stay. ' + (c.type === 'dm' ? 'both of you see the change.' : 'everyone in the group sees the change.')),
    opts.map(([v, l]) => el('button', { class: 'radio' + ((c.ttlSeconds || null) === v ? ' on' : ''), onclick: async () => {
      if (!needBeta('disappearing messages')) return;
      try { await api('PUT', `/api/conversations/${c.id}/ttl`, { seconds: v }, { quiet: true }); c.ttlSeconds = v; m.close(); U.renderHeader(); U.renderMessages(c); toast(v ? 'messages here now vanish after ' + ttlLabel(v) : 'back to the normal timer', 'success'); } catch (e) { toast(e.message, 'error'); }
    } }, el('span', { class: 'dotr' }), l)));
  const m = modal('disappearing messages', body);
}

// ---------- chat folders ----------
S.folder = null;
const folders = () => (C.betaActive() && Array.isArray(S.me.folders) ? S.me.folders : []);
function renderFolders() {
  const box = $('#folders'); if (!box) return;
  const fl = folders();
  if (!fl.length) { box.replaceChildren(); box.classList.remove('on'); S.folder = null; return; }
  if (S.folder && !fl.find((f) => f.id === S.folder)) S.folder = null;
  box.classList.add('on');
  const chip = (id, label) => el('button', { class: 'fchip' + (S.folder === id ? ' on' : ''), onclick: () => { S.folder = id; U.renderSide(); } }, label);
  box.replaceChildren(chip(null, 'all'), ...fl.map((f) => chip(f.id, f.name)), el('button', { class: 'fchip', title: 'edit folders', onclick: foldersModal }, ic('edit', 13)));
}
const inFolder = (list) => { const f = S.folder && folders().find((x) => x.id === S.folder); return f ? list.filter((c) => f.convIds.includes(c.id)) : list; };
function foldersModal() {
  if (!needBeta('folders')) return;
  let draft = JSON.parse(JSON.stringify(Array.isArray(S.me.folders) ? S.me.folders : []));
  const box = el('div');
  const m = modal('chat folders', box, { wide: true });
  const save = async () => {
    try { const r = await api('PUT', '/api/me/folders', { folders: draft }, { quiet: true }); S.me.folders = r.folders; U.renderSide(); toast('folders saved', 'success'); m.close(); } catch (e) { toast(e.message, 'error'); }
  };
  const draw = () => {
    box.replaceChildren(el('p', { class: 'muted small', style: 'margin-top:0' }, 'sort your chats into tabs. up to 20 folders.'),
      ...draft.map((f, i) => el('div', { class: 'folderedit' },
        el('div', { class: 'row gap' }, el('input', { value: f.name, maxLength: 16, oninput: (e) => { f.name = e.target.value; } }), el('button', { class: 'icon-btn', title: 'remove folder', onclick: () => { draft.splice(i, 1); draw(); } }, ic('trash', 16))),
        el('div', { class: 'folderchats' }, S.convs.map((c) => el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: f.convIds.includes(c.id), onchange: (e) => { f.convIds = e.target.checked ? [...f.convIds, c.id] : f.convIds.filter((x) => x !== c.id); } }), el('span', null, convTitle(c))))))),
      el('div', { class: 'row gap', style: 'margin-top:12px' }, el('button', { class: 'btn', disabled: draft.length >= 20, onclick: () => { draft.push({ id: Math.random().toString(36).slice(2, 8), name: 'folder ' + (draft.length + 1), convIds: [] }); draw(); } }, ic('folder', 16), 'new folder'), el('div', { class: 'grow' }), el('button', { class: 'btn primary', onclick: save }, ic('check', 16), 'save')));
  };
  draw();
}

// ---------- profile bio + banner (gradients live only on profiles) ----------
const SOLIDS = ['#c4572c', '#b8843a', '#7a8c55', '#587a82', '#6c7596', '#8c5a6c'];
const GRADS = [['#c4572c', '#b8843a'], ['#8c5a6c', '#6c7596'], ['#587a82', '#7a8c55'], ['#b8843a', '#7a8c55'], ['#6c7596', '#587a82'], ['#c4572c', '#8c5a6c'], ['#2b3a55', '#8c5a6c'], ['#7a8c55', '#e0b050']];
function profileEditModal() {
  if (!needBeta('bio and banner')) return;
  const bio = el('textarea', { rows: 3, maxLength: 160, placeholder: 'a line about you' }); bio.value = S.me.bio || '';
  let banner = S.me.banner || null;
  const prev = el('div', { class: 'banner big' });
  const paint = () => { prev.style.background = bannerCss(banner) || 'var(--panel2)'; };
  const c1 = el('input', { type: 'color', value: (banner || '#c4572c').split(',')[0], oninput: () => { banner = c1.value + (usesGrad() ? ',' + c2.value : ''); paint(); } });
  const c2 = el('input', { type: 'color', value: (banner || '').split(',')[1] || '#b8843a', oninput: () => { banner = c1.value + ',' + c2.value; paint(); } });
  const usesGrad = () => String(banner || '').includes(',');
  const swatch = (css, val) => el('button', { class: 'swatch', style: `background:${css}`, title: val, onclick: () => { banner = val; c1.value = val.split(',')[0]; if (val.split(',')[1]) c2.value = val.split(',')[1]; paint(); } });
  const save = el('button', { class: 'btn primary', onclick: async () => {
    if (C.F.check(bio.value)) return toast('keep your bio clean', 'error');
    try { const r = await api('PUT', '/api/me/profile', { bio: bio.value, banner }, { quiet: true }); S.me.bio = r.bio; S.me.banner = r.banner; toast('profile saved', 'success'); m.close(); } catch (e) { toast(e.message, 'error'); }
  } }, ic('check', 16), 'save');
  const m = modal('bio and banner', el('div', null, prev, el('h4', null, 'bio'), bio,
    el('h4', null, 'banner'), el('div', { class: 'swatches' }, SOLIDS.map((c) => swatch(c, c)), GRADS.map(([a, b]) => swatch(`linear-gradient(135deg,${a},${b})`, a + ',' + b))),
    el('div', { class: 'row gap', style: 'margin-top:10px;align-items:center' }, el('span', { class: 'muted small' }, 'custom'), c1, c2, el('div', { class: 'grow' }), el('button', { class: 'btn small', onclick: () => { banner = null; paint(); } }, 'no banner')),
    el('div', { class: 'row gap end', style: 'margin-top:14px' }, save)));
  paint();
}

// ---------- the beta tab ----------
const FEATURES = [
  ['palette', 'custom themes', 'your own colors, fonts and roundness', () => X0.themeModal(), 'open'],
  ['image', 'gif search', 'find and send gifs, or paste a link', () => toast('open a chat and tap the picture button', 'info'), 'where?'],
  ['mic', 'voice notes', 'record up to 10 seconds, tap + in a chat', () => toast('open a chat, tap + then voice note', 'info'), 'where?'],
  ['poll', 'polls', 'up to 10 options, tap + in a chat', () => toast('open a chat, tap + then poll', 'info'), 'where?'],
  ['edit', 'edit messages', 'fix a typo, it shows "edited"', () => toast('hover your message and tap the pencil', 'info'), 'where?'],
  ['sticker', 'stickers', 'your own stickers from image links, cropped square', () => stickerManage(), 'manage'],
  ['folder', 'chat folders', 'sort chats into tabs', () => foldersModal(), 'manage'],
  ['grid', 'mini games', 'tic-tac-toe and rock paper scissors in a 1 on 1 chat', () => toast('open a 1 on 1 chat, tap + then pick a game', 'info'), 'where?'],
  ['sparkle', 'bio and banner', 'a bio line and a color or gradient banner on your profile', () => profileEditModal(), 'edit'],
  ['timer', 'disappearing messages', 'a shorter timer for one chat, the clock in its header', () => toast('open a chat and tap the clock at the top', 'info'), 'where?'],
  ['calendar', 'scheduled messages', 'write now, send later', () => scheduledList(), 'my list'],
];
let betaInfo = null;
function buildBeta(m) {
  const page = el('div', { class: 'page betapage' });
  m.append(page);
  const draw = () => {
    const on = C.betaActive(), v = S.me.verified;
    const until = S.me.isAdmin ? 'always on for admins' : on ? 'until ' + new Date(S.me.betaUntil).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'off right now';
    const price = betaInfo ? (betaInfo.priceCents / 100).toFixed(2) : '0.50';
    page.replaceChildren(
      el('div', { class: 'page-head' }, el('h2', null, 'be', el('i', null, 'ta'))),
      el('div', { class: 'betacard' + (on ? ' on' : '') }, ic('star', 22), el('div', { class: 'grow' }, el('b', null, 'beta ' + (on ? 'is on' : 'is off')), el('div', { class: 'muted small' }, until))),
      !v ? el('div', { class: 'betacard' }, ic('verified', 22), el('div', { class: 'grow' }, el('b', null, 'verify first'), el('div', { class: 'muted small' }, 'beta needs a verified account')), el('button', { class: 'btn small primary', onclick: () => X0.verifyModal() }, 'verify')) : null,
      el('div', { class: 'pricecard' },
        el('div', { class: 'price' }, el('span', { class: 'amt' }, '$' + price), el('span', { class: 'per' }, ' / week')),
        el('p', { class: 'cents' }, 'Every cent goes to helping chatroom expand.'),
        el('p', { class: 'muted' }, 'to get beta, message an admin and work out how you want to pay. they switch it on for you once it is sorted.'),
        el('div', { class: 'row gap wrap' }, (betaInfo ? betaInfo.admins : []).map((a) => el('button', { class: 'btn primary', onclick: () => startDM(a.username) }, ic('chat', 16), 'talk to ' + a.displayName)),
          el('button', { class: 'btn', onclick: () => X0.inviteModal() }, ic('gift', 16), 'or earn it free by inviting'))),
      el('h4', null, 'what beta gets you'),
      el('div', { class: 'featgrid' }, FEATURES.map(([icon, title, desc, fn, label]) => el('div', { class: 'featcard' + (on ? '' : ' off') },
        el('div', { class: 'feath' }, ic(icon, 20), el('b', null, title)), el('div', { class: 'muted small' }, desc),
        el('button', { class: 'btn small', onclick: () => (on ? fn() : toast('turn beta on to use this', 'error')) }, on ? label : 'locked')))));
  };
  window.__betaDraw = draw;
  draw();
  if (!betaInfo) api('GET', '/api/beta/info', null, { quiet: true }).then((d) => { betaInfo = d; if (window.__betaDraw === draw && page.isConnected) draw(); }).catch(() => {});
}
const betaChanged = () => { if (S.view === 'beta' && window.__betaDraw) window.__betaDraw(); };

Object.assign(window.__ext, { buildBeta, betaChanged, banner, plusMenu, editMessage, extraBody, onExtra, loadExtras, ttlModal, ttlLabel, renderFolders, inFolder, foldersModal, profileEditModal, scheduledList, stickerManage });

})();

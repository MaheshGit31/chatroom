/* ===== Chatroom client: play together (a friend far away joins your game) =====
   how it stays cheap: the video goes straight from the host's browser to the friend's (webrtc, no media server),
   the server only relays a few tiny handshake messages, and only free public stun servers are used. */
(() => {
'use strict';
const C = window.__core, U = window.__ui;
const { S, el, ic, avatar, api, toast, convOf, convTitle, memberOf, sendPayload } = C;
const { modal } = U;

const hex = () => Array.from(C.rand(8)).map((x) => x.toString(16).padStart(2, '0')).join('');
const sig = (to, room, kind, data) => C.sendWS({ t: 'rtc', to, room, kind, data: data ? JSON.stringify(data) : null });
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const MAXBPS = 1_800_000;                                    // caps what the host uploads, about 800 MB an hour
let host = null, guest = null;

async function makePc() {
  const cfg = await api('GET', '/api/rtc-config', null, { quiet: true });
  return new RTCPeerConnection({ iceServers: cfg.iceServers });
}
function capBitrate(pc) {
  for (const s of pc.getSenders()) {
    if (!s.track || s.track.kind !== 'video') continue;
    const p = s.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}];
    p.encodings[0].maxBitrate = MAXBPS; p.encodings[0].maxFramerate = 30;
    s.setParameters(p).catch(() => {});
  }
}
// ice candidates can arrive before the remote description is set, so hold them until it is
const iceQueue = (pc) => { const q = []; return { add: async (c) => { if (pc.remoteDescription) await pc.addIceCandidate(c).catch(() => {}); else q.push(c); }, flush: async () => { while (q.length) await pc.addIceCandidate(q.shift()).catch(() => {}); } }; };

// ---------- host ----------
function coopHostModal(path, title, frame) {
  if (!window.RTCPeerConnection || !(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) return toast('this browser cannot share a tab, try Chrome or Edge on a computer', 'error');
  const dms = S.convs.filter((c) => c.type === 'dm');
  const list = el('div', { class: 'ulist tall' }, dms.length ? dms.map((c) => { const o = C.other(c); return el('div', { class: 'urow click', onclick: () => { m.close(); startHost(c, path, title, frame); } }, avatar(convTitle(c), 36, '', o && o.avatar), el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, convTitle(c)), el('div', { class: 'muted small' }, 'send an invite')), ic('send', 16)); }) : [el('div', { class: 'muted pad' }, 'start a direct message with a friend first')]);
  const m = modal('play together', el('div', null,
    el('p', { class: 'muted small', style: 'margin-top:0' }, 'your friend sees your game live and can press keys and click in it, from anywhere. your browser will ask what to share: pick "this tab". it goes straight between your two browsers, nothing is stored.'), list));
  m.box.style.zIndex = 400;
}
async function startHost(conv, path, title, frame) {
  stopHost(true);
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 }, width: { max: 1280 }, height: { max: 720 } }, audio: true, preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'exclude' });
  } catch { return toast('sharing was cancelled', 'error'); }
  const vt = stream.getVideoTracks()[0];
  let cropped = false;
  try { if (window.CropTarget && vt.cropTo) { await vt.cropTo(await CropTarget.fromElement(frame)); cropped = true; } } catch {}   // share only the game, not the whole chat page
  const other = C.other(conv);
  host = { room: hex(), conv, stream, frame, cropped, guestId: null, pc: null, dc: null, title, banner: null };
  vt.addEventListener('ended', () => stopHost());
  if (!(await sendPayload(conv, { t: 'coop', path, title, room: host.room }))) return stopHost(true);
  host.banner = el('div', { class: 'coopbar' }, ic('users', 16), el('span', { class: 'grow' }, `waiting for ${other ? other.displayName : 'your friend'} to join...`), el('button', { class: 'btn small', onclick: () => stopHost() }, 'stop sharing'));
  document.body.append(host.banner);
  toast('invite sent, they can tap join in the chat', 'success');
}
function bar(text) { if (host && host.banner) host.banner.querySelector('.grow').textContent = text; }
async function hostPeer(from) {
  const h = host, pc = await makePc();
  h.pc = pc; h.guestId = from;
  h.stream.getTracks().forEach((t) => pc.addTrack(t, h.stream));
  capBitrate(pc);
  const dc = pc.createDataChannel('in', { ordered: true }); h.dc = dc;
  dc.onopen = () => { const r = h.frame.getBoundingClientRect(); bar(`playing with ${nameOf(h.conv, from)}`); dc.send(JSON.stringify({ k: 'hello', title: h.title })); };
  dc.onmessage = (e) => hostInput(parse(e.data));
  const iq = iceQueue(pc); h.iq = iq;
  pc.onicecandidate = (e) => { if (e.candidate && host === h) sig(from, h.room, 'ice', e.candidate); };
  pc.onconnectionstatechange = () => {
    if (host !== h || h.pc !== pc) return;
    if (pc.connectionState === 'failed') { toast('could not connect directly, their network is strict. try again, or play from another network', 'error'); dropGuest(); }
    else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') dropGuest();
  };
  const connectTimer = setTimeout(() => { if (host === h && h.pc === pc && pc.connectionState !== 'connected') { toast('they could not connect in time', 'error'); dropGuest(); } }, 25000);
  pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'connected') clearTimeout(connectTimer); });
  await pc.setLocalDescription(await pc.createOffer());
  sig(from, h.room, 'offer', pc.localDescription);
}
function nameOf(conv, id) { const u = memberOf(conv, id); return u ? u.displayName : 'your friend'; }
function dropGuest() {
  if (!host) return;
  try { host.pc && host.pc.close(); } catch {}
  if (host.guestId) sig(host.guestId, host.room, 'bye');
  host.pc = null; host.dc = null; host.guestId = null; bar('waiting for someone to join...');
}
function stopHost(quiet) {
  if (!host) return;
  const h = host; dropGuest(); host = null;
  h.stream.getTracks().forEach((t) => t.stop());
  h.banner && h.banner.remove();
  if (!quiet) toast('stopped sharing');
}
function hostInput(m) {
  if (!m || !host || !host.frame || !host.frame.contentWindow) return;
  const h = host, r = h.frame.getBoundingClientRect();
  const out = { __coop: 1, k: m.k, color: '#e5855a' };
  const num = (v) => (Number.isFinite(+v) ? Math.min(1, Math.max(0, +v)) : 0);
  const map = () => { // positions arrive as 0-1 across the shared picture; turn them into positions inside the game
    let x = num(m.x), y = num(m.y);
    if (!h.cropped) { x = (x * innerWidth - r.left) / r.width; y = (y * innerHeight - r.top) / r.height; }
    out.x = Math.min(1, Math.max(0, x)); out.y = Math.min(1, Math.max(0, y));
  };
  if (m.k === 'key') {
    if (!['down', 'up'].includes(m.type)) return;
    out.type = m.type === 'down' ? 'keydown' : 'keyup'; out.key = String(m.key || '').slice(0, 20); out.code = String(m.code || '').slice(0, 20); out.keyCode = Math.min(300, Math.max(0, parseInt(m.keyCode, 10) || 0)); out.repeat = !!m.repeat;
  } else if (m.k === 'mouse') {
    if (!['move', 'down', 'up'].includes(m.type)) return;
    map(); out.type = m.type; out.button = m.button === 2 ? 2 : m.button === 1 ? 1 : 0;
  } else if (m.k === 'wheel') { map(); out.dy = Math.max(-400, Math.min(400, +m.dy || 0)); }
  else return;
  h.frame.contentWindow.postMessage(out, '*');
}

// ---------- the invite card in the chat ----------
function coopBody(c, m, p) {
  const mine = m.senderId === S.me.id;
  const live = mine && host && host.room === p.room;
  return el('div', { class: 'game' }, el('div', { class: 'gtitle' }, ic('users', 16), ' play together'),
    el('div', { class: 'mtext' }, String(p.title || 'a game').slice(0, 80)),
    mine ? (live ? el('button', { class: 'btn small', onclick: () => stopHost() }, 'stop sharing') : el('div', { class: 'muted small' }, 'session ended'))
      : el('button', { class: 'btn small primary', onclick: () => joinGame(c, m, p) }, ic('play', 14), 'join'),
    mine ? null : el('div', { class: 'muted small' }, 'you see their game live and play it with them. works only while they are sharing.'));
}

// ---------- guest ----------
async function joinGame(c, m, p) {
  if (!window.RTCPeerConnection) return toast('this browser cannot join', 'error');
  leaveGuest(true);
  const hostId = m.senderId, room = String(p.room || '');
  const video = el('video', { class: 'coopvideo', playsinline: true, autoplay: true });
  video.muted = true;
  const status = el('div', { class: 'coopstatus' }, el('div', { class: 'spinner' }), el('div', null, 'connecting...'));
  const mute = el('button', { class: 'btn small', onclick: () => { video.muted = !video.muted; mute.textContent = video.muted ? 'sound off' : 'sound on'; } }, 'sound off');
  const top = el('div', { class: 'coopctl' }, el('b', { class: 'grow' }, String(p.title || 'game').slice(0, 60)), mute,
    el('button', { class: 'btn small', onclick: () => (video.requestFullscreen || (() => {})).call(box) }, ic('expand', 14)), el('button', { class: 'btn small danger', onclick: () => leaveGuest() }, 'leave'));
  const box = el('div', { class: 'coopview', tabindex: 0 }, top, video, status);
  document.body.append(box); box.focus();
  const g = guest = { room, hostId, box, video, status, pc: null, dc: null, cleanup: [], conv: c };
  g.timer = setTimeout(() => { if (guest === g && !g.connected) { toast('could not connect, the host may have stopped sharing', 'error'); leaveGuest(); } }, 22000);
  attachInput(g);
  sig(hostId, room, 'join');
}
async function guestOffer(m) {
  const g = guest;
  const pc = await makePc(); g.pc = pc; const iq = iceQueue(pc); g.iq = iq;
  pc.onicecandidate = (e) => { if (e.candidate && guest === g) sig(g.hostId, g.room, 'ice', e.candidate); };
  pc.ontrack = (e) => { g.video.srcObject = e.streams[0]; g.video.play().catch(() => {}); g.connected = true; g.status.remove(); clearTimeout(g.timer); };
  pc.ondatachannel = (e) => { g.dc = e.channel; };
  pc.onconnectionstatechange = () => { if (guest === g && ['failed', 'closed'].includes(pc.connectionState)) { toast('connection lost', 'error'); leaveGuest(); } };
  await pc.setRemoteDescription(parse(m.data)); await iq.flush();
  await pc.setLocalDescription(await pc.createAnswer());
  sig(g.hostId, g.room, 'answer', pc.localDescription);
}
function leaveGuest(quiet) {
  if (!guest) return;
  const g = guest; guest = null;
  clearTimeout(g.timer);
  g.cleanup.forEach((f) => f());
  if (!quiet) sig(g.hostId, g.room, 'bye');
  try { g.pc && g.pc.close(); } catch {}
  g.box.remove();
}
function attachInput(g) {
  const send = (o) => { if (g.dc && g.dc.readyState === 'open') g.dc.send(JSON.stringify(o)); };
  const norm = (e) => {                                     // position inside the picture (the video is letterboxed), as 0 to 1
    const v = g.video, r = v.getBoundingClientRect(), vw = v.videoWidth, vh = v.videoHeight; if (!vw) return null;
    const s = Math.min(r.width / vw, r.height / vh), w = vw * s, h = vh * s, ox = r.left + (r.width - w) / 2, oy = r.top + (r.height - h) / 2;
    const x = (e.clientX - ox) / w, y = (e.clientY - oy) / h;
    return x < 0 || y < 0 || x > 1 || y > 1 ? null : { x, y };
  };
  const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); g.cleanup.push(() => t.removeEventListener(ev, fn, o)); };
  const keyEv = (type) => (e) => { if (e.ctrlKey || e.metaKey || e.altKey || e.key === 'F5' || e.key === 'F12') return; e.preventDefault(); send({ k: 'key', type, key: e.key, code: e.code, keyCode: e.keyCode, repeat: e.repeat }); };
  on(document, 'keydown', keyEv('down'), true); on(document, 'keyup', keyEv('up'), true);
  let last = 0;
  on(g.video, 'mousemove', (e) => { const n = norm(e); if (!n || Date.now() - last < 30) return; last = Date.now(); send({ k: 'mouse', type: 'move', ...n }); });
  on(g.video, 'mousedown', (e) => { const n = norm(e); if (n) { e.preventDefault(); send({ k: 'mouse', type: 'down', button: e.button, ...n }); } });
  on(g.video, 'mouseup', (e) => { const n = norm(e); if (n) send({ k: 'mouse', type: 'up', button: e.button, ...n }); });
  on(g.video, 'contextmenu', (e) => e.preventDefault());
  on(g.video, 'wheel', (e) => { const n = norm(e); if (n) { e.preventDefault(); send({ k: 'wheel', dy: e.deltaY, ...n }); } }, { passive: false });
  const touch = (type) => (e) => { const t = e.changedTouches[0]; const n = t && norm(t); if (n) { e.preventDefault(); send({ k: 'mouse', type, button: 0, ...n }); } };   // phones: a touch is a click
  on(g.video, 'touchstart', (e) => { touch('move')(e); touch('down')(e); }, { passive: false }); on(g.video, 'touchmove', touch('move'), { passive: false }); on(g.video, 'touchend', touch('up'), { passive: false });
}

// ---------- handshake messages from the server ----------
async function onRtc(m) {
  try {
    if (host && m.room === host.room) {
      if (m.kind === 'join') { if (host.guestId && host.guestId !== m.from) return sig(m.from, m.room, 'bye', 'busy'); if (host.pc) dropGuest(); await hostPeer(m.from); }
      else if (m.from !== host.guestId || !host.pc) return;
      else if (m.kind === 'answer') { await host.pc.setRemoteDescription(parse(m.data)); await host.iq.flush(); }
      else if (m.kind === 'ice') await host.iq.add(parse(m.data));
      else if (m.kind === 'bye') dropGuest();
    } else if (guest && m.room === guest.room && m.from === guest.hostId) {
      if (m.kind === 'offer') await guestOffer(m);
      else if (m.kind === 'ice' && guest.iq) await guest.iq.add(parse(m.data));
      else if (m.kind === 'bye') { const busy = m.data === '"busy"'; leaveGuest(true); toast(busy ? 'someone else is already playing with them' : 'the host stopped sharing'); }
    }
  } catch (e) { toast('play together hit a problem: ' + e.message, 'error'); }
}

Object.assign(window.__ext, { coopHostModal, coopBody, onRtc, coopStopHost: () => stopHost() });
})();

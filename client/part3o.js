(() => {
'use strict';
const C = window.__core, U = window.__ui, X = window.__ext;
const { S, el, ic, toast, api, convOf, sendWS, avatar, rid } = C;
const { modal, confirmModal } = U;

const K = { room: null, kind: null, convId: null, name: '', members: [], links: new Map(), localAudio: null, localVideo: null, mic: true, cam: false, deaf: false, small: false, incoming: null, micPromise: null, dock: null, media: new Map(), localEl: null };
let ice = null, actx = null, ringTimer = null, titleTimer = null, origTitle = null, meter = null;

const myId = () => S.me.id;
const meMember = () => K.members.find((x) => x.id === myId());
const stage = () => K.kind === 'stage';
const hasVideo = () => K.kind === 'dm' || K.kind === 'video';

async function getIce() {
  if (ice) return ice;
  try { ice = (await api('GET', '/api/rtc-config', null, { quiet: true })).iceServers; } catch { ice = [{ urls: 'stun:stun.l.google.com:19302' }]; }
  return ice;
}
function audioCtx() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; } }
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => { if (actx || K.incoming) audioCtx(); }, { passive: true });

async function acquireMic() {
  if (K.localAudio) return true;
  if (K.micPromise) return K.micPromise;
  K.micPromise = (async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      K.localAudio = s.getAudioTracks()[0];
      K.localAudio.enabled = K.mic;
      watchLevel('me', new MediaStream([K.localAudio]));
      return true;
    } catch { toast('could not use your microphone, check the browser permission', 'error'); return false; }
    finally { K.micPromise = null; }
  })();
  return K.micPromise;
}
async function acquireCam() {
  if (K.localVideo) return true;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } });
    K.localVideo = s.getVideoTracks()[0];
    K.localVideo.onended = () => { if (K.localVideo) toggleCam(false); };
    return true;
  } catch { toast('could not use your camera, check the browser permission', 'error'); return false; }
}

function watchLevel(id, stream) {
  const ctx = audioCtx(); if (!ctx || !stream.getAudioTracks().length) return;
  try {
    const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
    an.fftSize = 256; src.connect(an);
    K.levels = K.levels || new Map();
    K.levels.set(id, { an, buf: new Uint8Array(an.fftSize), src });
    if (!meter) meter = setInterval(tickMeter, 140);
  } catch { /* no meter */ }
}
function tickMeter() {
  if (!K.levels || !K.dock) return;
  for (const [id, l] of K.levels) {
    l.an.getByteTimeDomainData(l.buf);
    let s = 0; for (let i = 0; i < l.buf.length; i++) { const v = (l.buf[i] - 128) / 128; s += v * v; }
    const loud = Math.sqrt(s / l.buf.length) > 0.04 && (id !== 'me' || K.mic);
    const t = K.dock.querySelector(`[data-uid="${id === 'me' ? myId() : id}"]`);
    if (t) t.classList.toggle('speaking', loud);
  }
}

function closeLink(id) {
  const L = K.links.get(id); if (!L) return;
  K.links.delete(id);
  try { L.pc.ontrack = null; L.pc.onicecandidate = null; L.pc.onconnectionstatechange = null; L.pc.close(); } catch { /* closed */ }
  const v = K.media.get(id); if (v) { v.srcObject = null; v.remove(); K.media.delete(id); }
  if (K.levels && K.levels.has(id)) { try { K.levels.get(id).src.disconnect(); } catch { /* gone */ } K.levels.delete(id); }
}

const sigSend = (to, o) => sendWS({ t: 'vc_sig', room: K.room, to, data: JSON.stringify(o) });

function dirFor(me, mem) {
  if (!stage()) return 'sendrecv';
  const send = !!me.speaker, recv = !!mem.speaker;
  return send && recv ? 'sendrecv' : send ? 'sendonly' : 'recvonly';
}

async function newLink(mem, sig, sid) {
  const pc = new RTCPeerConnection({ iceServers: await getIce() });
  const L = { pc, sid, sig, ice: [], stream: new MediaStream(), id: mem.id };
  K.links.set(mem.id, L);
  pc.onicecandidate = (e) => { if (e.candidate) sigSend(mem.id, { sid, k: 'ice', c: e.candidate }); };
  pc.ontrack = (e) => {
    L.stream.addTrack(e.track);
    attachMedia(mem.id, L.stream);
    if (e.track.kind === 'audio') watchLevel(mem.id, new MediaStream([e.track]));
    e.track.onunmute = () => paintDock();
    paintDock();
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' && K.links.get(mem.id) === L) { closeLink(mem.id); setTimeout(() => reconcile().catch(() => {}), 900); }
  };
  return L;
}
function attachMedia(id, stream) {
  let v = K.media.get(id);
  if (!v) { v = el('video', { autoplay: true, playsinline: true }); K.media.set(id, v); }
  if (v.srcObject !== stream) v.srcObject = stream;
  v.muted = K.deaf;
  v.play().catch(() => {});
}
async function wireTracks(pc, me, mem) {
  for (const tr of pc.getTransceivers()) {
    const kind = tr.receiver && tr.receiver.track ? tr.receiver.track.kind : null;
    if (kind === 'audio') {
      tr.direction = dirFor(me, mem);
      if (tr.direction !== 'recvonly' && K.localAudio) await tr.sender.replaceTrack(K.localAudio).catch(() => {});
    } else if (kind === 'video') {
      tr.direction = 'sendrecv';
      if (K.localVideo) await tr.sender.replaceTrack(K.localVideo).catch(() => {});
    }
  }
}

async function makeOffer(me, mem, sig) {
  const L = await newLink(mem, sig, rid());
  const at = L.pc.addTransceiver('audio', { direction: dirFor(me, mem) });
  if (at.direction !== 'recvonly' && K.localAudio) await at.sender.replaceTrack(K.localAudio).catch(() => {});
  if (hasVideo()) { const vt = L.pc.addTransceiver('video', { direction: 'sendrecv' }); if (K.localVideo) await vt.sender.replaceTrack(K.localVideo).catch(() => {}); }
  const offer = await L.pc.createOffer();
  await L.pc.setLocalDescription(offer);
  sigSend(mem.id, { sid: L.sid, k: 'offer', sdp: L.pc.localDescription.sdp });
}

async function onSig(m) {
  if (!K.room || m.room !== K.room) return;
  let d; try { d = JSON.parse(m.data); } catch { return; }
  const me = meMember(), mem = K.members.find((x) => x.id === m.from);
  if (!me || !mem || !d || typeof d.sid !== 'string') return;
  if (d.k === 'offer') {
    if (K.micPromise) await K.micPromise;
    const old = K.links.get(m.from); if (old) closeLink(m.from);
    const L = await newLink(mem, [me.e, mem.e, me.speaker, mem.speaker].join('|'), d.sid);
    await L.pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
    await wireTracks(L.pc, me, mem);
    const ans = await L.pc.createAnswer();
    await L.pc.setLocalDescription(ans);
    sigSend(m.from, { sid: d.sid, k: 'answer', sdp: L.pc.localDescription.sdp });
    for (const c of L.ice.splice(0)) L.pc.addIceCandidate(c).catch(() => {});
    return;
  }
  const L = K.links.get(m.from);
  if (!L || L.sid !== d.sid) return;
  if (d.k === 'answer') {
    await L.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp }).catch(() => {});
    for (const c of L.ice.splice(0)) L.pc.addIceCandidate(c).catch(() => {});
  } else if (d.k === 'ice' && d.c) {
    if (L.pc.remoteDescription) L.pc.addIceCandidate(d.c).catch(() => {}); else L.ice.push(d.c);
  }
}

let reconciling = false, again = false;
async function reconcile() {
  if (reconciling) { again = true; return; }
  reconciling = true;
  try {
    do {
      again = false;
      const room = K.room;
      const me = meMember(); if (!me || !room) break;
      if (stage()) {
        if (me.speaker && !K.localAudio) {
          const ok = await acquireMic();
          if (!ok) { sendWS({ t: 'vc_promote', room, user: myId(), on: false }); continue; }
          sendWS({ t: 'vc_media', room, mic: K.mic });
        }
        if (!me.speaker && K.localAudio) { K.localAudio.stop(); K.localAudio = null; if (K.levels && K.levels.has('me')) K.levels.delete('me'); }
      }
      if (K.room !== room) break;
      for (const mem of K.members) {
        if (mem.id === me.id) continue;
        const want = !stage() || me.speaker || mem.speaker;
        const sig = [me.e, mem.e, me.speaker, mem.speaker].join('|');
        const L = K.links.get(mem.id);
        if (L && (!want || L.sig !== sig)) closeLink(mem.id);
        if (!want || K.links.has(mem.id)) continue;
        if (myId() < mem.id) await makeOffer(me, mem, sig).catch((e) => console.warn('offer', e));
      }
      for (const id of [...K.links.keys()]) if (!K.members.some((x) => x.id === id)) closeLink(id);
    } while (again);
  } finally { reconciling = false; }
}

function onState(m) {
  if (K.incoming && m.room === K.incoming.room && m.members.some((x) => x.id === myId())) stopIncoming();
  if (m.room !== K.room) return;
  K.kind = m.kind; K.convId = m.convId; K.name = m.name || K.name;
  K.members = m.members;
  if (!meMember()) { if (K.joined) cleanup(); return; }
  K.joined = true;
  paintDock();
  reconcile().catch((e) => console.warn('reconcile', e)).then(tuneSenders);
}

function cleanup(msg) {
  wClose();
  for (const id of [...K.links.keys()]) closeLink(id);
  for (const t of [K.localAudio, K.localVideo]) if (t) try { t.stop(); } catch { /* ended */ }
  for (const l of (K.levels || new Map()).values()) try { l.src.disconnect(); } catch { /* gone */ }
  clearInterval(meter); meter = null;
  if (K.dock) K.dock.remove();
  if (K.audioBox) { K.audioBox.remove(); K.audioBox = null; }
  Object.assign(K, { room: null, kind: null, convId: null, name: '', members: [], localAudio: null, localVideo: null, mic: true, cam: false, deaf: false, small: false, dock: null, joined: false, levels: null, outgoing: false, localEl: null });
  K.media.clear();
  if (msg) toast(msg, 'info');
  U.renderSide && U.renderSide();
  const c = S.active && convOf(S.active); if (c) X.drawChanbar(c);
}
function leave() {
  if (!K.room) return;
  const room = K.room;
  const ringing = K.kind === 'dm' && K.members.length < 2;
  sendWS({ t: ringing ? 'call_cancel' : 'vc_leave', room });
  cleanup();
}

async function toggleMic(v) {
  if (!K.room) return;
  K.mic = typeof v === 'boolean' ? v : !K.mic;
  if (K.localAudio) K.localAudio.enabled = K.mic;
  sendWS({ t: 'vc_media', room: K.room, mic: K.mic });
  paintDock();
}
async function toggleCam(v) {
  if (!K.room || !hasVideo()) return;
  const on = typeof v === 'boolean' ? v : !K.cam;
  if (on) { if (!(await acquireCam())) return; }
  else if (K.localVideo) { K.localVideo.stop(); K.localVideo = null; }
  K.cam = on;
  for (const L of K.links.values()) { const t = L.pc.getTransceivers().find((x) => x.receiver.track && x.receiver.track.kind === 'video'); if (t) await t.sender.replaceTrack(K.localVideo).catch(() => {}); }
  K.localEl = null;
  sendWS({ t: 'vc_media', room: K.room, cam: K.cam });
  paintDock();
}
function toggleDeaf() { K.deaf = !K.deaf; for (const v of K.media.values()) v.muted = K.deaf; paintDock(); }

async function enter(room, kind, convId, name) {
  if (K.room && K.room !== room) leave();
  Object.assign(K, { room, kind, convId, name, members: [], joined: false });
  paintDock();
}

async function startCall(c, video) {
  if (!navigator.mediaDevices || !window.RTCPeerConnection) return toast('this browser cannot do calls', 'error');
  if (S.me.callsOff) return toast('you turned calls off, flip them back on in settings', 'error');
  if (K.room) return toast('you are already in a call', 'error');
  if (!(await acquireMic())) return;
  if (video && !(await acquireCam())) video = false;
  K.cam = !!K.localVideo;
  await enter('dm:' + c.id, 'dm', c.id, C.convTitle(c));
  K.outgoing = true; paintDock();
  sendWS({ t: 'call_start', convId: c.id, video: !!video });
}

async function joinChannel(c, ch) {
  if (!navigator.mediaDevices || !window.RTCPeerConnection) return toast('this browser cannot do calls', 'error');
  const room = 'ch:' + ch.id;
  if (K.room === room) { K.small = false; return paintDock(); }
  if (!S.me.verified && !S.me.isAdmin && c.role !== 'admin' && c.role !== 'mod') { return X.verifyModal(); }
  if (K.room) leave();
  if (ch.kind !== 'stage' && !(await acquireMic())) return;
  K.mic = true;
  await enter(room, ch.kind, c.id, ch.name);
  sendWS({ t: 'vc_join', room, mic: K.mic });
}

function ringPref() { return S.me.callPref || null; }
function playRing() {
  const ctx = audioCtx(); if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  [[440, 0], [480, 0], [440, 0.55], [480, 0.55]].forEach(([f, off]) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + off); g.gain.exponentialRampToValueAtTime(0.12, t0 + off + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.45);
    o.connect(g).connect(ctx.destination); o.start(t0 + off); o.stop(t0 + off + 0.5);
  });
}
function startRing(name, force) {
  stopRing();
  const pref = force || ringPref();
  if (pref !== 'title') { audioCtx(); playRing(); ringTimer = setInterval(playRing, 2200); }
  if (pref !== 'sound') {
    origTitle = origTitle || document.title;
    const msg = `(${String(name).toUpperCase()} IS CALLING!)`;
    let flip = false;
    document.title = msg;
    titleTimer = setInterval(() => { flip = !flip; document.title = flip ? origTitle : msg; }, 800);
  }
}
function stopRing() {
  clearInterval(ringTimer); ringTimer = null;
  if (titleTimer) { clearInterval(titleTimer); titleTimer = null; if (origTitle) document.title = origTitle; origTitle = null; }
}
function testRing() { startRing('a friend', ringPref() || undefined); setTimeout(stopRing, 4000); }

function stopIncoming() {
  stopRing();
  if (K.incoming && K.incoming.card) K.incoming.card.remove();
  K.incoming = null;
}
function showIncoming(m) {
  if (K.incoming) stopIncoming();
  const done = () => stopIncoming();
  const card = el('div', { class: 'incall', role: 'alertdialog', 'aria-label': 'incoming call' },
    avatar(m.from.name, 46, '', m.from.avatar),
    el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, m.from.name), el('div', { class: 'muted small' }, m.video ? 'is video calling you' : 'is calling you')),
    el('button', { class: 'btn danger round', title: 'decline', onclick: () => { sendWS({ t: 'call_decline', room: m.room }); done(); } }, ic('phoneoff', 20)),
    el('button', { class: 'btn primary round', title: 'accept', onclick: async () => {
      const room = m.room; done();
      if (K.room) return toast('you are already in a call', 'error');
      if (!(await acquireMic())) { sendWS({ t: 'call_decline', room }); return; }
      if (m.video) await acquireCam();
      K.cam = !!K.localVideo;
      await enter(room, 'dm', m.convId, m.from.name);
      sendWS({ t: 'vc_join', room, mic: true });
      if (K.cam) sendWS({ t: 'vc_media', room, cam: true });
      if (convOf(m.convId)) U.openConv(m.convId);
    } }, ic('phone', 20)));
  document.body.append(card);
  K.incoming = { ...m, card };
  startRing(m.from.name);
}

function onCall(m) {
  switch (m.t) {
    case 'vc_state': onState(m); break;
    case 'vc_watch': onWatch(m); break;
    case 'vc_sig': onSig(m).catch((e) => console.warn('sig', e)); break;
    case 'vc_live': X.setLive(m); break;
    case 'vc_closed':
      if (m.room === K.room) cleanup(({ ended: 'call ended', declined: 'they declined', missed: 'no answer', kicked: 'you were removed by a mod', afk: 'you were removed for being inactive', deleted: 'that channel was deleted', moved: 'moved to another call', cancelled: 'call cancelled', replaced: 'call replaced' })[m.why] || 'call ended');
      break;
    case 'vc_error': toast(m.message || 'could not join', 'error'); if (m.room === K.room && !K.joined) cleanup(); break;
    case 'vc_afk_warn': K.afk = true; paintDock(); break;
    case 'vc_forcemute': toggleMic(false); toast('a mod muted you', 'info'); break;
    case 'call_incoming':
      if (S.me.callsOff) { sendWS({ t: 'call_decline', room: m.room }); break; }
      if (K.room) { sendWS({ t: 'call_decline', room: m.room }); toast(m.from.name + ' called while you were busy', 'info'); break; }
      showIncoming(m); break;
    case 'call_gone': if (K.incoming && K.incoming.room === m.room) stopIncoming(); break;
    case 'call_declined': toast('call declined', 'info'); if (m.room === K.room || 'dm:' + m.convId === K.room) cleanup(); break;
    case 'call_missed': toast('no answer', 'info'); if (m.room === K.room) cleanup(); break;
    case 'call_fail': toast(m.reason || 'could not start that call', 'error'); if (K.room === 'dm:' + m.convId) cleanup(); break;
    default: break;
  }
}

function btn(icon, title, fn, cls) { return el('button', { class: 'cbtn ' + (cls || ''), title, 'aria-label': title, onclick: fn }, ic(icon, 20)); }

function tile(mem) {
  const mine = mem.id === myId();
  let video = null;
  if (mine) {
    if (K.localVideo && K.cam) {
      if (!K.localEl) { K.localEl = el('video', { autoplay: true, playsinline: true, muted: true }); K.localEl.srcObject = new MediaStream([K.localVideo]); K.localEl.play().catch(() => {}); }
      video = K.localEl;
    }
  } else {
    const v = K.media.get(mem.id);
    if (v) { v.style.display = mem.cam ? '' : 'none'; if (mem.cam) video = v; }
  }
  const t = el('div', { class: 'tile' + (video ? ' vid' : '') + (mine ? ' me' : ''), 'data-uid': mem.id },
    video || el('div', { class: 'tav' }, avatar(mem.name, 56, '', mem.avatar)),
    el('div', { class: 'tname' }, !mem.mic ? ic('micoff', 12) : null, mine ? 'you' : mem.name));
  return t;
}

function paintDock() {
  if (!K.room) return;
  if (!K.dock) { K.dock = el('div', { class: 'calldock' }); document.body.append(K.dock); }
  const d = K.dock, me = meMember();
  const stg = stage();
  const kindIc = K.kind === 'dm' ? 'phone' : K.kind === 'stage' ? 'stage' : K.kind === 'video' ? 'video' : 'volume';
  const title = K.kind === 'dm' ? K.name : '#' + K.name;
  const ringing = K.kind === 'dm' && K.members.length < 2;
  const status = ringing ? (K.outgoing ? 'calling...' : 'connecting...') : stg ? `${K.members.filter((x) => x.speaker).length} speaking · ${K.members.length} here` : `${K.members.length} in the call`;
  d.classList.toggle('small', K.small);
  d.classList.toggle('stage', stg);
  const parts = [el('div', { class: 'callhead' }, ic(kindIc, 16), el('div', { class: 'grow' }, el('b', null, title), el('div', { class: 'muted small' }, status)),
    el('button', { class: 'icon-btn tiny', title: K.small ? 'expand' : 'minimize', onclick: () => { K.small = !K.small; paintDock(); } }, ic(K.small ? 'plus' : 'x', 14)))];
  if (!K.small) {
    if (stg) {
      const speakers = K.members.filter((x) => x.speaker), aud = K.members.filter((x) => !x.speaker);
      const staff = !!(me && me.staff);
      parts.push(el('div', { class: 'tiles' }, speakers.length ? speakers.map(tile) : el('div', { class: 'muted pad' }, 'nobody is speaking yet')));
      parts.push(el('div', { class: 'aud' }, el('div', { class: 'muted small' }, `audience (${aud.length})`),
        aud.map((a) => el('div', { class: 'arow', 'data-uid': a.id }, avatar(a.name, 24, '', a.avatar), el('span', { class: 'grow' }, a.id === myId() ? 'you' : a.name), a.hand ? el('span', { class: 'hand', title: 'hand raised' }, ic('hand', 15)) : null,
          staff && a.id !== myId() ? [
            el('button', { class: 'btn small' + (a.hand ? ' primary' : ''), onclick: () => sendWS({ t: 'vc_promote', room: K.room, user: a.id, on: true }) }, 'let speak'),
            el('button', { class: 'icon-btn tiny', title: 'remove', onclick: () => sendWS({ t: 'vc_kick', room: K.room, user: a.id }) }, ic('x', 13))] : null))));
      if (staff) {
        const mutable = speakers.filter((x) => !x.staff && x.id !== myId());
        if (mutable.length) parts.push(el('div', { class: 'aud' }, el('div', { class: 'muted small' }, 'speakers'), mutable.map((s) => el('div', { class: 'arow' }, avatar(s.name, 24, '', s.avatar), el('span', { class: 'grow' }, s.name),
          el('button', { class: 'btn small', onclick: () => sendWS({ t: 'vc_forcemute', room: K.room, user: s.id }) }, 'mute'),
          el('button', { class: 'btn small', onclick: () => sendWS({ t: 'vc_promote', room: K.room, user: s.id, on: false }) }, 'to audience')))));
      }
    } else {
      const list = K.members.length ? K.members : [{ id: myId(), name: S.me.displayName, avatar: S.me.avatar, mic: K.mic, cam: K.cam }];
      parts.push(el('div', { class: 'tiles n' + Math.min(list.length, 12) }, list.map(tile)));
    }
  }
  if (K.afk) parts.splice(1, 0, el('div', { class: 'afkwarn' }, el('div', { class: 'grow' }, 'still there? you will be removed soon to save bandwidth'), el('button', { class: 'btn small primary', onclick: sendAlive }, 'i am here')));
  const bar = [];
  const canSpeak = !stg || (me && me.speaker);
  if (canSpeak) bar.push(btn(K.mic ? 'mic' : 'micoff', K.mic ? 'mute' : 'unmute', () => toggleMic(), K.mic ? '' : 'off'));
  if (hasVideo()) bar.push(btn(K.cam ? 'video' : 'videooff', K.cam ? 'camera off' : 'camera on', () => toggleCam(), K.cam ? 'on' : 'off'));
  bar.push(btn('headphones', K.deaf ? 'undeafen' : 'deafen', toggleDeaf, K.deaf ? 'off' : ''));
  if (window.__ext.dropOn && window.__ext.dropOn() && K.joined && (!stg || (me && me.staff))) bar.push(btn('play', 'watch together', openWatchModal, W.host ? 'on' : ''));
  if (stg && me && !me.speaker) bar.push(btn('hand', me.hand ? 'lower hand' : 'raise hand', () => sendWS({ t: 'vc_hand', room: K.room, up: !me.hand }), me.hand ? 'on' : ''));
  if (stg && me && me.speaker) bar.push(btn('users', 'step down to audience', () => sendWS({ t: 'vc_promote', room: K.room, user: myId(), on: false })));
  bar.push(btn('phoneoff', ringing && K.outgoing ? 'cancel' : 'leave', leave, 'hang'));
  parts.push(el('div', { class: 'callbar' }, bar));
  d.replaceChildren(parts);
  if (!K.audioBox) { K.audioBox = el('div', { style: 'display:none' }); document.body.append(K.audioBox); }
  for (const v of K.media.values()) { if (!v.isConnected) K.audioBox.append(v); if (v.paused) v.play().catch(() => {}); }
}

function callSettingsRows(toggle) {
  const seg = el('div', { class: 'seg small' });
  const paint = () => seg.replaceChildren(
    el('button', { class: S.me.callPref === 'sound' ? 'on' : '', onclick: () => setPref('sound') }, 'ringtone'),
    el('button', { class: S.me.callPref === 'title' ? 'on' : '', onclick: () => setPref('title') }, 'tab title'));
  const setPref = async (p) => { try { const r = await api('PUT', '/api/me/calls', { pref: p }, { quiet: true }); S.me.callPref = r.callPref; paint(); } catch (e) { toast(e.message, 'error'); } };
  paint();
  return el('div', null,
    el('h4', null, ic('phone', 14), 'calls'),
    toggle('allow calls', !S.me.callsOff, async (v) => { try { const r = await api('PUT', '/api/me/calls', { off: !v }, { quiet: true }); S.me.callsOff = r.callsOff; } catch (e) { toast(e.message, 'error'); return false; } }),
    el('div', { class: 'setrow' }, el('div', { class: 'grow' }, 'when someone calls'), seg),
    el('button', { class: 'btn small', style: 'margin-top:6px', onclick: testRing }, ic('bell', 14), 'test it'));
}

let asks = 0;
function askPref() {
  if (!S.me || S.me.callPref || S.me.callsOff || X._askedPref) return;
  if (document.querySelector('.modal-back')) { if (asks++ < 30) setTimeout(askPref, 6000); return; }
  X._askedPref = true;
  let picked = false;
  const pick = async (pref, off) => {
    picked = true;
    try { const r = await api('PUT', '/api/me/calls', off ? { off: true, pref: 'title' } : { pref }, { quiet: true }); S.me.callPref = r.callPref; S.me.callsOff = r.callsOff; } catch (e) { toast(e.message, 'error'); }
    m.close();
    if (!off && pref) toast(pref === 'sound' ? 'ringtone on. change it any time in settings' : 'ok, your tab title will flash instead', 'success');
  };
  const m = modal('calls are here', el('div', null,
    el('p', { style: 'margin-top:0' }, 'you can now voice and video call in dms, hop into voice channels in public rooms, and join stages. when someone calls you, how should we let you know?'),
    el('button', { class: 'btn primary wide', onclick: () => pick('sound') }, ic('bell', 16), 'play a ringtone'),
    el('button', { class: 'btn wide', style: 'margin-top:8px', onclick: () => pick('title') }, ic('chat', 16), 'no sound, flash the tab title'),
    el('p', { class: 'muted small' }, 'the tab title thing looks like (NAME IS CALLING!). you can switch in settings, or turn calls off for good.'),
    el('button', { class: 'btn ghost small', onclick: () => pick(null, true) }, 'turn calls off')), { onClose: () => { if (!picked) X._askedPref = false; } });
}
const boot = setInterval(() => {
  if (!S.token) return;
  if (S.me && S.wsOk) { clearInterval(boot); setTimeout(askPref, 2500); }
}, 1500);
setTimeout(() => clearInterval(boot), 600000);

let lastAct = Date.now(), sentAct = 0;
function sendAlive() { if (!K.room) return; sentAct = Date.now(); K.afk = false; sendWS({ t: 'vc_alive', room: K.room }); paintDock(); }
function noteAct() { lastAct = Date.now(); if (K.afk) sendAlive(); }
for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel']) window.addEventListener(ev, noteAct, { passive: true });
let moveAt = 0;
window.addEventListener('pointermove', () => { const n = Date.now(); if (n - moveAt > 3000) { moveAt = n; noteAct(); } }, { passive: true });
setInterval(() => { if (!K.room) return; if (K.mic && K.localAudio && K.dock && K.dock.querySelector('.tile.me.speaking')) lastAct = Date.now(); if (lastAct > sentAct && Date.now() - sentAct > 25000) sendAlive(); }, 12000);

function onWsReady() { if (K.room) cleanup('connection dropped, call ended'); stopIncoming(); }
function notifExtra(type, d) {
  if (type === 'missed_call') return `missed call from ${d.from}`;
  if (type === 'adminapp_new') return `${d.by} (@${d.username}) applied to be an admin`;
  if (type === 'adminapp_result') return d.approved ? 'your admin application was approved, welcome to the team' : 'your admin application was denied' + (d.response ? ': ' + d.response : '');
  if (type === 'vouch_ask') return `${d.from} (@${d.username}) asks you to vouch for them`;
  if (type === 'vouch_got') return `${d.from} vouched for you (${d.count}/${d.need})`;
  if (type === 'vouch_done') return 'you are verified, thanks to your vouchers';
  if (type === 'vouch_used') return `your vouch for ${d.name} helped verify them`;
  if (type === 'vouch_strike') return `${d.name} was banned after you vouched for them (${d.strikes}/${d.max} strikes)`;
  return null;
}

window.addEventListener('pagehide', () => { if (K.room) sendWS({ t: 'vc_leave', room: K.room }); });

const W = { host: null, st: null, p: null, key: '', off: 0, tick: 0, yt: null };
function wClose() {
  clearInterval(W.tick);
  if (W.p) { try { W.p.destroy(); } catch { /* gone */ } }
  if (W.host) W.host.remove();
  Object.assign(W, { host: null, st: null, p: null, key: '', tick: 0 });
}
const wPos = () => W.st.pos + (W.st.playing ? (Date.now() + W.off - W.st.at) / 1000 : 0);
const mmss = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function loadYT() {
  if (W.yt) return W.yt;
  W.yt = new Promise((res, rej) => {
    if (window.YT && window.YT.Player) return res();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); res(); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.onerror = () => rej(new Error('youtube is blocked on this network'));
    document.head.append(s);
    setTimeout(() => rej(new Error('youtube did not load')), 12000);
  });
  W.yt.catch(() => { W.yt = null; });
  return W.yt;
}
async function wBuild(st) {
  const stage = el('div', { class: 'watchstage' });
  const tapBox = el('div', { class: 'watchtap', style: 'display:none', onclick: () => { tapBox.style.display = 'none'; wSync(true); } }, el('span', null, 'tap to join the video'));
  let p;
  if (st.kind === 'yt') {
    await loadYT();
    const holder = el('div'); stage.append(holder);
    let ready = false;
    const pl = new window.YT.Player(holder, { videoId: st.id, width: '100%', height: '100%', playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, modestbranding: 1, fs: 0, iv_load_policy: 3, origin: location.origin }, events: { onReady: () => { ready = true; wSync(true); }, onError: () => toast('that video cannot be played here', 'error') } });
    p = { pos: () => (ready ? pl.getCurrentTime() : 0), dur: () => (ready ? pl.getDuration() : 0), play: () => { if (ready) pl.playVideo(); }, pause: () => { if (ready) pl.pauseVideo(); }, seek: (t) => { if (ready) pl.seekTo(t, true); }, vol: (x) => { if (ready) pl.setVolume(x * 100); }, destroy: () => { try { pl.destroy(); } catch { /* gone */ } } };
  } else {
    const v = el('video', { src: st.url, playsinline: true, preload: 'auto', style: 'width:100%;height:100%;background:#000' });
    v.controls = false; v.setAttribute('playsinline', '');
    stage.append(v);
    p = { pos: () => v.currentTime, dur: () => v.duration || 0, play: () => { v.play().catch(() => { tapBox.style.display = 'flex'; }); }, pause: () => v.pause(), seek: (t) => { try { v.currentTime = t; } catch { /* not ready */ } }, vol: (x) => { v.volume = x; }, destroy: () => { v.pause(); v.removeAttribute('src'); v.load(); } };
    v.onerror = () => toast('that video could not be loaded', 'error');
  }
  stage.append(el('div', { class: 'watchblock' }), tapBox);
  return { p, stage };
}
async function onWatch(m) {
  if (m.room !== K.room) return;
  if (!m.watch) { if (W.host) toast('watch together ended', 'info'); wClose(); return; }
  const st = m.watch; W.off = st.now - Date.now();
  const key = st.kind + '|' + st.url;
  if (key === W.key && W.p) { W.st = st; wSync(false); return; }
  wClose(); W.key = key; W.st = st;
  let built;
  try { built = await wBuild(st); } catch (e) { toast(e.message || 'could not start the video', 'error'); W.key = ''; return; }
  if (W.key !== key) { built.p.destroy(); return; }
  W.p = built.p;
  const play = el('button', { class: 'icon-btn', title: 'play or pause', onclick: () => { if (!W.p) return; sendWS({ t: 'vc_watch', room: K.room, act: W.st.playing ? 'pause' : 'play', pos: W.p.pos() }); } });
  const seek = el('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'watchseek', onchange: () => { const d = W.p && W.p.dur(); if (d) sendWS({ t: 'vc_watch', room: K.room, act: 'seek', pos: seek.value / 1000 * d }); } });
  const time = el('span', { class: 'small muted watchtime' }, '0:00');
  const vol = el('input', { type: 'range', min: 0, max: 100, value: 100, class: 'watchvol', title: 'volume', oninput: () => { if (W.p) W.p.vol(vol.value / 100); } });
  W.host = el('div', { class: 'watchdock' },
    el('div', { class: 'watchhead' }, ic('play', 15), el('b', null, 'watch together'), el('span', { class: 'muted small grow' }, 'started by ' + st.byName),
      el('button', { class: 'icon-btn tiny', title: 'stop watching for everyone', onclick: () => sendWS({ t: 'vc_watch', room: K.room, act: 'stop' }) }, ic('x', 14))),
    built.stage, el('div', { class: 'watchbar' }, play, seek, time, vol));
  document.body.append(W.host);
  W.tick = setInterval(() => {
    if (!W.p || !W.st) return;
    const d = W.p.dur(); const c = W.p.pos();
    if (d && document.activeElement !== seek) seek.value = Math.round(c / d * 1000);
    time.textContent = mmss(c) + ' / ' + mmss(d);
    play.replaceChildren(ic(W.st.playing ? 'pause' : 'play', 18));
    if (W.st.playing && Math.abs(c - wPos()) > 2.5) wSync(false);
  }, 700);
  wSync(true);
}
function wSync(force) {
  if (!W.p || !W.st) return;
  const t = wPos();
  if (force || Math.abs(W.p.pos() - t) > 1.3) W.p.seek(t);
  if (W.st.playing) W.p.play(); else W.p.pause();
}
function openWatchModal() {
  const inp = el('input', { placeholder: 'youtube link, or a direct https link to an mp4 or webm', maxLength: 500 });
  const m = window.__ui.modal('watch together', el('div', null, el('p', { class: 'muted small', style: 'margin-top:0' }, 'everyone in this call sees the same video at the same time. anyone in the call can pause or skip.'), inp,
    el('button', { class: 'btn primary wide', style: 'margin-top:10px', onclick: () => { const v = inp.value.trim(); if (!v) return; sendWS({ t: 'vc_watch', room: K.room, act: 'start', url: v }); m.close(); } }, ic('play', 16), 'start')));
  setTimeout(() => inp.focus(), 50);
}
function tuneSenders() {
  const n = K.members.length;
  const max = n > 9 ? 120000 : n > 6 ? 220000 : n > 4 ? 450000 : 1200000, scale = n > 9 ? 3 : n > 6 ? 2 : 1;
  for (const L of K.links.values()) for (const s of L.pc.getSenders()) {
    if (!s.track || s.track.kind !== 'video') continue;
    try { const prm = s.getParameters(); if (!prm.encodings || !prm.encodings.length) prm.encodings = [{}]; prm.encodings[0].maxBitrate = max; prm.encodings[0].scaleResolutionDownBy = scale; s.setParameters(prm).catch(() => {}); } catch { /* unsupported */ }
  }
}
setInterval(() => { if (K.room) tuneSenders(); }, 8000);

Object.assign(window.__ext, { onCall, startCall, joinChannel, callRoom: () => K.room, callSettingsRows, onWsReady, notifExtra, testRing, _callState: K });
})();

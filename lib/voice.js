const safety = require('./safety');
const mod = require('./mod');

const CAPS_OLD = { dm: 2, voice: 10, video: 6, stage: 40 };
const CAPS_NEW = { dm: 2, voice: 12, video: 12, stage: 40 };
const drop = require('./drop');
const capFor = (kind, user) => (drop.on(user) ? CAPS_NEW : CAPS_OLD)[kind];

function parseWatch(raw) {
  const s = String(raw || '').trim();
  if (s.length < 6 || s.length > 500) return null;
  const yt = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/.exec(s);
  if (yt) return { kind: 'yt', id: yt[1], url: 'https://www.youtube.com/watch?v=' + yt[1] };
  let u; try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return null;
  if (!/\.(mp4|webm|ogv|m4v)$/i.test(u.pathname)) return null;
  return { kind: 'file', id: '', url: u.toString() };
}
const watchOut = (r) => (r.watch ? { kind: r.watch.kind, id: r.watch.id, url: r.watch.url, byName: r.watch.byName, playing: r.watch.playing, pos: r.watch.pos, at: r.watch.at, now: Date.now() } : null);
const MAX_SPEAKERS = 6;
const RING_MS = 45_000;

let C = null;
const rooms = new Map();
const userRoom = new Map();
const ringTimers = new Map();

const AFK_WARN_MS = parseInt(process.env.AFK_WARN_MS, 10) || 8 * 60_000;
const AFK_KICK_MS = parseInt(process.env.AFK_KICK_MS, 10) || 10 * 60_000;

function init(ctx) {
  C = ctx;
  setInterval(() => {
    const now = Date.now();
    for (const r of [...rooms.values()]) {
      for (const [id, m] of [...r.members.entries()]) {
        const idle = now - (m.seen || now);
        if (idle > AFK_KICK_MS) dropUser(id, 'afk');
        else if (idle > AFK_WARN_MS && !m.warned) { m.warned = true; C.sendTo(id, { t: 'vc_afk_warn', room: r.key, secs: Math.round((AFK_KICK_MS - idle) / 1000) }); }
      }
    }
  }, Math.min(15_000, Math.max(1_000, Math.floor(AFK_WARN_MS / 3)))).unref();
}

function occupants(channelId) {
  const r = rooms.get('ch:' + channelId);
  return r ? r.members.size : 0;
}

function snapshot(r) {
  return {
    t: 'vc_state', room: r.key, kind: r.kind, convId: r.convId, channelId: r.channelId || null, name: r.name || '',
    ringing: r.ringing ? { from: r.ringing.from, to: r.ringing.to } : null,
    members: [...r.members.entries()].map(([id, m]) => ({ id, name: m.name, avatar: m.avatar, speaker: m.speaker, hand: m.hand, mic: m.mic, cam: m.cam, e: m.e, staff: m.staff }))
  };
}
function broadcast(r) {
  const s = snapshot(r);
  for (const id of r.members.keys()) C.sendTo(id, s);
}
async function liveChanged(r) {
  if (r.channelId) await C.sendToConv(r.convId, { t: 'vc_live', convId: r.convId, channelId: r.channelId, n: r.members.size });
}

async function resolve(user, key) {
  if (typeof key !== 'string') return { error: 'bad room' };
  if (key.startsWith('dm:')) {
    const convId = key.slice(3);
    if (!C.isUuid(convId)) return { error: 'bad room' };
    const cv = (await C.q(`select c.type from conversations c join members m on m.conv_id=c.id and m.user_id=$2 where c.id=$1`, [convId, user.id])).rows[0];
    if (!cv || cv.type !== 'dm') return { error: 'not your chat' };
    const other = (await C.q('select user_id from members where conv_id=$1 and user_id<>$2', [convId, user.id])).rows[0];
    if (!other) return { error: 'nobody to call' };
    if (await C.isBlockedEitherWay(user.id, other.user_id)) return { error: 'blocked' };
    return { kind: 'dm', convId, peer: other.user_id, name: '', staff: false };
  }
  if (key.startsWith('ch:')) {
    const cid = key.slice(3);
    if (!C.isUuid(cid)) return { error: 'bad room' };
    const ch = (await C.q(`select ch.id,ch.name,ch.kind,ch.conv_id,m.role,m.muted_until,cv.is_public from channels ch join conversations cv on cv.id=ch.conv_id join members m on m.conv_id=ch.conv_id and m.user_id=$2 where ch.id=$1`, [cid, user.id])).rows[0];
    if (!ch || !ch.is_public) return { error: 'channel not found' };
    if (ch.kind === 'text') return { error: 'that is a text channel' };
    const staff = mod.isStaff(user, ch.role);
    if (!staff && !safety.verifiedOn(user)) return { error: 'verify your account to join voice' };
    if (user.muted_until && new Date(user.muted_until) > new Date()) return { error: 'you are muted' };
    if (ch.muted_until && new Date(ch.muted_until) > new Date()) return { error: 'you are muted in this room' };
    return { kind: ch.kind, convId: ch.conv_id, channelId: ch.id, name: ch.name, staff };
  }
  return { error: 'bad room' };
}

function dropUser(userId, why) {
  const key = userRoom.get(userId);
  if (!key) return;
  userRoom.delete(userId);
  const r = rooms.get(key);
  if (!r) return;
  r.members.delete(userId);
  if (why) C.sendTo(userId, { t: 'vc_closed', room: key, why });
  if (r.kind === 'dm') {
    if (r.ringing && r.ringing.from === userId) {
      clearTimeout(ringTimers.get(key)); ringTimers.delete(key);
      C.sendTo(r.ringing.to, { t: 'call_gone', room: key });
      r.ringing = null;
    }
    if (r.members.size < 2) return endRoom(key, 'ended');
  }
  if (!r.members.size) { rooms.delete(key); liveChanged(r).catch(() => {}); return; }
  broadcast(r);
  liveChanged(r).catch(() => {});
}

function endRoom(key, why) {
  const r = rooms.get(key);
  if (!r) return;
  rooms.delete(key);
  clearTimeout(ringTimers.get(key)); ringTimers.delete(key);
  for (const id of r.members.keys()) { if (userRoom.get(id) === key) userRoom.delete(id); C.sendTo(id, { t: 'vc_closed', room: key, why }); }
  liveChanged({ ...r, members: new Map() }).catch(() => {});
}
function closeRoom(key) { endRoom(key, 'deleted'); }

async function join(user, key, extra = {}) {
  const info = await resolve(user, key);
  if (info.error) return C.sendTo(user.id, { t: 'vc_error', room: key, message: info.error });
  if (userRoom.get(user.id) && userRoom.get(user.id) !== key) dropUser(user.id, 'moved');
  let r = rooms.get(key);
  if (!r) {
    if (info.kind === 'dm') return C.sendTo(user.id, { t: 'vc_error', room: key, message: 'that call already ended' });
    r = { key, kind: info.kind, convId: info.convId, channelId: info.channelId, name: info.name, members: new Map(), ringing: null };
    rooms.set(key, r);
  }
  const rejoin = r.members.has(user.id);
  if (!rejoin && r.members.size >= capFor(r.kind, user)) return C.sendTo(user.id, { t: 'vc_error', room: key, message: r.kind === 'dm' ? 'that call is full' : `this ${r.kind} channel is full (${capFor(r.kind, user)} max)` });
  if (r.kind === 'dm' && r.ringing && r.ringing.to === user.id) {
    clearTimeout(ringTimers.get(key)); ringTimers.delete(key);
    r.ringing = null;
  }
  const speakers = [...r.members.values()].filter((m) => m.speaker).length;
  const prev = r.members.get(user.id);
  const speaker = r.kind === 'stage' ? (prev ? prev.speaker : info.staff && speakers < MAX_SPEAKERS) : true;
  r.members.set(user.id, { name: user.display_name, avatar: user.avatar || null, speaker, hand: false, mic: !!extra.mic && speaker, cam: false, e: Date.now(), staff: !!info.staff, seen: Date.now(), warned: false });
  userRoom.set(user.id, key);
  broadcast(r);
  if (r.watch) C.sendTo(user.id, { t: 'vc_watch', room: key, watch: watchOut(r), from: null });
  if (!rejoin) liveChanged(r).catch(() => {});
}

async function startCall(user, m) {
  const key = 'dm:' + m.convId;
  if (!C.limiter.hit('callstart:' + user.id, 8, 60_000).ok) return C.sendTo(user.id, { t: 'call_fail', convId: m.convId, reason: 'slow down, you are calling a lot' });
  const info = await resolve(user, key);
  if (info.error) return C.sendTo(user.id, { t: 'call_fail', convId: m.convId, reason: info.error });
  if (user.calls_off) return C.sendTo(user.id, { t: 'call_fail', convId: m.convId, reason: 'you turned calls off in settings' });
  const callee = (await C.q('select id,calls_off,dnd_until,quiet,banned,display_name,status_mode from users where id=$1', [info.peer])).rows[0];
  if (!callee || callee.banned) return C.sendTo(user.id, { t: 'call_fail', convId: m.convId, reason: 'cannot reach them' });
  if (callee.calls_off) return C.sendTo(user.id, { t: 'call_fail', convId: m.convId, reason: `${callee.display_name} has calls turned off` });
  if (mod.dndActive(callee)) return C.sendTo(user.id, { t: 'call_fail', convId: m.convId, reason: `${callee.display_name} is on do not disturb` });
  if (!C.sockets.has(callee.id)) return C.sendTo(user.id, { t: 'call_fail', convId: m.convId, reason: `${callee.display_name} is offline` });
  const existing = rooms.get(key);
  if (existing && existing.members.has(callee.id)) { await join(user, key); return; }
  if (userRoom.get(callee.id) && userRoom.get(callee.id) !== key) return C.sendTo(user.id, { t: 'call_fail', convId: m.convId, reason: `${callee.display_name} is in another call` });
  if (existing) endRoom(key, 'replaced');
  if (userRoom.get(user.id)) dropUser(user.id, 'moved');
  const r = { key, kind: 'dm', convId: m.convId, members: new Map(), ringing: { from: user.id, to: callee.id }, name: '' };
  rooms.set(key, r);
  r.members.set(user.id, { name: user.display_name, avatar: user.avatar || null, speaker: true, hand: false, mic: true, cam: false, e: Date.now(), staff: false, seen: Date.now(), warned: false });
  userRoom.set(user.id, key);
  broadcast(r);
  C.sendTo(callee.id, { t: 'call_incoming', room: key, convId: m.convId, video: !!m.video, from: { id: user.id, name: user.display_name, avatar: user.avatar || null } });
  ringTimers.set(key, setTimeout(() => {
    const rr = rooms.get(key);
    if (!rr || !rr.ringing) return;
    C.sendTo(callee.id, { t: 'call_gone', room: key });
    C.sendTo(user.id, { t: 'call_missed', room: key, convId: m.convId });
    C.notify(callee.id, 'missed_call', { convId: m.convId, from: user.display_name, fromId: user.id }).catch(() => {});
    endRoom(key, 'missed');
  }, RING_MS));
}

async function handle(ws, m) {
  const uid = ws.userId;
  const user = (await C.q('select * from users where id=$1 and not banned', [uid])).rows[0];
  if (!user) return;
  const r = typeof m.room === 'string' ? rooms.get(m.room) : null;
  const me = r && r.members.get(uid);

  if (m.t === 'call_start' && C.isUuid(m.convId)) return startCall(user, m);
  if (m.t === 'call_decline' || m.t === 'call_cancel') {
    if (!r || r.kind !== 'dm' || !r.ringing) return;
    if (m.t === 'call_decline' && r.ringing.to === uid) { C.sendTo(r.ringing.from, { t: 'call_declined', room: r.key, convId: r.convId }); return endRoom(r.key, 'declined'); }
    if (m.t === 'call_cancel' && r.ringing.from === uid) { C.sendTo(r.ringing.to, { t: 'call_gone', room: r.key }); return endRoom(r.key, 'cancelled'); }
    return;
  }
  if (m.t === 'vc_join') {
    if (!C.limiter.hit('vcjoin:' + uid, 12, 30_000).ok) return C.sendTo(uid, { t: 'vc_error', room: m.room, message: 'slow down' });
    return join(user, m.room, { mic: m.mic !== false });
  }
  if (m.t === 'vc_leave') { if (userRoom.get(uid) === m.room) dropUser(uid); return; }
  if (!r || !me) return;
  if (m.t !== 'vc_sig') { me.seen = Date.now(); me.warned = false; }
  if (m.t === 'vc_alive') return;

  if (m.t === 'vc_sig') {
    if (!C.isUuid(m.to) || !r.members.has(m.to) || typeof m.data !== 'string' || m.data.length > 14000) return;
    return C.sendTo(m.to, { t: 'vc_sig', room: r.key, from: uid, data: m.data });
  }
  if (m.t === 'vc_media') {
    if (typeof m.mic === 'boolean') me.mic = m.mic && (r.kind !== 'stage' || me.speaker);
    if (typeof m.cam === 'boolean') me.cam = m.cam && r.kind !== 'stage' && r.kind !== 'voice';
    return broadcast(r);
  }
  if (m.t === 'vc_watch') {
    if (!drop.on(user)) return;
    if (r.kind === 'stage' && !me.staff) return;
    if (!C.limiter.hit('vcwatch:' + uid, 40, 10_000).ok) return;
    const a = m.act;
    if (a === 'start') {
      const w = parseWatch(m.url);
      if (!w) return C.sendTo(uid, { t: 'vc_error', room: r.key, message: 'paste a youtube link or a direct https link to an mp4 or webm' });
      r.watch = { ...w, byName: me.name, by: uid, playing: true, pos: 0, at: Date.now() };
    } else if (!r.watch) return;
    else if (a === 'stop') r.watch = null;
    else if (a === 'play' || a === 'pause' || a === 'seek') {
      const pos = Number(m.pos);
      r.watch.pos = Number.isFinite(pos) ? Math.max(0, Math.min(pos, 86400)) : r.watch.pos;
      if (a !== 'seek') r.watch.playing = a === 'play';
      r.watch.at = Date.now();
    } else return;
    for (const id of r.members.keys()) C.sendTo(id, { t: 'vc_watch', room: r.key, watch: watchOut(r), from: uid });
    return;
  }
  if (r.kind !== 'stage') return;
  if (m.t === 'vc_hand') {
    if (me.speaker) return;
    me.hand = !!m.up;
    broadcast(r);
    return;
  }
  const target = C.isUuid(m.user) ? r.members.get(m.user) : null;
  const staff = me.staff;
  if (m.t === 'vc_promote') {
    if (!target) return;
    if (m.user === uid) { if (m.on) return; target.speaker = false; target.mic = false; target.e = Date.now(); return broadcast(r); }
    if (!staff) return;
    if (m.on) {
      if ([...r.members.values()].filter((x) => x.speaker).length >= MAX_SPEAKERS) return C.sendTo(uid, { t: 'vc_error', room: r.key, message: `a stage holds ${MAX_SPEAKERS} speakers at once` });
      target.speaker = true; target.hand = false;
    } else {
      if (target.staff) return;
      target.speaker = false; target.mic = false;
    }
    target.e = Date.now();
    return broadcast(r);
  }
  if (m.t === 'vc_kick' && staff && target && !target.staff) {
    dropUser(m.user, 'kicked');
    return;
  }
  if (m.t === 'vc_forcemute' && staff && target && !target.staff) {
    target.mic = false;
    C.sendTo(m.user, { t: 'vc_forcemute', room: r.key });
    return broadcast(r);
  }
}

function onSocketsGone(userId) { dropUser(userId); }

module.exports = { init, occupants, closeRoom, handle, onSocketsGone, dropUser };

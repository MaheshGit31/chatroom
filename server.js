// server.js - Chatroom backend (express + ws + postgres)
// the server only ever stores ciphertext: keys are made and used in the browser (webcrypto)
if (require('fs').existsSync(__dirname + '/client')) require('./build.js'); // dev only: rebuild public/index.html from client/ parts
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const webpush = require('web-push');
const { q, pool, init } = require('./lib/db');
const { limiter, rl } = require('./lib/limiter');
const { Games } = require('./lib/games');

const PORT = process.env.PORT || 3000;
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'bart').toLowerCase();   // this username becomes the owner/admin
const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || '';                      // if set, registering the owner name needs this key (stops name squatting)
const TTL_HOURS = Math.max(1, parseInt(process.env.MESSAGE_TTL_HOURS, 10) || 48); // messages self-delete after this long
const STATUS_ICONS = ['coffee', 'book', 'moon', 'music', 'code', 'gamepad', 'heart', 'sun', 'leaf', 'flame', 'headphones', 'pizza']; // allowed status icons
const STATUS_MODES = ['online', 'busy', 'invisible'];
const games = new Games();
const app = express();
app.set('trust proxy', 1);                                   // railway sits in front, req.ip becomes the real client ip
app.disable('x-powered-by');

// ---------- small helpers ----------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const b64re = /^[A-Za-z0-9+/=_-]+$/;                         // allowed base64 / base64url characters
const isB64 = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max && b64re.test(s);
const isUuid = (s) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); // async errors -> error handler
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? no(e) : ok(k.toString('hex')))));

let SERVER_SECRET = '';                                      // loaded from db, used for fake salts
let pushReady = false;

// ---------- cors + headers (token auth, so no cookies, so * is safe) ----------
app.use((req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Expose-Headers': 'Retry-After',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '64kb' }));                    // ciphertext is small, big bodies are rejected
app.use('/api', rl('api-ip', 300, 60_000));                  // global per-ip cap

// ---------- realtime hub ----------
const sockets = new Map();                                   // userId -> Set<ws>
const activityNow = new Map();                               // userId -> { playId, path, title, since }
const ipConns = new Map();                                   // ip -> open socket count

function sendTo(userId, evt) {
  const set = sockets.get(userId);
  if (!set) return;
  const data = JSON.stringify(evt);
  for (const ws of set) if (ws.readyState === 1) ws.send(data);
}
async function convMembers(convId) {
  const r = await q('select user_id from members where conv_id=$1', [convId]);
  return r.rows.map((x) => x.user_id);
}
async function sendToConv(convId, evt, except) {
  for (const uid of await convMembers(convId)) if (uid !== except) sendTo(uid, evt);
}
// everyone who shares at least one conversation with this user
async function peersOf(userId) {
  const r = await q('select distinct m2.user_id from members m1 join members m2 on m1.conv_id=m2.conv_id where m1.user_id=$1 and m2.user_id<>$1', [userId]);
  return r.rows.map((x) => x.user_id);
}
async function presenceOf(userId) {
  const u = await q('select share_activity,status_text,status_icon,status_mode from users where id=$1', [userId]);
  const row = u.rows[0] || {};
  const a = row.share_activity && row.status_mode !== 'invisible' ? activityNow.get(userId) : null;
  return { userId, online: sockets.has(userId) && row.status_mode !== 'invisible', mode: row.status_mode || 'online', status: statusOf(row), activity: a ? { title: a.title, path: a.path, since: a.since } : null };
}
async function broadcastPresence(userId) {
  const evt = { t: 'presence', ...(await presenceOf(userId)) };
  for (const p of await peersOf(userId)) sendTo(p, evt);
}

// ---------- push (generic payloads only, the server cannot read messages) ----------
const pushThrottle = new Map();
async function pushTo(userId, convId, title) {
  if (!pushReady) return;
  const k = `${userId}:${convId}`;
  if (Date.now() - (pushThrottle.get(k) || 0) < 30_000) return; // max one push per conversation per 30s
  pushThrottle.set(k, Date.now());
  const subs = await q('select * from push_subs where user_id=$1', [userId]);
  for (const s of subs.rows) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: title || 'Chatroom', body: 'You have a new message', convId }), { TTL: 3600 });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await q('delete from push_subs where endpoint=$1', [s.endpoint]); // dead subscription
    }
  }
}
async function notify(userId, type, data) {
  const r = await q('insert into notifications(user_id,type,data) values($1,$2,$3) returning id,created_at', [userId, type, data]);
  sendTo(userId, { t: 'notif', notif: { id: r.rows[0].id, type, data, read: false, createdAt: r.rows[0].created_at } });
}

// ---------- auth ----------
const auth = wrap(async (req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return bad(res, 'unauthorized', 401);
  const r = await q(
    `select u.id,u.username,u.display_name,u.share_activity,u.is_admin,u.banned,u.status_text,u.status_icon,u.status_mode,u.status_expires,s.expires_at from sessions s join users u on u.id=s.user_id
     where s.token_hash=$1 and s.expires_at>now()`, [sha256(token)]);
  if (!r.rows[0] || r.rows[0].banned) return bad(res, r.rows[0] ? 'account suspended' : 'unauthorized', 401);
  req.user = r.rows[0];
  req.tokenHash = sha256(token);
  next();
});
const byUser = (name, max, win) => rl(name, max, win, (req) => req.user.id); // limiter keyed by user id

async function makeSession(userId, ua) {
  const token = crypto.randomBytes(32).toString('base64url');
  await q('insert into sessions(token_hash,user_id,expires_at,ua) values($1,$2,now()+interval \'30 days\',$3)', [sha256(token), userId, (ua || '').slice(0, 200)]);
  return token;
}
const statusOf = (u) => (u.status_text || u.status_icon ? { text: u.status_text || '', icon: u.status_icon || '' } : null);
const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.display_name, shareActivity: u.share_activity, isAdmin: !!u.is_admin, isOwner: u.username === ADMIN_USERNAME, mode: u.status_mode || 'online', status: statusOf(u), statusExpires: u.status_expires || null });

const SECS = "(case when p.ended_at is null then floor(extract(epoch from (now()-p.started_at)))::int else p.seconds end)"; // running sessions count live
const USERNAME = /^[a-z0-9_]{3,20}$/;
app.post('/api/auth/salt', rl('salt', 30, 60_000), wrap(async (req, res) => {
  const username = String(req.body.username || '').toLowerCase();
  if (!USERNAME.test(username)) return bad(res, 'bad username');
  const r = await q('select kdf_salt from users where username=$1', [username]);
  // unknown usernames get a stable fake salt so attackers cannot tell who exists
  const salt = r.rows[0] ? r.rows[0].kdf_salt : crypto.createHmac('sha256', SERVER_SECRET).update(username).digest('base64url').slice(0, 22);
  res.json({ kdfSalt: salt });
}));

app.post('/api/auth/register', rl('register', 5, 3_600_000), wrap(async (req, res) => {
  const b = req.body;
  const username = String(b.username || '').toLowerCase();
  const displayName = String(b.displayName || username).trim().slice(0, 32) || username;
  if (!USERNAME.test(username)) return bad(res, 'username must be 3-20 chars: a-z 0-9 _');
  if (username === ADMIN_USERNAME && ADMIN_SETUP_KEY && sha256(String(b.setupKey || '')) !== sha256(ADMIN_SETUP_KEY)) return res.status(403).json({ error: 'setup_key_required', message: 'this name is reserved, enter the setup key' });
  if (![b.kdfSalt, b.authSecret, b.publicKey, b.wrappedPriv, b.wrappedPrivIv].every((x) => isB64(x, 2000))) return bad(res, 'bad key material');
  const authSalt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(b.authSecret, authSalt);
  try {
    const r = await q(
      `insert into users(username,display_name,kdf_salt,auth_salt,auth_hash,public_key,wrapped_priv,wrapped_priv_iv,is_admin)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [username, displayName, b.kdfSalt, authSalt, hash, b.publicKey, b.wrappedPriv, b.wrappedPrivIv, username === ADMIN_USERNAME]);
    const token = await makeSession(r.rows[0].id, req.headers['user-agent']);
    res.json({ token, user: publicUser(r.rows[0]) });
  } catch (e) {
    if (e.code === '23505') return bad(res, 'username taken', 409);
    throw e;
  }
}));

app.post('/api/auth/login',
  rl('login-ip', 15, 600_000),
  (req, res, next) => rl('login-user', 8, 600_000, () => String(req.body.username || '').toLowerCase())(req, res, next),
  wrap(async (req, res) => {
    const username = String(req.body.username || '').toLowerCase();
    const secret = String(req.body.authSecret || '');
    const r = await q('select * from users where username=$1', [username]);
    const u = r.rows[0];
    const given = await scrypt(secret, u ? u.auth_salt : 'fake-salt-fake-salt');   // always burn the same time
    const ok = u && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(u.auth_hash));
    if (!ok) return bad(res, 'wrong username or password', 401);
    if (u.banned) return bad(res, 'this account is suspended', 403);
    const token = await makeSession(u.id, req.headers['user-agent']);
    res.json({ token, user: publicUser(u), publicKey: u.public_key, wrappedPriv: u.wrapped_priv, wrappedPrivIv: u.wrapped_priv_iv });
  }));

app.post('/api/auth/logout', auth, wrap(async (req, res) => {
  await q('delete from sessions where token_hash=$1', [req.tokenHash]);
  res.json({ ok: true });
}));

app.get('/api/me', auth, wrap(async (req, res) => {
  const r = await q('select public_key,wrapped_priv,wrapped_priv_iv from users where id=$1', [req.user.id]);
  res.json({ user: publicUser(req.user), ttlHours: TTL_HOURS, publicKey: r.rows[0].public_key, wrappedPriv: r.rows[0].wrapped_priv, wrappedPrivIv: r.rows[0].wrapped_priv_iv });
}));

app.patch('/api/me', auth, byUser('me-patch', 20, 60_000), wrap(async (req, res) => {
  const sets = [], vals = [req.user.id];
  if (typeof req.body.displayName === 'string') { vals.push(req.body.displayName.trim().slice(0, 32) || req.user.username); sets.push(`display_name=$${vals.length}`); }
  if (typeof req.body.shareActivity === 'boolean') { vals.push(req.body.shareActivity); sets.push(`share_activity=$${vals.length}`); }
  if (!sets.length) return bad(res, 'nothing to update');
  const r = await q(`update users set ${sets.join(',')} where id=$1 returning *`, vals);
  broadcastPresence(req.user.id).catch(() => {});
  res.json({ user: publicUser(r.rows[0]) });
}));


// ---------- custom status ----------
app.put('/api/me/status', auth, byUser('status', 20, 60_000), wrap(async (req, res) => {
  const b = req.body || {};
  const text = String(b.text || '').trim().slice(0, 48);                       // short blurb
  const icon = STATUS_ICONS.includes(b.icon) ? b.icon : '';                     // only known icons
  const mode = STATUS_MODES.includes(b.mode) ? b.mode : 'online';
  const mins = Math.min(Math.max(parseInt(b.expiresMinutes, 10) || 0, 0), 60 * 24 * 7);
  const r = await q(`update users set status_text=$2,status_icon=$3,status_mode=$4,status_expires=${mins ? "now()+make_interval(mins=>$5)" : 'null'} where id=$1 returning *`,
    mins ? [req.user.id, text || null, icon || null, mode, mins] : [req.user.id, text || null, icon || null, mode]);
  broadcastPresence(req.user.id).catch(() => {});
  res.json({ user: publicUser(r.rows[0]) });
}));

// ---------- admin ----------
const adminOnly = (req, res, next) => (req.user.is_admin ? next() : bad(res, 'forbidden', 403));
const ownerOnly = (req, res, next) => (req.user.username === ADMIN_USERNAME ? next() : bad(res, 'only the owner can do that', 403));
const adminRow = (u) => ({ id: u.id, username: u.username, displayName: u.display_name, isAdmin: u.is_admin, isOwner: u.username === ADMIN_USERNAME, banned: u.banned, online: sockets.has(u.id), createdAt: u.created_at, messages: Number(u.msgs || 0) });

app.get('/api/admin/stats', auth, adminOnly, wrap(async (req, res) => {
  const r = await q(`select (select count(*) from users)::int users, (select count(*) from users where banned)::int banned,
    (select count(*) from messages)::int messages, (select count(*) from conversations where type='group')::int groups,
    (select count(*) from plays)::int plays, pg_database_size(current_database())::bigint bytes`);
  res.json({ ...r.rows[0], bytes: Number(r.rows[0].bytes), online: sockets.size, ttlHours: TTL_HOURS });
}));

app.get('/api/admin/users', auth, adminOnly, wrap(async (req, res) => {
  const needle = String(req.query.q || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  const r = await q(`select u.*, (select count(*) from messages where sender_id=u.id) msgs from users u where u.username like $1 order by u.is_admin desc, u.created_at limit 100`, [needle + '%']);
  res.json({ users: r.rows.map(adminRow) });
}));

app.post('/api/admin/users/:id/admin', auth, adminOnly, ownerOnly, wrap(async (req, res) => {
  const t = await q('select username from users where id=$1', [req.params.id]);
  if (!t.rows[0]) return bad(res, 'not found', 404);
  if (t.rows[0].username === ADMIN_USERNAME) return bad(res, 'the owner stays admin');
  await q('update users set is_admin=$2 where id=$1', [req.params.id, !!req.body.admin]);
  sendTo(req.params.id, { t: 'me_update' });
  res.json({ ok: true });
}));

app.post('/api/admin/users/:id/ban', auth, adminOnly, wrap(async (req, res) => {
  const t = await q('select username,is_admin from users where id=$1', [req.params.id]);
  if (!t.rows[0]) return bad(res, 'not found', 404);
  if (t.rows[0].username === ADMIN_USERNAME) return bad(res, 'cannot touch the owner', 403);
  if (t.rows[0].is_admin && req.user.username !== ADMIN_USERNAME) return bad(res, 'only the owner can suspend admins', 403);
  const banned = !!req.body.banned;
  await q('update users set banned=$2 where id=$1', [req.params.id, banned]);
  if (banned) {
    await q('delete from sessions where user_id=$1', [req.params.id]);
    for (const ws of [...(sockets.get(req.params.id) || [])]) ws.close(4001, 'suspended');
  }
  res.json({ ok: true });
}));

app.delete('/api/admin/users/:id', auth, adminOnly, wrap(async (req, res) => {
  const t = await q('select username,is_admin from users where id=$1', [req.params.id]);
  if (!t.rows[0]) return bad(res, 'not found', 404);
  if (t.rows[0].username === ADMIN_USERNAME) return bad(res, 'cannot touch the owner', 403);
  if (t.rows[0].is_admin && req.user.username !== ADMIN_USERNAME) return bad(res, 'only the owner can remove admins', 403);
  for (const ws of [...(sockets.get(req.params.id) || [])]) ws.close(4001, 'removed');
  await q('delete from users where id=$1', [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/admin/purge', auth, adminOnly, wrap(async (req, res) => {
  const what = req.body.what;
  if (what === 'plays') await q('delete from plays where ended_at is not null');
  else if (what === 'messages') await sweepExpired();
  else return bad(res, 'unknown');
  res.json({ ok: true });
}));

// ---------- expiry: messages vanish after TTL_HOURS ----------
async function sweepExpired() {
  const m = await q(`delete from messages where created_at < now() - make_interval(hours=>$1)`, [TTL_HOURS]);
  await q(`delete from notifications where created_at < now() - make_interval(hours=>$1)`, [TTL_HOURS]);
  await q(`delete from plays where ended_at is not null and ended_at < now() - interval '14 days'`);
  const ex = await q(`update users set status_text=null,status_icon=null,status_mode='online',status_expires=null where status_expires is not null and status_expires<now() returning id`);
  for (const u of ex.rows) broadcastPresence(u.id).catch(() => {});
  if (m.rowCount) console.log(`expiry: removed ${m.rowCount} messages`);
}

// ---------- users ----------
app.get('/api/users/search', auth, byUser('usearch', 30, 60_000), wrap(async (req, res) => {
  const s = String(req.query.q || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
  if (s.length < 2) return res.json({ users: [] });
  const r = await q(`select id,username,display_name from users where username like $1 and id<>$2 order by username limit 10`, [s + '%', req.user.id]);
  res.json({ users: r.rows.map((u) => ({ id: u.id, username: u.username, displayName: u.display_name })) });
}));

app.get('/api/users/:username', auth, byUser('uprofile', 60, 60_000), wrap(async (req, res) => {
  const r = await q('select id,username,display_name,public_key,share_activity,created_at,status_text,status_icon,status_mode,is_admin from users where username=$1', [req.params.username.toLowerCase()]);
  const u = r.rows[0];
  if (!u) return bad(res, 'not found', 404);
  let stats = null;
  if (u.share_activity || u.id === req.user.id) {
    const t = await q(`select coalesce(sum(${SECS}),0)::int total, count(distinct p.game_path)::int games from plays p where p.user_id=$1`, [u.id]);
    const top = await q(`select p.game_path,p.game_title,sum(${SECS})::int seconds from plays p where p.user_id=$1 group by 1,2 order by 3 desc limit 5`, [u.id]);
    stats = { totalSeconds: t.rows[0].total, gamesPlayed: t.rows[0].games, top: top.rows.map((x) => ({ path: x.game_path, title: x.game_title, seconds: x.seconds })) };
  }
  const blocked = await q('select 1 from blocks where blocker=$1 and blocked=$2', [req.user.id, u.id]);
  res.json({ id: u.id, username: u.username, displayName: u.display_name, publicKey: u.public_key, createdAt: u.created_at, online: sockets.has(u.id) && u.status_mode !== 'invisible', mode: u.status_mode, status: statusOf(u), isAdmin: u.is_admin, isOwner: u.username === ADMIN_USERNAME, blocked: !!blocked.rows[0], stats, activity: u.share_activity && activityNow.get(u.id) ? { title: activityNow.get(u.id).title, path: activityNow.get(u.id).path } : null });
}));

app.post('/api/blocks/:username', auth, byUser('block', 20, 3_600_000), wrap(async (req, res) => {
  const u = await q('select id from users where username=$1', [req.params.username.toLowerCase()]);
  if (!u.rows[0] || u.rows[0].id === req.user.id) return bad(res, 'bad user');
  await q('insert into blocks values($1,$2) on conflict do nothing', [req.user.id, u.rows[0].id]);
  res.json({ ok: true });
}));
app.delete('/api/blocks/:username', auth, wrap(async (req, res) => {
  const u = await q('select id from users where username=$1', [req.params.username.toLowerCase()]);
  if (u.rows[0]) await q('delete from blocks where blocker=$1 and blocked=$2', [req.user.id, u.rows[0].id]);
  res.json({ ok: true });
}));
const isBlockedEitherWay = async (a, b) => (await q('select 1 from blocks where (blocker=$1 and blocked=$2) or (blocker=$2 and blocked=$1)', [a, b])).rows.length > 0;

// ---------- conversations ----------
async function loadConversations(userId, onlyId) {
  const convs = await q(
    `select c.id,c.type,c.name,c.key_version,c.created_at,m.role,m.muted,m.last_read_at,m.joined_at,
       (select count(*) from messages x where x.conv_id=c.id and x.created_at>m.last_read_at and x.created_at>=m.joined_at and x.sender_id is distinct from $1 and not x.deleted and x.created_at>now()-interval '${TTL_HOURS} hours')::int unread,
       (select row_to_json(l) from (select id,sender_id "senderId",ciphertext,iv,key_version "keyVersion",created_at "createdAt",deleted from messages where conv_id=c.id and created_at>=m.joined_at and created_at>now()-interval '${TTL_HOURS} hours' order by id desc limit 1) l) last_message,
       (select max(created_at) from messages where conv_id=c.id and created_at>=m.joined_at and created_at>now()-interval '${TTL_HOURS} hours') last_at
     from conversations c join members m on m.conv_id=c.id and m.user_id=$1
     ${onlyId ? 'where c.id=$2' : ''}
     order by coalesce((select max(created_at) from messages where conv_id=c.id), c.created_at) desc`,
    onlyId ? [userId, onlyId] : [userId]);
  const ids = convs.rows.map((c) => c.id);
  if (!ids.length) return { conversations: [], keyUsers: {} };
  const mem = await q(
    `select cm.conv_id,cm.role,cm.last_read_at,u.id,u.username,u.display_name,u.public_key,u.status_text,u.status_icon,u.status_mode,u.is_admin from members cm join users u on u.id=cm.user_id where cm.conv_id=any($1) order by cm.joined_at`, [ids]);
  const keys = await q('select conv_id,version,wrapped_key,iv,wrapped_by from group_keys where user_id=$1 and conv_id=any($2)', [userId, ids]);
  const wrappers = [...new Set(keys.rows.map((k) => k.wrapped_by).filter(Boolean))];
  const ku = wrappers.length ? await q('select id,username,public_key from users where id=any($1)', [wrappers]) : { rows: [] };
  const keyUsers = {};
  for (const u of ku.rows) keyUsers[u.id] = { username: u.username, publicKey: u.public_key };
  const conversations = convs.rows.map((c) => ({
    id: c.id, type: c.type, name: c.name, keyVersion: c.key_version, createdAt: c.created_at, role: c.role, muted: c.muted,
    lastReadAt: c.last_read_at, joinedAt: c.joined_at, unread: c.unread, lastMessage: c.last_message,
    members: mem.rows.filter((m) => m.conv_id === c.id).map((m) => ({ id: m.id, username: m.username, displayName: m.display_name, publicKey: m.public_key, role: m.role, lastReadAt: m.last_read_at, online: sockets.has(m.id) && m.status_mode !== 'invisible', mode: m.status_mode, status: statusOf(m), isAdmin: m.is_admin })),
    keys: keys.rows.filter((k) => k.conv_id === c.id).map((k) => ({ version: k.version, wrappedKey: k.wrapped_key, iv: k.iv, wrappedBy: k.wrapped_by })),
  }));
  return { conversations, keyUsers };
}

app.get('/api/conversations', auth, wrap(async (req, res) => res.json(await loadConversations(req.user.id))));

app.post('/api/conversations/dm', auth, byUser('conv-create', 15, 3_600_000), wrap(async (req, res) => {
  const t = await q('select id from users where username=$1', [String(req.body.username || '').toLowerCase()]);
  if (!t.rows[0]) return bad(res, 'user not found', 404);
  const other = t.rows[0].id;
  if (other === req.user.id) return bad(res, 'cannot dm yourself');
  if (await isBlockedEitherWay(req.user.id, other)) return bad(res, 'blocked', 403);
  const key = [req.user.id, other].sort().join(':');
  let created = false;
  const client = await pool.connect();
  let convId;
  try {
    await client.query('begin');
    const ins = await client.query(`insert into conversations(type,dm_key,created_by) values('dm',$1,$2) on conflict(dm_key) do nothing returning id`, [key, req.user.id]);
    if (ins.rows[0]) {
      created = true; convId = ins.rows[0].id;
      await client.query('insert into members(conv_id,user_id) values($1,$2),($1,$3)', [convId, req.user.id, other]);
    } else convId = (await client.query('select id from conversations where dm_key=$1', [key])).rows[0].id;
    await client.query('commit');
  } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  if (created) {
    const them = await loadConversations(other, convId);
    sendTo(other, { t: 'conv_added', ...them });
    notify(other, 'dm_new', { convId, from: req.user.username }).catch(() => {});
  }
  res.json({ ...(await loadConversations(req.user.id, convId)), convId });
}));

app.post('/api/conversations/group', auth, byUser('conv-create', 15, 3_600_000), wrap(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 40);
  const members = Array.isArray(req.body.members) ? req.body.members : [];
  const self = req.body.self || {};
  if (!name) return bad(res, 'group needs a name');
  if (members.length < 1 || members.length > 49) return bad(res, 'pick 1-49 members');
  if (!isB64(self.wrappedKey, 400) || !isB64(self.iv, 40)) return bad(res, 'bad key');
  const ids = new Set();
  for (const m of members) {
    if (!isUuid(m.userId) || m.userId === req.user.id || ids.has(m.userId) || !isB64(m.wrappedKey, 400) || !isB64(m.iv, 40)) return bad(res, 'bad member list');
    ids.add(m.userId);
  }
  const found = await q('select id from users where id=any($1)', [[...ids]]);
  if (found.rows.length !== ids.size) return bad(res, 'unknown user in list');
  for (const id of ids) if (await isBlockedEitherWay(req.user.id, id)) return bad(res, 'one of those users cannot be added', 403);
  const client = await pool.connect();
  let convId;
  try {
    await client.query('begin');
    convId = (await client.query(`insert into conversations(type,name,created_by) values('group',$1,$2) returning id`, [name, req.user.id])).rows[0].id;
    await client.query(`insert into members(conv_id,user_id,role) values($1,$2,'admin')`, [convId, req.user.id]);
    await client.query('insert into group_keys(conv_id,user_id,version,wrapped_key,iv,wrapped_by) values($1,$2,1,$3,$4,$2)', [convId, req.user.id, self.wrappedKey, self.iv]);
    for (const m of members) {
      await client.query('insert into members(conv_id,user_id) values($1,$2)', [convId, m.userId]);
      await client.query('insert into group_keys(conv_id,user_id,version,wrapped_key,iv,wrapped_by) values($1,$2,1,$3,$4,$5)', [convId, m.userId, m.wrappedKey, m.iv, req.user.id]);
    }
    await client.query('commit');
  } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  for (const id of ids) {
    sendTo(id, { t: 'conv_added', ...(await loadConversations(id, convId)) });
    notify(id, 'group_added', { convId, name, by: req.user.username }).catch(() => {});
  }
  res.json({ ...(await loadConversations(req.user.id, convId)), convId });
}));

async function requireMember(req, res) {
  if (!isUuid(req.params.id)) { bad(res, 'bad id'); return null; }
  const r = await q('select m.role,m.joined_at,c.type,c.key_version,c.name from members m join conversations c on c.id=m.conv_id where m.conv_id=$1 and m.user_id=$2', [req.params.id, req.user.id]);
  if (!r.rows[0]) { bad(res, 'not a member', 403); return null; }
  return r.rows[0];
}

app.patch('/api/conversations/:id', auth, byUser('conv-edit', 20, 60_000), wrap(async (req, res) => {
  const m = await requireMember(req, res); if (!m) return;
  if (m.type !== 'group' || m.role !== 'admin') return bad(res, 'admins only', 403);
  const name = String(req.body.name || '').trim().slice(0, 40);
  if (!name) return bad(res, 'bad name');
  await q('update conversations set name=$2 where id=$1', [req.params.id, name]);
  await sendToConv(req.params.id, { t: 'conv_update', convId: req.params.id, name });
  res.json({ ok: true });
}));

app.patch('/api/conversations/:id/me', auth, byUser('conv-edit', 20, 60_000), wrap(async (req, res) => {
  const m = await requireMember(req, res); if (!m) return;
  if (typeof req.body.muted === 'boolean') await q('update members set muted=$3 where conv_id=$1 and user_id=$2', [req.params.id, req.user.id, req.body.muted]);
  res.json({ ok: true });
}));

app.post('/api/conversations/:id/members', auth, byUser('member-add', 30, 3_600_000), wrap(async (req, res) => {
  const m = await requireMember(req, res); if (!m) return;
  if (m.type !== 'group' || m.role !== 'admin') return bad(res, 'admins only', 403);
  const { userId, wrappedKey, iv } = req.body;
  if (!isUuid(userId) || !isB64(wrappedKey, 400) || !isB64(iv, 40)) return bad(res, 'bad request');
  const cnt = await q('select count(*)::int c from members where conv_id=$1', [req.params.id]);
  if (cnt.rows[0].c >= 50) return bad(res, 'group is full');
  if (!(await q('select 1 from users where id=$1', [userId])).rows[0]) return bad(res, 'user not found', 404);
  if (await isBlockedEitherWay(req.user.id, userId)) return bad(res, 'cannot add that user', 403);
  const ins = await q('insert into members(conv_id,user_id) values($1,$2) on conflict do nothing returning user_id', [req.params.id, userId]);
  if (!ins.rows[0]) return bad(res, 'already a member', 409);
  await q('insert into group_keys(conv_id,user_id,version,wrapped_key,iv,wrapped_by) values($1,$2,$3,$4,$5,$6)', [req.params.id, userId, m.key_version, wrappedKey, iv, req.user.id]);
  sendTo(userId, { t: 'conv_added', ...(await loadConversations(userId, req.params.id)) });
  notify(userId, 'group_added', { convId: req.params.id, name: m.name, by: req.user.username }).catch(() => {});
  await sendToConv(req.params.id, { t: 'conv_update', convId: req.params.id, refresh: true }, userId);
  res.json({ ok: true });
}));

// leave (self) or remove (admin). the caller sends a fresh group key wrapped for everyone who stays (key rotation)
app.delete('/api/conversations/:id/members/:userId', auth, byUser('member-del', 30, 3_600_000), wrap(async (req, res) => {
  const m = await requireMember(req, res); if (!m) return;
  if (m.type !== 'group') return bad(res, 'not a group');
  const target = req.params.userId;
  if (!isUuid(target)) return bad(res, 'bad user');
  if (target !== req.user.id && m.role !== 'admin') return bad(res, 'admins only', 403);
  const cur = await q('select user_id,role,joined_at from members where conv_id=$1 order by joined_at', [req.params.id]);
  if (!cur.rows.find((x) => x.user_id === target)) return bad(res, 'not in group', 404);
  const remaining = cur.rows.filter((x) => x.user_id !== target);
  if (!remaining.length) { await q('delete from conversations where id=$1', [req.params.id]); return res.json({ ok: true, deleted: true }); }
  const keys = Array.isArray(req.body.keys) ? req.body.keys : [];
  const want = new Set(remaining.map((x) => x.user_id));
  if (keys.length !== want.size || !keys.every((k) => want.has(k.userId) && isB64(k.wrappedKey, 400) && isB64(k.iv, 40))) return bad(res, 'new keys must cover every remaining member');
  const nv = m.key_version + 1;
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from members where conv_id=$1 and user_id=$2', [req.params.id, target]);
    await client.query('update conversations set key_version=$2 where id=$1', [req.params.id, nv]);
    for (const k of keys) await client.query('insert into group_keys(conv_id,user_id,version,wrapped_key,iv,wrapped_by) values($1,$2,$3,$4,$5,$6)', [req.params.id, k.userId, nv, k.wrappedKey, k.iv, req.user.id]);
    if (!remaining.some((x) => x.role === 'admin')) await client.query(`update members set role='admin' where conv_id=$1 and user_id=$2`, [req.params.id, remaining[0].user_id]);
    await client.query('commit');
  } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  sendTo(target, { t: 'conv_removed', convId: req.params.id });
  for (const uid of want) sendTo(uid, { t: 'conv_added', ...(await loadConversations(uid, req.params.id)) }); // refresh with new key + members
  res.json({ ok: true });
}));

// ---------- messages ----------
app.get('/api/conversations/:id/messages', auth, byUser('msg-read', 120, 60_000), wrap(async (req, res) => {
  const m = await requireMember(req, res); if (!m) return;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const before = parseInt(req.query.before, 10) || 9e15;
  const r = await q(
    `select id,sender_id "senderId",ciphertext,iv,key_version "keyVersion",created_at "createdAt",deleted from messages
     where conv_id=$1 and id<$2 and created_at>=$3 and created_at>now()-make_interval(hours=>$5) order by id desc limit $4`, [req.params.id, before, m.joined_at, limit, TTL_HOURS]);
  res.json({ messages: r.rows.reverse(), hasMore: r.rows.length === limit });
}));

// message sending: strict limits + escalating mutes for spammers
app.post('/api/conversations/:id/messages', auth, wrap(async (req, res, next) => {
  const uid = req.user.id;
  const mute = limiter.muted('mute:' + uid);                   // already muted?
  if (mute) { res.set('Retry-After', String(mute)); return res.status(429).json({ error: 'muted', retryAfter: mute, message: `slow down, you are muted for ${mute}s` }); }
  const checks = [limiter.hit('msg-burst:' + uid, 5, 5_000), limiter.hit('msg-min:' + uid, 40, 60_000), limiter.hit('msg-hour:' + uid, 600, 3_600_000)];
  const fail = checks.find((c) => !c.ok);
  if (fail) {
    const muteSecs = limiter.strike('mute:' + uid);            // repeated violations => temporary mute
    const ra = muteSecs || fail.retryAfter;
    res.set('Retry-After', String(ra));
    return res.status(429).json({ error: muteSecs ? 'muted' : 'rate_limited', retryAfter: ra, message: muteSecs ? `you are muted for ${muteSecs}s for spamming` : 'slow down' });
  }
  const m = await requireMember(req, res); if (!m) return;
  const { ciphertext, iv, keyVersion } = req.body;
  if (!isB64(ciphertext, 16000) || !isB64(iv, 40)) return bad(res, 'bad message');
  if (keyVersion !== m.key_version) return res.status(409).json({ error: 'key_version_stale', current: m.key_version });
  if (m.type === 'dm') {                                       // blocked users cannot message
    const other = (await q('select user_id from members where conv_id=$1 and user_id<>$2', [req.params.id, uid])).rows[0];
    if (other && (await isBlockedEitherWay(uid, other.user_id))) return bad(res, 'blocked', 403);
  }
  const r = await q('insert into messages(conv_id,sender_id,ciphertext,iv,key_version) values($1,$2,$3,$4,$5) returning id,created_at', [req.params.id, uid, ciphertext, iv, keyVersion]);
  const message = { id: Number(r.rows[0].id), senderId: uid, ciphertext, iv, keyVersion, createdAt: r.rows[0].created_at, deleted: false };
  const mems = await q('select user_id,muted from members where conv_id=$1', [req.params.id]);
  for (const mm of mems.rows) {
    sendTo(mm.user_id, { t: 'msg', convId: req.params.id, message, cid: req.body.cid || null, muted: mm.muted });
    if (mm.user_id !== uid && !mm.muted && !sockets.has(mm.user_id)) pushTo(mm.user_id, req.params.id).catch(() => {}); // offline => web push
  }
  res.json({ message });
}));

app.delete('/api/messages/:id', auth, byUser('msg-del', 30, 60_000), wrap(async (req, res) => {
  const r = await q(`update messages set deleted=true,ciphertext='',iv='' where id=$1 and sender_id=$2 and not deleted returning conv_id`, [parseInt(req.params.id, 10) || 0, req.user.id]);
  if (!r.rows[0]) return bad(res, 'not found', 404);
  await sendToConv(r.rows[0].conv_id, { t: 'msg_deleted', convId: r.rows[0].conv_id, id: Number(req.params.id) });
  res.json({ ok: true });
}));

app.post('/api/conversations/:id/read', auth, byUser('read', 120, 60_000), wrap(async (req, res) => {
  const m = await requireMember(req, res); if (!m) return;
  await q('update members set last_read_at=now() where conv_id=$1 and user_id=$2', [req.params.id, req.user.id]);
  await sendToConv(req.params.id, { t: 'read', convId: req.params.id, userId: req.user.id, at: new Date().toISOString() }, req.user.id);
  res.json({ ok: true });
}));

app.get('/api/presence', auth, wrap(async (req, res) => {
  const peers = await peersOf(req.user.id);
  const out = [];
  for (const p of peers) out.push(await presenceOf(p));
  res.json({ presence: out });
}));

// ---------- notifications ----------
app.get('/api/notifications', auth, wrap(async (req, res) => {
  const r = await q('select id,type,data,read,created_at "createdAt" from notifications where user_id=$1 order by id desc limit 50', [req.user.id]);
  res.json({ notifications: r.rows, unread: r.rows.filter((x) => !x.read).length });
}));
app.post('/api/notifications/read', auth, wrap(async (req, res) => {
  await q('update notifications set read=true where user_id=$1', [req.user.id]);
  res.json({ ok: true });
}));
app.get('/api/push/key', (req, res) => res.json({ key: pushReady ? process.env._VAPID_PUBLIC : null }));
app.post('/api/push/subscribe', auth, byUser('push-sub', 10, 3_600_000), wrap(async (req, res) => {
  const s = req.body;
  if (!s || typeof s.endpoint !== 'string' || !s.keys || !isB64(s.keys.p256dh, 200) || !isB64(s.keys.auth, 100) || s.endpoint.length > 1000) return bad(res, 'bad subscription');
  await q('insert into push_subs(endpoint,user_id,p256dh,auth) values($1,$2,$3,$4) on conflict(endpoint) do update set user_id=$2,p256dh=$3,auth=$4', [s.endpoint, req.user.id, s.keys.p256dh, s.keys.auth]);
  res.json({ ok: true });
}));
app.delete('/api/push/subscribe', auth, wrap(async (req, res) => {
  await q('delete from push_subs where user_id=$1', [req.user.id]);
  res.json({ ok: true });
}));

// ---------- gamesplace ----------
app.get('/api/games', auth, byUser('games', 120, 60_000), wrap(async (req, res) => {
  const { q: query = '', cat = '' } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 60, 120);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  res.json({ ...games.search({ q: String(query).slice(0, 60), cat: String(cat).slice(0, 40), limit, offset }), cats: games.cats, indexed: games.items.length });
}));

// the actual game page: fetched from the stash repo, re-served as html inside a csp sandbox (opaque origin)
app.get(/^\/g\/(.+)$/, rl('gameload', 60, 60_000), wrap(async (req, res) => {
  const p = decodeURIComponent(req.params[0]);
  if (!games.byId.has(p)) return res.status(404).type('text/plain').send('unknown game');
  try {
    const html = await games.html(p);
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': 'sandbox allow-scripts allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads allow-orientation-lock',
      'Cache-Control': 'public, max-age=600',
    });
    res.send(html);
  } catch (e) { res.status(502).type('text/plain').send('could not load game: ' + e.message); }
}));

// ---------- activity ----------
app.post('/api/activity/start', auth, byUser('play-start', 20, 60_000), wrap(async (req, res) => {
  const g = games.byId.get(String(req.body.path || ''));
  if (!g) return bad(res, 'unknown game', 404);
  await endPlay(req.user.id);                                  // only one active game at a time
  const r = await q('insert into plays(user_id,game_path,game_title) values($1,$2,$3) returning id', [req.user.id, g.id, g.title]);
  activityNow.set(req.user.id, { playId: Number(r.rows[0].id), path: g.id, title: g.title, since: new Date().toISOString(), last: Date.now() });
  broadcastPresence(req.user.id).catch(() => {});
  res.json({ playId: Number(r.rows[0].id) });
}));
app.post('/api/activity/ping', auth, byUser('play-ping', 8, 60_000), wrap(async (req, res) => {
  const a = activityNow.get(req.user.id);
  if (!a || a.playId !== Number(req.body.playId)) return bad(res, 'no active session', 404);
  a.last = Date.now();
  await q('update plays set last_ping=now(), seconds=floor(extract(epoch from (now()-started_at)))::int where id=$1', [a.playId]);
  res.json({ ok: true });
}));
app.post('/api/activity/stop', auth, wrap(async (req, res) => { await endPlay(req.user.id); res.json({ ok: true }); }));

async function endPlay(userId) {
  const a = activityNow.get(userId);
  if (!a) return;
  activityNow.delete(userId);
  await q('update plays set ended_at=now(), last_ping=now(), seconds=floor(extract(epoch from (now()-started_at)))::int where id=$1 and ended_at is null', [a.playId]);
  broadcastPresence(userId).catch(() => {});
}
// sessions that stop pinging (closed tab, crash) are closed using their last ping time
setInterval(async () => {
  for (const [uid, a] of activityNow) {
    if (Date.now() - a.last > 90_000) {
      activityNow.delete(uid);
      await q('update plays set ended_at=last_ping, seconds=floor(extract(epoch from (last_ping-started_at)))::int where id=$1 and ended_at is null', [a.playId]).catch(() => {});
      broadcastPresence(uid).catch(() => {});
    }
  }
}, 30_000).unref();

app.get('/api/activity/now', auth, wrap(async (req, res) => {
  const ids = [...activityNow.keys()];
  if (!ids.length) return res.json({ now: [] });
  const r = await q('select id,username,display_name from users where id=any($1) and share_activity', [ids]);
  res.json({ now: r.rows.map((u) => ({ userId: u.id, username: u.username, displayName: u.display_name, title: activityNow.get(u.id).title, path: activityNow.get(u.id).path, since: activityNow.get(u.id).since })) });
}));
app.get('/api/activity/recent', auth, wrap(async (req, res) => {
  const r = await q(
    `select p.id,p.game_path,p.game_title,p.started_at,p.ended_at,${SECS} seconds,u.username,u.display_name from plays p join users u on u.id=p.user_id
     where u.share_activity order by p.id desc limit 30`);
  res.json({ recent: r.rows.map((p) => ({ id: Number(p.id), path: p.game_path, title: p.game_title, startedAt: p.started_at, live: !p.ended_at, seconds: p.seconds, username: p.username, displayName: p.display_name })) });
}));
app.get('/api/activity/leaderboard', auth, wrap(async (req, res) => {
  const since = req.query.range === 'all' ? '1970-01-01' : new Date(Date.now() - 7 * 86400_000).toISOString();
  const players = await q(
    `select u.username,u.display_name,sum(${SECS})::int seconds,count(distinct p.game_path)::int games from plays p join users u on u.id=p.user_id
     where u.share_activity and p.started_at>=$1 group by 1,2 order by 3 desc limit 10`, [since]);
  const top = await q(
    `select p.game_path,p.game_title,sum(${SECS})::int seconds,count(distinct p.user_id)::int players from plays p join users u on u.id=p.user_id
     where u.share_activity and p.started_at>=$1 group by 1,2 order by 4 desc,3 desc limit 10`, [since]);
  res.json({ players: players.rows.map((x) => ({ username: x.username, displayName: x.display_name, seconds: x.seconds, games: x.games })), games: top.rows.map((x) => ({ path: x.game_path, title: x.game_title, seconds: x.seconds, players: x.players })) });
}));
app.get('/api/activity/mine', auth, wrap(async (req, res) => {
  const r = await q(`select p.id,p.game_path,p.game_title,p.started_at,${SECS} seconds from plays p where p.user_id=$1 order by p.id desc limit 30`, [req.user.id]);
  const t = await q(`select coalesce(sum(${SECS}),0)::int total from plays p where p.user_id=$1`, [req.user.id]);
  res.json({ totalSeconds: t.rows[0].total, history: r.rows.map((p) => ({ id: Number(p.id), path: p.game_path, title: p.game_title, startedAt: p.started_at, seconds: p.seconds })) });
}));

// ---------- static client ----------
const PUB = path.join(__dirname, 'public');
const sendPage = (file) => (req, res) => { res.set('Cache-Control', 'no-cache'); res.type('html').send(fs.readFileSync(path.join(PUB, file), 'utf8')); };
app.get(['/', '/app'], sendPage('index.html'));              // /app is what the loader pulls
app.get('/loader.html', (req, res) => {                      // convenience copy with this server's own address filled in
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  res.set('Cache-Control', 'no-cache').type('html').send(fs.readFileSync(path.join(PUB, 'loader.html'), 'utf8').replace('__SERVER__', `${proto}://${host}`));
});
app.get('/sw.js', (req, res) => { res.set({ 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' }); res.send(fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8')); });
app.get('/api/health', (req, res) => res.json({ ok: true, games: games.items.length, online: sockets.size }));
app.use('/api', (req, res) => bad(res, 'not found', 404));

app.use((err, req, res, next) => {                           // last resort, never leak internals
  if (err.type === 'entity.parse.failed') return bad(res, 'bad json');
  if (err.type === 'entity.too.large') return bad(res, 'too big', 413);
  console.error('error', req.method, req.path, err.message);
  res.status(500).json({ error: 'server error' });
});

// ---------- websocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
const clientIp = (req) => { const x = (req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean); return x.length ? x[x.length - 1] : req.socket.remoteAddress; };

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws')) return socket.destroy();
  const ip = clientIp(req);
  if ((ipConns.get(ip) || 0) >= 20) { socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n'); return socket.destroy(); } // connection cap per ip
  wss.handleUpgrade(req, socket, head, (ws) => { ws.ip = ip; wss.emit('connection', ws, req); });
});

wss.on('connection', (ws) => {
  ipConns.set(ws.ip, (ipConns.get(ws.ip) || 0) + 1);
  ws.alive = true;
  ws.userId = null;
  const authTimer = setTimeout(() => { if (!ws.userId) ws.close(4001, 'auth timeout'); }, 10_000); // must auth fast
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', async (raw) => {
    if (!limiter.hit('ws:' + ws.ip + ':' + (ws.userId || ''), 40, 10_000).ok) return ws.close(1008, 'too many events'); // flood => disconnect
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    try {
      if (!ws.userId) {
        if (m.t !== 'auth' || typeof m.token !== 'string') return ws.close(4001, 'auth required');
        const r = await q('select u.id from sessions s join users u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>now() and not u.banned', [sha256(m.token)]);
        if (!r.rows[0]) return ws.close(4001, 'bad token');
        const set = sockets.get(r.rows[0].id) || new Set();
        if (set.size >= 6) return ws.close(4002, 'too many connections');
        clearTimeout(authTimer);
        ws.userId = r.rows[0].id;
        const first = set.size === 0;
        set.add(ws); sockets.set(ws.userId, set);
        ws.send(JSON.stringify({ t: 'ready' }));
        if (first) broadcastPresence(ws.userId).catch(() => {});
        return;
      }
      if (m.t === 'typing' && isUuid(m.convId)) {
        if (!limiter.hit(`typing:${ws.userId}:${m.convId}`, 1, 2_000).ok) return; // 1 typing event / 2s / conversation
        const ok = await q('select 1 from members where conv_id=$1 and user_id=$2', [m.convId, ws.userId]);
        if (ok.rows[0]) await sendToConv(m.convId, { t: 'typing', convId: m.convId, userId: ws.userId }, ws.userId);
      } else if (m.t === 'ping') ws.send('{"t":"pong"}');
    } catch (e) { console.error('ws error', e.message); }
  });
  ws.on('close', () => {
    clearTimeout(authTimer);
    const n = (ipConns.get(ws.ip) || 1) - 1;
    if (n <= 0) ipConns.delete(ws.ip); else ipConns.set(ws.ip, n);
    if (!ws.userId) return;
    const set = sockets.get(ws.userId);
    if (set) { set.delete(ws); if (!set.size) { sockets.delete(ws.userId); endPlay(ws.userId).catch(() => {}); broadcastPresence(ws.userId).catch(() => {}); } }
  });
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); } }, 30_000).unref(); // drop dead sockets

// ---------- boot ----------
async function getSetting(key, make) {
  const r = await q('select value from settings where key=$1', [key]);
  if (r.rows[0]) return r.rows[0].value;
  const v = make();
  await q('insert into settings(key,value) values($1,$2) on conflict do nothing', [key, v]);
  return (await q('select value from settings where key=$1', [key])).rows[0].value;
}

(async () => {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is missing'); process.exit(1); }
  await init();
  SERVER_SECRET = await getSetting('server_secret', () => crypto.randomBytes(32).toString('hex'));
  try {                                                      // web push keys are generated once and kept in the db
    const keys = JSON.parse(await getSetting('vapid', () => JSON.stringify(webpush.generateVAPIDKeys())));
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@chatroom.app', keys.publicKey, keys.privateKey);
    process.env._VAPID_PUBLIC = keys.publicKey;
    pushReady = true;
  } catch (e) { console.warn('push disabled:', e.message); }
  try {                                                      // 1) instant start from the last saved list (or a test seed file)
    const seed = process.env.GAMES_SEED ? fs.readFileSync(process.env.GAMES_SEED, 'utf8') : (await q("select value from settings where key='games_index'")).rows[0]?.value;
    if (seed) games.set(JSON.parse(seed));
  } catch (e) { console.warn('games seed failed', e.message); }
  games.onLoad = (paths) => { q("insert into settings(key,value) values('games_index',$1) on conflict(key) do update set value=$1", [JSON.stringify(paths)]).catch(() => {}); };
  games.refresh().catch(() => {});                           // 2) then refresh from github in the background
  setInterval(() => games.refresh().catch(() => {}), 6 * 3600_000).unref();
  setInterval(() => { if (!games.items.length) games.refresh().catch(() => {}); }, 60_000).unref(); // keep retrying until the first load works
  setInterval(() => q('delete from sessions where expires_at<now()').catch(() => {}), 3600_000).unref();
  await q('update users set is_admin=true where username=$1', [ADMIN_USERNAME]); // owner always admin
  sweepExpired().catch((e) => console.warn('sweep', e.message));
  setInterval(() => sweepExpired().catch((e) => console.warn('sweep', e.message)), 5 * 60_000).unref();
  server.listen(PORT, '0.0.0.0', () => console.log('chatroom listening on', PORT));
})().catch((e) => { console.error('fatal', e); process.exit(1); });

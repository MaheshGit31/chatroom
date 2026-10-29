// lib/mod.js - moderation + chat extras: group mods, slow mode, mutes, admin commands, audit log, appeals, stats,
// do-not-disturb, view-once, mentions, reminders, encrypted image blobs, wallpapers
const crypto = require('crypto');
const express = require('express');
const audit = require('./audit');
const safety = require('./safety');
const { imgUrlOk } = require('./beta');
const betaOn = safety.betaOn;

const SLOW_CHOICES = [0, 5, 10, 30, 60, 300, 900];          // seconds between messages in slow mode
const BLOB_MAX = 5 * 1024 * 1024;                           // images are 5mb at most (plus 16 bytes of encryption tag)
const WP_PRESETS = ['dusk', 'ember', 'moss', 'ocean', 'plum', 'sand', 'slate', 'rose', 'mint', 'night', 'paper', 'dots'];

// ---------- do not disturb ----------
const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
function dndActive(u, now = new Date()) {                    // true while a person asked not to be disturbed
  if (!u) return false;
  if (u.dnd_until && new Date(u.dnd_until) > now) return true;
  const qh = u.quiet;
  if (qh && /^\d\d:\d\d$/.test(qh.from) && /^\d\d:\d\d$/.test(qh.to)) {
    const local = new Date(now.getTime() - (Number(qh.tz) || 0) * 60000);   // tz is the browser's getTimezoneOffset()
    const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
    const f = toMin(qh.from), t = toMin(qh.to);
    if (f === t) return false;
    return f < t ? mins >= f && mins < t : mins >= f || mins < t;
  }
  return false;
}

// ---------- ranks: global admin > group host > group mod > member ----------
const rankOf = (isAdmin, role) => (isAdmin ? 3 : role === 'admin' ? 2 : role === 'mod' ? 1 : 0);
const canAct = (actor, actorRole, targetRole, targetIsAdmin) => {
  const a = rankOf(actor.is_admin, actorRole);
  return a >= 1 && a > rankOf(targetIsAdmin, targetRole);
};
const isStaff = (user, role) => rankOf(user.is_admin, role) >= 1;

// ---------- the send gate: global mute, group mute, slow mode ----------
async function sendGate(q, user, m, convId) {
  const now = Date.now();
  if (user.muted_until && new Date(user.muted_until) > now) {
    const secs = Math.ceil((new Date(user.muted_until) - now) / 1000);
    return { status: 403, body: { error: 'muted_admin', retryAfter: secs, message: `an admin muted you for another ${niceSecs(secs)}` } };
  }
  if (m.muted_until && new Date(m.muted_until) > now) {
    const secs = Math.ceil((new Date(m.muted_until) - now) / 1000);
    return { status: 403, body: { error: 'muted_group', retryAfter: secs, message: `you are muted in this group for another ${niceSecs(secs)}` } };
  }
  if (m.slow_seconds && !isStaff(user, m.role)) {
    const last = (await q('select created_at from messages where conv_id=$1 and sender_id=$2 order by id desc limit 1', [convId, user.id])).rows[0];
    if (last) {
      const left = Math.ceil(m.slow_seconds - (now - new Date(last.created_at)) / 1000);
      if (left > 0) return { status: 429, body: { error: 'slow_mode', retryAfter: left, message: `slow mode is on, wait ${left}s` } };
    }
  }
  return null;
}
function niceSecs(s) { return s < 90 ? s + 's' : s < 5400 ? Math.round(s / 60) + ' min' : s < 172800 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' days'; }

// ---------- appeal tokens: proof that someone knew the password of a suspended account, valid for 30 minutes ----------
const sign = (secret, body) => crypto.createHmac('sha256', secret).update(body).digest('base64url');
function appealToken(secret, userId) { const exp = Date.now() + 30 * 60_000; const body = `${userId}.${exp}`; return `${body}.${sign(secret, body)}`; }
function readAppealToken(secret, token) {
  const [id, exp, sig] = String(token || '').split('.');
  if (!id || !exp || !sig || Number(exp) < Date.now()) return null;
  const want = sign(secret, `${id}.${exp}`);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  return id;
}


function mount(app, ctx) {
  const { q, auth, adminOnly, byUser, bad, wrap, sendTo, sendToConv, notify, isUuid, requireMember, sockets, secret, adminName, ensureFor, rl } = ctx;
  const nameOf = (u) => (u ? { id: u.id, username: u.username } : null);
  const convInfo = async (id) => (await q('select name from conversations where id=$1', [id])).rows[0] || {};

  // ---------- do not disturb ----------
  app.put('/api/me/dnd', auth, byUser('dnd', 30, 60_000), wrap(async (req, res) => {
    const b = req.body || {};
    if ('minutes' in b) {
      const mins = b.minutes === null ? 0 : Math.min(Math.max(parseInt(b.minutes, 10) || 0, 0), 60 * 24 * 7);
      await q(mins ? `update users set dnd_until=now()+make_interval(mins=>$2) where id=$1` : 'update users set dnd_until=null where id=$1', mins ? [req.user.id, mins] : [req.user.id]);
    }
    if ('quiet' in b) {
      const z = b.quiet;
      if (z === null) await q('update users set quiet=null where id=$1', [req.user.id]);
      else if (z && /^\d\d:\d\d$/.test(z.from) && /^\d\d:\d\d$/.test(z.to) && toMin(z.from) < 1440 && toMin(z.to) < 1440) await q('update users set quiet=$2 where id=$1', [req.user.id, { from: z.from, to: z.to, tz: Math.min(Math.max(parseInt(z.tz, 10) || 0, -840), 840) }]);
      else return bad(res, 'bad quiet hours');
    }
    const u = (await q('select dnd_until,quiet from users where id=$1', [req.user.id])).rows[0];
    sendTo(req.user.id, { t: 'me_update' });                 // other devices pick it up
    res.json({ dndUntil: u.dnd_until, quiet: u.quiet });
  }));

  // ---------- chat wallpapers (beta, only you see them) ----------
  app.put('/api/me/wallpapers', auth, byUser('wallpaper', 40, 60_000), wrap(async (req, res) => {
    if (!betaOn(req.user)) return res.status(403).json({ error: 'beta_required', message: 'wallpapers are a beta feature' });
    const key = req.body.convId === 'default' ? 'default' : req.body.convId;
    if (key !== 'default' && !isUuid(key)) return bad(res, 'bad chat');
    const wp = req.body.wp;
    let clean = null;
    if (wp) {
      if (wp.k === 'preset' && WP_PRESETS.includes(wp.id)) clean = { k: 'preset', id: wp.id };
      else if (wp.k === 'grad' && /^#[0-9a-f]{6}$/i.test(wp.a) && /^#[0-9a-f]{6}$/i.test(wp.b)) clean = { k: 'grad', a: wp.a.toLowerCase(), b: wp.b.toLowerCase() };
      else if (wp.k === 'img' && imgUrlOk(wp.url)) clean = { k: 'img', url: wp.url };
      else return bad(res, 'that wallpaper does not look right');
    }
    const cur = (await q('select wallpapers from users where id=$1', [req.user.id])).rows[0].wallpapers || {};
    if (clean) cur[key] = clean; else delete cur[key];
    if (Object.keys(cur).length > 40) return bad(res, 'too many wallpapers, clear some first');
    await q('update users set wallpapers=$2 where id=$1', [req.user.id, cur]);
    sendTo(req.user.id, { t: 'me_update' });
    res.json({ wallpapers: cur });
  }));

  // ---------- slow mode, mods, group mutes ----------
  async function staffOf(req, res) {                          // the caller must be a member who is a host, mod or admin
    const m = await requireMember(req, res); if (!m) return null;
    if (m.type !== 'group') { bad(res, 'groups only'); return null; }
    if (!isStaff(req.user, m.role)) { bad(res, 'mods only', 403); return null; }
    return m;
  }
  app.put('/api/conversations/:id/slow', auth, byUser('slow', 20, 60_000), wrap(async (req, res) => {
    const m = await staffOf(req, res); if (!m) return;
    const secs = parseInt(req.body.seconds, 10) || 0;
    if (!SLOW_CHOICES.includes(secs)) return bad(res, 'pick one of: ' + SLOW_CHOICES.join(', '));
    await q('update conversations set slow_seconds=$2 where id=$1', [req.params.id, secs || null]);
    await sendToConv(req.params.id, { t: 'conv_update', convId: req.params.id, slowSeconds: secs || null });
    audit.log(q, req.user, secs ? 'slow_on' : 'slow_off', null, { convId: req.params.id, convName: m.name, detail: secs ? secs + 's' : '' });
    res.json({ ok: true, slowSeconds: secs || null });
  }));
  app.post('/api/conversations/:id/mods/:userId', auth, byUser('mods', 30, 60_000), wrap(async (req, res) => {
    const m = await requireMember(req, res); if (!m) return;
    if (m.type !== 'group') return bad(res, 'groups only');
    if (m.role !== 'admin') return bad(res, 'only the host can pick mods', 403);
    if (!isUuid(req.params.userId)) return bad(res, 'bad user');
    const t = (await q('select mem.role,u.username,u.display_name,u.is_admin from members mem join users u on u.id=mem.user_id where mem.conv_id=$1 and mem.user_id=$2', [req.params.id, req.params.userId])).rows[0];
    if (!t) return bad(res, 'not in this group', 404);
    if (t.role === 'admin' || t.is_admin) return bad(res, 'they already outrank a mod');
    const on = req.body.on !== false;
    if (on && (await q(`select count(*)::int c from members where conv_id=$1 and role='mod'`, [req.params.id])).rows[0].c >= 8) return bad(res, 'max 8 mods');
    await q('update members set role=$3 where conv_id=$1 and user_id=$2', [req.params.id, req.params.userId, on ? 'mod' : 'member']);
    await sendToConv(req.params.id, { t: 'conv_update', convId: req.params.id, refresh: true });
    audit.log(q, req.user, on ? 'mod_add' : 'mod_remove', { id: req.params.userId, username: t.username }, { convId: req.params.id, convName: m.name });
    res.json({ ok: true });
  }));
  app.post('/api/conversations/:id/mutes/:userId', auth, byUser('gmute', 40, 60_000), wrap(async (req, res) => {
    const m = await staffOf(req, res); if (!m) return;
    if (!isUuid(req.params.userId)) return bad(res, 'bad user');
    const t = (await q('select mem.role,u.username,u.is_admin from members mem join users u on u.id=mem.user_id where mem.conv_id=$1 and mem.user_id=$2', [req.params.id, req.params.userId])).rows[0];
    if (!t) return bad(res, 'not in this group', 404);
    if (!canAct(req.user, m.role, t.role, t.is_admin)) return bad(res, 'you cannot mute them', 403);
    const mins = req.body.minutes === undefined ? 10 : Math.min(Math.max(parseInt(req.body.minutes, 10) || 0, 1), 60 * 24 * 7);
    await q(`update members set muted_until=now()+make_interval(mins=>$3) where conv_id=$1 and user_id=$2`, [req.params.id, req.params.userId, mins]);
    sendTo(req.params.userId, { t: 'conv_update', convId: req.params.id, refresh: true });
    audit.log(q, req.user, 'group_mute', { id: req.params.userId, username: t.username }, { convId: req.params.id, convName: m.name, detail: mins + ' min' });
    res.json({ ok: true, minutes: mins });
  }));
  app.delete('/api/conversations/:id/mutes/:userId', auth, byUser('gmute', 40, 60_000), wrap(async (req, res) => {
    const m = await staffOf(req, res); if (!m) return;
    if (!isUuid(req.params.userId)) return bad(res, 'bad user');
    const t = (await q('select u.username from users u where u.id=$1', [req.params.userId])).rows[0];
    await q('update members set muted_until=null where conv_id=$1 and user_id=$2', [req.params.id, req.params.userId]);
    sendTo(req.params.userId, { t: 'conv_update', convId: req.params.id, refresh: true });
    audit.log(q, req.user, 'group_unmute', { id: req.params.userId, username: t && t.username }, { convId: req.params.id, convName: m.name });
    res.json({ ok: true });
  }));
  app.get('/api/conversations/:id/modlog', auth, byUser('modlog', 30, 60_000), wrap(async (req, res) => {
    const m = await staffOf(req, res); if (!m) return;
    const r = await q('select id,at,actor_name,action,target_name,detail from audit where conv_id=$1 order by id desc limit 60', [req.params.id]);
    res.json({ log: r.rows.map(rowOut) });
  }));
  const rowOut = (x) => ({ id: Number(x.id), at: x.at, actor: x.actor_name, action: x.action, target: x.target_name, conv: x.conv_name || null, detail: x.detail || '' });

  // ---------- view once: the receiver opens it, the server wipes it for everyone ----------
  app.post('/api/messages/:id/viewed', auth, byUser('viewed', 60, 60_000), wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const r = await q('select m.id,m.conv_id,m.sender_id,m.once,m.deleted from messages m join members mem on mem.conv_id=m.conv_id and mem.user_id=$2 where m.id=$1', [id, req.user.id]);
    const m = r.rows[0];
    if (!m || !m.once || m.deleted) return bad(res, 'already opened', 404);
    if (m.sender_id === req.user.id) return bad(res, 'that one is yours');
    const w = await q(`update messages set deleted=true,ciphertext='',iv='' where id=$1 and once and not deleted returning id`, [id]);
    if (!w.rows[0]) return bad(res, 'already opened', 404);
    await q('delete from blobs where msg_id=$1', [id]);
    await q('delete from reactions where msg_id=$1', [id]);
    await sendToConv(m.conv_id, { t: 'once_viewed', convId: m.conv_id, id });
    res.json({ ok: true });
  }));

  // ---------- reminders (beta) ----------
  app.post('/api/reminders', auth, byUser('remind', 30, 60_000), wrap(async (req, res) => {
    if (!betaOn(req.user)) return res.status(403).json({ error: 'beta_required', message: 'reminders are a beta feature' });
    const mins = parseInt(req.body.minutes, 10);
    if (!Number.isFinite(mins) || mins < 1 || mins > 60 * 24 * 30) return bad(res, 'pick a time between 1 minute and 30 days');
    const note = String(req.body.note || '').trim().slice(0, 120);
    let convId = null, msgId = null;
    if (req.body.msgId) {
      msgId = parseInt(req.body.msgId, 10) || null;
      const mm = msgId && (await q('select m.conv_id from messages m join members mem on mem.conv_id=m.conv_id and mem.user_id=$2 where m.id=$1', [msgId, req.user.id])).rows[0];
      if (!mm) return bad(res, 'message not found', 404);
      convId = mm.conv_id;
    } else if (isUuid(req.body.convId)) {
      if ((await q('select 1 from members where conv_id=$1 and user_id=$2', [req.body.convId, req.user.id])).rows[0]) convId = req.body.convId;
    }
    if (!note && !msgId) return bad(res, 'say what to remind you about');
    if ((await q('select count(*)::int c from reminders where user_id=$1', [req.user.id])).rows[0].c >= 20) return bad(res, 'you have 20 reminders waiting, that is the max');
    const r = await q('insert into reminders(user_id,conv_id,msg_id,note,remind_at) values($1,$2,$3,$4,now()+make_interval(mins=>$5)) returning id,remind_at', [req.user.id, convId, msgId, note || null, mins]);
    res.json({ id: Number(r.rows[0].id), at: r.rows[0].remind_at });
  }));
  app.get('/api/reminders', auth, wrap(async (req, res) => {
    const r = await q('select id,conv_id,msg_id,note,remind_at from reminders where user_id=$1 order by remind_at', [req.user.id]);
    res.json({ reminders: r.rows.map((x) => ({ id: Number(x.id), convId: x.conv_id, msgId: x.msg_id ? Number(x.msg_id) : null, note: x.note || '', at: x.remind_at })) });
  }));
  app.delete('/api/reminders/:id', auth, wrap(async (req, res) => { await q('delete from reminders where id=$1 and user_id=$2', [parseInt(req.params.id, 10) || 0, req.user.id]); res.json({ ok: true }); }));

  // ---------- encrypted images (beta to send, anyone in the chat can open) ----------
  const rawBody = express.raw({ type: () => true, limit: BLOB_MAX + 4096 });
  app.post('/api/blobs', auth, byUser('blob-up', 30, 3_600_000), rawBody, wrap(async (req, res) => {
    if (!betaOn(req.user)) return res.status(403).json({ error: 'beta_required', message: 'sending images is a beta feature' });
    const convId = String(req.query.conv || '');
    if (!isUuid(convId)) return bad(res, 'bad chat');
    const mem = (await q('select c.is_public,c.system_kind from members m join conversations c on c.id=m.conv_id where m.conv_id=$1 and m.user_id=$2', [convId, req.user.id])).rows[0];
    if (!mem) return bad(res, 'not a member', 403);
    if (mem.is_public || mem.system_kind) return bad(res, 'images are not allowed in public rooms', 403);
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 32) return bad(res, 'empty upload');
    if (buf.length > BLOB_MAX + 64) return bad(res, 'images are 5mb at most', 413);
    if ((await q('select count(*)::int c from blobs where owner=$1 and msg_id is null', [req.user.id])).rows[0].c >= 6) return bad(res, 'finish sending your other images first');
    const r = await q('insert into blobs(conv_id,owner,data,size) values($1,$2,$3,$4) returning id', [convId, req.user.id, buf, buf.length]);
    res.json({ id: r.rows[0].id });
  }));
  app.get('/api/blobs/:id', auth, byUser('blob-get', 150, 60_000), wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return bad(res, 'bad id');
    const r = await q('select b.data from blobs b join members m on m.conv_id=b.conv_id and m.user_id=$2 where b.id=$1', [req.params.id, req.user.id]);
    if (!r.rows[0]) return bad(res, 'gone', 404);
    res.set({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' }).send(r.rows[0].data);
  }));

  // ---------- admin: ban helper shared by the panel and the /ban command ----------
  async function setBanned(actor, target, banned, reason) {
    if (target.username === adminName) return { status: 403, error: 'cannot touch the owner' };
    if (target.is_admin && actor.username !== adminName) return { status: 403, error: 'only the owner can suspend admins' };
    await q('update users set banned=$2, ban_reason=$3 where id=$1', [target.id, banned, banned ? (reason || null) : null]);
    if (banned) {
      await q('delete from sessions where user_id=$1', [target.id]);
      for (const ws of [...(sockets.get(target.id) || [])]) ws.close(4001, 'suspended');
      audit.bump(q, 'bans');
    }
    audit.log(q, actor, banned ? 'ban' : 'unban', nameOf(target), { detail: reason });
    return { ok: true };
  }

  const durMins = (s) => {                                    // 10m, 2h, 1d, 1w
    const m = String(s || '').trim().toLowerCase().match(/^(\d{1,4})\s*(m|min|h|hr|d|w)?$/);
    if (!m) return 0;
    const n = parseInt(m[1], 10), u = m[2] || 'm';
    return n * (u.startsWith('m') ? 1 : u.startsWith('h') ? 60 : u === 'd' ? 1440 : 10080);
  };

  // ---------- admin commands: /ban /unban /gmute /ungmute /warn /verify /unverify /beta /whois /announce ----------
  app.post('/api/cmd', auth, adminOnly, byUser('cmd', 40, 60_000), wrap(async (req, res) => {
    const cmd = String(req.body.cmd || '');
    const arg = String(req.body.arg || '').trim().slice(0, 600);
    if (cmd === 'announce') {
      const [title, ...rest] = arg.split('|');
      if (!title.trim()) return bad(res, 'use /announce title | message');
      const r = await q('insert into announcements(title,body,created_by) values($1,$2,$3) returning *', [title.trim().slice(0, 80), rest.join('|').trim().slice(0, 1000), req.user.id]);
      const a = r.rows[0];
      for (const uid of sockets.keys()) sendTo(uid, { t: 'announce', announcement: { id: Number(a.id), title: a.title, body: a.body, buttonLabel: '', buttonUrl: '', createdAt: a.created_at } });
      audit.log(q, req.user, 'announce', null, { detail: title.trim() });
      return res.json({ ok: true, message: 'announcement sent' });
    }
    const uname = String(req.body.target || '').toLowerCase().replace(/^@/, '');
    const t = (await q('select * from users where username=$1', [uname])).rows[0];
    if (!t) return bad(res, `nobody called @${uname}`, 404);
    const guard = () => (t.username === adminName ? 'cannot touch the owner' : t.is_admin && req.user.username !== adminName ? 'only the owner can do that to an admin' : null);
    const done = (message) => res.json({ ok: true, message });
    if (cmd === 'whois') {
      const msgs = Number(t.msg_count || 0);
      return res.json({ ok: true, info: { username: t.username, displayName: t.display_name, joined: t.created_at, messages: msgs, verified: safety.verifiedOn(t), beta: betaOn(t), betaUntil: t.beta_until, banned: t.banned, banReason: t.ban_reason, isAdmin: t.is_admin, mutedUntil: t.muted_until, online: sockets.has(t.id) } });
    }
    if (['ban', 'unban', 'gmute', 'ungmute', 'warn'].includes(cmd) && guard()) return bad(res, guard(), 403);
    if (cmd === 'ban') { const r = await setBanned(req.user, t, true, arg); return r.ok ? done(`@${t.username} is suspended`) : bad(res, r.error, r.status); }
    if (cmd === 'unban') { const r = await setBanned(req.user, t, false, ''); return r.ok ? done(`@${t.username} is back`) : bad(res, r.error, r.status); }
    if (cmd === 'gmute') {
      const mins = durMins(arg.split(' ')[0]) || 10;
      await q(`update users set muted_until=now()+make_interval(mins=>$2) where id=$1`, [t.id, Math.min(mins, 60 * 24 * 30)]);
      sendTo(t.id, { t: 'me_update' });
      audit.log(q, req.user, 'mute', nameOf(t), { detail: mins + ' min' });
      return done(`@${t.username} is muted everywhere for ${niceSecs(mins * 60)}`);
    }
    if (cmd === 'ungmute') { await q('update users set muted_until=null where id=$1', [t.id]); sendTo(t.id, { t: 'me_update' }); audit.log(q, req.user, 'unmute', nameOf(t)); return done(`@${t.username} can talk again`); }
    if (cmd === 'warn') {
      if (!arg) return bad(res, 'use /warn @user reason');
      await notify(t.id, 'warn', { text: arg, by: req.user.username });
      audit.log(q, req.user, 'warn', nameOf(t), { detail: arg });
      return done(`warned @${t.username}`);
    }
    if (cmd === 'verify' || cmd === 'unverify') {
      if (!safety.setVerified) return bad(res, 'not ready', 503);
      await safety.setVerified(t.id, cmd === 'verify');
      audit.log(q, req.user, cmd, nameOf(t));
      return done(cmd === 'verify' ? `@${t.username} is verified` : `@${t.username} is no longer verified`);
    }
    if (cmd === 'beta') {
      const clear = /^(clear|off|0)$/i.test(arg);
      const mins = clear ? 0 : durMins(arg);
      if (!clear && !mins) return bad(res, 'use /beta @user 30m, 1d, 1w or clear');
      await q(`update users set beta_until=${mins ? 'greatest(coalesce(beta_until,now()),now()) + make_interval(mins=>$2)' : 'null'} where id=$1`, mins ? [t.id, Math.min(mins, 525600)] : [t.id]);
      if (ensureFor) await ensureFor((await q('select * from users where id=$1', [t.id])).rows[0]);
      sendTo(t.id, { t: 'me_update' });
      audit.bump(q, 'beta_grants');
      audit.log(q, req.user, clear ? 'beta_clear' : 'beta_grant', nameOf(t), { detail: clear ? '' : arg });
      return done(clear ? `beta removed from @${t.username}` : `gave @${t.username} ${arg} of beta`);
    }
    bad(res, 'unknown command');
  }));

  // ---------- audit log (admins) ----------
  app.get('/api/admin/audit', auth, adminOnly, byUser('audit', 60, 60_000), wrap(async (req, res) => {
    const before = parseInt(req.query.before, 10) || 9e15;
    const who = String(req.query.q || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
    const act = String(req.query.action || '').replace(/[^a-z_]/g, '').slice(0, 24);
    const params = [before]; let where = "id<$1 and action<>'owner_cmd'";   // the owner's console history is not for other admins
    if (who) { params.push(who); where += ` and (lower(actor_name)=$${params.length} or lower(target_name)=$${params.length})`; }
    if (act) { params.push(act); where += ` and action=$${params.length}`; }
    const r = await q(`select id,at,actor_name,action,target_name,conv_name,detail from audit where ${where} order by id desc limit 60`, params);
    res.json({ log: r.rows.map(rowOut), more: r.rows.length === 60 });
  }));

  // ---------- appeals ----------
  app.post('/api/appeals', rl('appeal-ip', 6, 3_600_000), wrap(async (req, res) => {
    const uid = readAppealToken(secret(), req.body.token);
    if (!uid) return bad(res, 'that took too long, sign in again to appeal', 401);
    const u = (await q('select id,username,banned from users where id=$1', [uid])).rows[0];
    if (!u || !u.banned) return bad(res, 'this account is not suspended');
    const msg = String(req.body.message || '').trim();
    if (msg.length < 10) return bad(res, 'say a bit more, at least a sentence');
    if (msg.length > 600) return bad(res, 'keep it under 600 characters');
    if (safety.F.check(msg)) return bad(res, 'keep it respectful, appeals with swearing are ignored');
    const last = (await q('select status,created_at,decided_at from appeals where user_id=$1 order by id desc limit 1', [uid])).rows[0];
    if (last && last.status === 'pending') return bad(res, 'you already have an appeal waiting', 409);
    if (last && last.decided_at && Date.now() - new Date(last.decided_at) < 24 * 3600_000) return bad(res, 'you can appeal again 24 hours after the last answer', 429);
    await q('insert into appeals(user_id,message) values($1,$2)', [uid, msg]);
    audit.bump(q, 'appeals');
    for (const a of (await q('select id from users where is_admin and not banned')).rows) { notify(a.id, 'appeal', { by: u.username }).catch(() => {}); sendTo(a.id, { t: 'appeals_changed' }); }
    res.json({ ok: true });
  }));
  app.get('/api/admin/appeals', auth, adminOnly, wrap(async (req, res) => {
    const all = req.query.status === 'all';
    const r = await q(`select a.id,a.message,a.status,a.response,a.created_at,a.decided_at,u.id user_id,u.username,u.display_name,u.banned,u.ban_reason,u.msg_count,u.created_at joined, d.username decider
      from appeals a join users u on u.id=a.user_id left join users d on d.id=a.decided_by ${all ? '' : "where a.status='pending'"} order by a.id desc limit 60`);
    res.json({ appeals: r.rows.map((x) => ({ id: Number(x.id), message: x.message, status: x.status, response: x.response || '', createdAt: x.created_at, decidedAt: x.decided_at, userId: x.user_id, username: x.username, displayName: x.display_name, banned: x.banned, banReason: x.ban_reason || '', messages: Number(x.msg_count || 0), joined: x.joined, decidedBy: x.decider || null })) });
  }));
  app.post('/api/admin/appeals/:id', auth, adminOnly, byUser('appeal-decide', 40, 60_000), wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const approve = !!req.body.approve;
    const response = String(req.body.response || '').trim().slice(0, 300);
    const a = (await q(`select a.id,a.user_id,u.username,u.is_admin from appeals a join users u on u.id=a.user_id where a.id=$1 and a.status='pending'`, [id])).rows[0];
    if (!a) return bad(res, 'already answered', 404);
    if (approve) {
      const r = await setBanned(req.user, { id: a.user_id, username: a.username, is_admin: a.is_admin }, false, '');
      if (!r.ok) return bad(res, r.error, r.status);
    }
    await q('update appeals set status=$2,response=$3,decided_by=$4,decided_at=now() where id=$1', [id, approve ? 'approved' : 'denied', response || null, req.user.id]);
    audit.log(q, req.user, approve ? 'appeal_approved' : 'appeal_denied', { id: a.user_id, username: a.username }, { detail: response });
    for (const ad of (await q('select id from users where is_admin and not banned')).rows) sendTo(ad.id, { t: 'appeals_changed' });
    res.json({ ok: true });
  }));

  // ---------- stats page ----------
  app.get('/api/admin/analytics', auth, adminOnly, byUser('analytics', 30, 60_000), wrap(async (req, res) => {
    const one = async (sql, p) => Number((await q(sql, p)).rows[0].c || 0);
    const totals = {
      users: await one('select count(*) c from users'),
      newWeek: await one(`select count(*) c from users where created_at > now() - interval '7 days'`),
      verified: await one('select count(*) c from users where verified and not is_admin'),
      beta: await one('select count(*) c from users where beta_until > now() and verified and not is_admin'),
      banned: await one('select count(*) c from users where banned'),
      groups: await one(`select count(*) c from conversations where type='group' and system_kind is null`),
      dms: await one(`select count(*) c from conversations where type='dm'`),
      online: sockets.size,
      wau: await one(`select count(distinct user_id) c from user_days where day > current_date - 7`),
      mau: await one(`select count(distinct user_id) c from user_days where day > current_date - 30`),
      dau: await one(`select count(*) c from user_days where day = current_date`),
      openReports: await one(`select count(*) c from reports where status='open'`),
      pendingVerify: await one(`select count(*) c from verifications where status='pending'`),
      pendingAppeals: await one(`select count(*) c from appeals where status='pending'`),
      reminders: await one('select count(*) c from reminders'),
      images: await one('select count(*) c from blobs'),
      imageBytes: await one('select coalesce(sum(size),0) c from blobs'),
      dbBytes: await one('select pg_database_size(current_database()) c'),
    };
    const days = (await q(`select to_char(d,'YYYY-MM-DD') as day,
        (select count(*) from users where created_at::date=d)::int signups,
        (select count(*) from users where verified_at::date=d and not is_admin)::int verified,
        coalesce((select messages from daily_stats where day=d),0) messages,
        coalesce((select beta_grants from daily_stats where day=d),0) beta,
        (select count(*) from user_days where day=d)::int active
      from generate_series(current_date-13, current_date, interval '1 day') d order by d`)).rows;
    res.json({ totals, days });
  }));
  return { setBanned };
}

// ---------- mentions: the sender names userIds, the server keeps only the ones really in the chat ----------
async function afterSend(ctx, { user, conv, convId, message, mentions }) {
  const { q, sendTo, notify, pushTo, limiter } = ctx;
  if (!Array.isArray(mentions) || !mentions.length) return;
  const ids = [...new Set(mentions.filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x) && x !== user.id))].slice(0, 5);
  if (!ids.length) return;
  const who = (await q('select m.user_id from members m join users u on u.id=m.user_id where m.conv_id=$1 and m.user_id=any($2) and not u.banned', [convId, ids])).rows;
  for (const w of who) {
    if (!limiter.hit(`mention:${user.id}:${w.user_id}`, 4, 60_000).ok) continue;
    if (await ctx.isBlockedEitherWay(user.id, w.user_id)) continue;
    notify(w.user_id, 'mention', { convId, msgId: message.id, by: user.username, byName: user.display_name, convName: conv.type === 'group' ? conv.name : '' }).catch(() => {});
    if (!ctx.sockets.has(w.user_id)) pushTo(w.user_id, convId, `${user.display_name} mentioned you`, conv.type === 'group' ? `in ${conv.name}` : 'in a chat', true).catch(() => {});
  }
}

// ---------- background loop: reminders + housekeeping ----------
function start(ctx) {
  const { q, notify, pushTo } = ctx;
  setInterval(async () => {
    try {
      const due = await q('delete from reminders where remind_at<=now() returning user_id,conv_id,msg_id,note');
      for (const r of due.rows) {
        notify(r.user_id, 'reminder', { convId: r.conv_id, msgId: r.msg_id ? Number(r.msg_id) : null, note: r.note || '' }).catch(() => {});
        pushTo(r.user_id, r.conv_id || 'reminder', 'Reminder', r.note || 'a message you wanted to come back to', true).catch(() => {});
      }
      await q(`delete from blobs where msg_id is null and created_at < now() - interval '1 hour'`);       // uploaded but never sent
      await q(`delete from audit where at < now() - interval '90 days'`);
      await q(`delete from user_days where day < current_date - 120`);
    } catch (e) { console.warn('mod loop', e.message); }
  }, 20_000).unref();
}

module.exports = { mount, start, afterSend, sendGate, dndActive, canAct, isStaff, rankOf, appealToken, readAppealToken, SLOW_CHOICES, WP_PRESETS };

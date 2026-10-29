// lib/safety.js - word filter, verification, announcements, badges, and the two built-in servers (everyone + beta lounge)
const crypto = require('crypto');                            // decrypt public room messages for filtering
const express = require('express');                          // bigger json parser for the id photo upload
const audit = require('./audit');                            // audit log + stats counters
const { makeFilter } = require('./filter');                  // shared word filter
const WORDS = require('./badwords.json');                    // list of words (generated once from the bad-words package)

const F = makeFilter(WORDS);                                 // F.check(text) / F.clean(text)
const FREE_MSGS = parseInt(process.env.UNVERIFIED_MESSAGES, 10) || 20;   // messages an unverified person may send, ever
const verifiedOn = (u) => !!(u && (u.is_admin || u.verified)); // admins count as verified
const betaOn = (u) => !!(u && (u.is_admin || (u.verified && u.beta_until && new Date(u.beta_until) > new Date()))); // beta needs verification too

// ---------- built-in servers ----------
const SYSTEM = {
  all: { name: 'Everyone', description: 'the whole of Chatroom, say hi', topic: 'chill' },
  beta: { name: 'Beta lounge', description: 'only people with beta can see this one', topic: 'tech' },
};
async function initSystem(q) {                               // create both rooms once
  for (const [kind, s] of Object.entries(SYSTEM)) {
    await q(`insert into conversations(type,name,key_version,is_public,description,topic,system_kind) values('group',$1,1,true,$2,$3,$4) on conflict (system_kind) where system_kind is not null do nothing`, [s.name, s.description, s.topic, kind]);
  }
}
// put a person into the rooms they should be in (and out of the beta room when beta is off)
async function ensureSystem(q, u) {
  const rooms = (await q(`select id,system_kind from conversations where system_kind is not null`)).rows;
  for (const r of rooms) {
    if (r.system_kind === 'beta' && !betaOn(u)) { await q('delete from members where conv_id=$1 and user_id=$2', [r.id, u.id]); continue; }
    const role = u.is_admin ? 'admin' : 'member';
    await q(`insert into members(conv_id,user_id,role,joined_at) values($1,$2,$3,now() - interval '3 days') on conflict (conv_id,user_id) do update set role=case when excluded.role='admin' then 'admin' when members.role='admin' then 'member' else members.role end`, [r.id, u.id, role]);
  }
}

// ---------- public rooms are readable by the server, so they get a real filter ----------
function decryptPublic(convId, senderId, keyVersion, ciphertext, iv) {
  try {
    const key = crypto.createHash('sha256').update('chatroom-public-v1|' + convId).digest();
    const buf = Buffer.from(ciphertext, 'base64'), tag = buf.subarray(buf.length - 16), body = buf.subarray(0, buf.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    d.setAAD(Buffer.from(`${convId}|${senderId}|${keyVersion}`));
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(body), d.final()]).toString('utf8'));
  } catch { return null; }
}
function encryptPublic(convId, senderId, keyVersion, payload) {   // the inverse of decryptPublic, used by the gng bot to speak in public rooms
  const key = crypto.createHash('sha256').update('chatroom-public-v1|' + convId).digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(`${convId}|${senderId}|${keyVersion}`));
  const body = Buffer.concat([c.update(JSON.stringify(payload), 'utf8'), c.final()]);
  return { ciphertext: Buffer.concat([body, c.getAuthTag()]).toString('base64'), iv: iv.toString('base64') };
}
function payloadDirty(p) { return !!payloadDirtyImpl(p); }
const payloadDirtyImpl = (p) => !!p && ((typeof p.text === 'string' && F.check(p.text)) || (typeof p.title === 'string' && F.check(p.title)) || (typeof p.q === 'string' && F.check(p.q)) || (typeof p.name === 'string' && F.check(p.name.replace(/_/g, ' '))) || (Array.isArray(p.opts) && p.opts.some((o) => typeof o === 'string' && F.check(o))) || (p.reply && typeof p.reply.snip === 'string' && F.check(p.reply.snip)) || (p.inner && payloadDirty(p.inner)));   // text, titles, poll questions/options, sticker names

// ---------- badges ----------
const BADGES = [
  { id: 'first_words', name: 'First words', desc: 'send your first message', icon: 'chat', stat: 'msgs', target: 1 },
  { id: 'chatterbox', name: 'Chatterbox', desc: 'send 50 messages', icon: 'music', stat: 'msgs', target: 50 },
  { id: 'yapper', name: 'Yapper', desc: 'send 200 messages', icon: 'flame', stat: 'msgs', target: 200 },
  { id: 'legend', name: 'Legend', desc: 'send 1000 messages', icon: 'crown', stat: 'msgs', target: 1000 },
  { id: 'reactor', name: 'Reactor', desc: 'react to 25 messages', icon: 'smile', stat: 'reacts', target: 25 },
  { id: 'gamer', name: 'Gamer', desc: 'play 10 games', icon: 'gamepad', stat: 'plays', target: 10 },
  { id: 'host', name: 'Host', desc: 'start a public group', icon: 'globe', stat: 'hosted', target: 1 },
  { id: 'recruiter', name: 'Recruiter', desc: 'bring in a friend', icon: 'gift', stat: 'refs', target: 1 },
  { id: 'influencer', name: 'Influencer', desc: 'bring in 5 friends', icon: 'star', stat: 'refs', target: 5 },
  { id: 'real_one', name: 'Real one', desc: 'get verified', icon: 'shield', stat: 'verified', target: 1 },
];
async function statsOf(q, u) {
  const refs = await q('select count(*)::int c from users where referred_by=$1 and ref_credited', [u.id]);
  const hosted = await q('select count(*)::int c from conversations where created_by=$1 and is_public and system_kind is null', [u.id]);
  return { msgs: u.msg_count || 0, reacts: u.react_count || 0, plays: u.play_count || 0, hosted: hosted.rows[0].c, refs: refs.rows[0].c, verified: verifiedOn(u) ? 1 : 0 };
}
let hub = { sendTo: () => {} };                              // filled by mount()
async function badgeCheck(q, userId) {                       // award anything newly earned and tell the person
  try {
    const u = (await q('select * from users where id=$1', [userId])).rows[0];
    if (!u) return;
    const st = await statsOf(q, u);
    for (const b of BADGES) {
      if (st[b.stat] < b.target) continue;
      const r = await q('insert into user_badges(user_id,badge) values($1,$2) on conflict do nothing returning badge', [userId, b.id]);
      if (r.rows[0]) hub.sendTo(userId, { t: 'badge', badge: { id: b.id, name: b.name, desc: b.desc, icon: b.icon } });
    }
  } catch (e) { console.error('badge check failed', e.message); }
}

function mount(app, ctx) {
  const { q, auth, adminOnly, byUser, bad, wrap, sendTo, notify, sockets, isUuid, ensureFor, onVerified } = ctx;
  hub = { sendTo };

  // ----- announcements -----
  const annRow = (a) => ({ id: Number(a.id), title: a.title, body: a.body, buttonLabel: a.button_label || '', buttonUrl: a.button_url || '', createdAt: a.created_at });
  app.get('/api/announcements', auth, wrap(async (req, res) => {
    const r = await q(`select * from announcements where active and created_at > now() - interval '30 days' order by id desc limit 3`);
    res.json({ announcements: r.rows.map(annRow) });
  }));
  app.post('/api/admin/announcements', auth, adminOnly, byUser('announce', 10, 3_600_000), wrap(async (req, res) => {
    const title = String(req.body.title || '').trim().slice(0, 80);
    const body = String(req.body.body || '').trim().slice(0, 1000);
    const buttonLabel = String(req.body.buttonLabel || '').trim().slice(0, 24);
    let buttonUrl = String(req.body.buttonUrl || '').trim().slice(0, 300);
    if (!title) return bad(res, 'add a title');
    if (buttonUrl) { try { if (new URL(buttonUrl).protocol !== 'https:') throw 0; } catch { return bad(res, 'button link must be a full https link'); } }
    if (buttonUrl && !buttonLabel) return bad(res, 'name the button');
    const r = await q('insert into announcements(title,body,button_label,button_url,created_by) values($1,$2,$3,$4,$5) returning *', [title, body, buttonLabel || null, buttonUrl || null, req.user.id]);
    const a = annRow(r.rows[0]);
    audit.log(q, req.user, 'announce', null, { detail: title });
    for (const uid of sockets.keys()) sendTo(uid, { t: 'announce', announcement: a });     // everyone online sees it right away
    res.json({ announcement: a });
  }));
  app.get('/api/admin/announcements', auth, adminOnly, wrap(async (req, res) => {
    const r = await q('select * from announcements order by id desc limit 20');
    res.json({ announcements: r.rows.map((a) => ({ ...annRow(a), active: a.active })) });
  }));
  app.delete('/api/admin/announcements/:id', auth, adminOnly, wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return bad(res, 'bad id');
    await q('update announcements set active=false where id=$1', [id]);
    for (const uid of sockets.keys()) sendTo(uid, { t: 'announce_end', id });
    res.json({ ok: true });
  }));

  // ----- verification (a photo of an id, reviewed by an admin, deleted straight after) -----
  const big = express.json({ limit: '900kb' });              // photo upload only, everything else stays at 64kb
  app.post('/api/verify', auth, big, byUser('verify', 4, 3_600_000), wrap(async (req, res) => {
    if (verifiedOn(req.user)) return bad(res, 'you are already verified');
    const img = String(req.body.image || '');
    const m = img.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return bad(res, 'send a jpeg photo');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length < 4000 || buf.length > 600_000 || buf[0] !== 0xff || buf[1] !== 0xd8) return bad(res, 'that photo does not look right, try again');
    if ((await q(`select 1 from verifications where user_id=$1 and status='pending'`, [req.user.id])).rows[0]) return bad(res, 'you already have one waiting for review', 409);
    await q('insert into verifications(user_id,image) values($1,$2)', [req.user.id, buf]);
    const admins = await q('select id from users where is_admin and not banned');
    for (const a of admins.rows) { sendTo(a.id, { t: 'verify_changed' }); }
    res.json({ ok: true });
  }));
  app.get('/api/verify/status', auth, wrap(async (req, res) => {
    const r = await q('select status,note,created_at from verifications where user_id=$1 order by id desc limit 1', [req.user.id]);
    const ad = await q('select username,display_name from users where is_admin and not banned order by created_at limit 4');
    res.json({ admins: ad.rows.map((a) => ({ username: a.username, displayName: a.display_name })), verified: verifiedOn(req.user), last: r.rows[0] ? { status: r.rows[0].status, note: r.rows[0].note || '', createdAt: r.rows[0].created_at } : null, freeMessages: FREE_MSGS, used: req.user.msg_count || 0 });
  }));
  app.get('/api/admin/verifications', auth, adminOnly, wrap(async (req, res) => {
    const r = await q(`select v.id,v.created_at,u.id uid,u.username,u.display_name,u.msg_count from verifications v join users u on u.id=v.user_id where v.status='pending' and v.image is not null order by v.id limit 50`);
    res.json({ items: r.rows.map((x) => ({ id: Number(x.id), createdAt: x.created_at, userId: x.uid, username: x.username, displayName: x.display_name, messages: x.msg_count })) });
  }));
  app.get('/api/admin/verifications/:id/image', auth, adminOnly, byUser('verify-img', 60, 60_000), wrap(async (req, res) => {
    const r = await q(`select image from verifications where id=$1 and status='pending'`, [parseInt(req.params.id, 10) || 0]);
    if (!r.rows[0] || !r.rows[0].image) return bad(res, 'gone', 404);
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
    res.send(r.rows[0].image);
  }));
  async function setVerified(userId, on) {
    await q('update users set verified=$2, verified_at=case when $2 then now() else null end where id=$1', [userId, on]);
    const u = (await q('select * from users where id=$1', [userId])).rows[0];
    if (u && ensureFor) await ensureFor(u);                  // beta room follows verification
    sendTo(userId, { t: 'me_update' });
    if (on) { badgeCheck(q, userId); audit.bump(q, 'verified'); if (u && onVerified) onVerified(u).catch(() => {}); }
  }
  module.exports.setVerified = setVerified;                    // the /verify command uses the same path
  app.post('/api/admin/verifications/:id', auth, adminOnly, wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const approve = !!req.body.approve;
    const note = String(req.body.note || '').trim().slice(0, 120);
    const r = await q(`update verifications set status=$2, note=$3, image=null, reviewed_by=$4, reviewed_at=now() where id=$1 and status='pending' returning user_id`, [id, approve ? 'approved' : 'rejected', note || null, req.user.id]); // the photo is deleted right here
    if (!r.rows[0]) return bad(res, 'already handled', 404);
    if (approve) await setVerified(r.rows[0].user_id, true);
    audit.log(q, req.user, approve ? 'verify_approved' : 'verify_rejected', { id: r.rows[0].user_id, username: (await q('select username from users where id=$1', [r.rows[0].user_id])).rows[0]?.username }, { detail: note });
    await notify(r.rows[0].user_id, approve ? 'verified' : 'verify_rejected', { note });
    sendTo(r.rows[0].user_id, { t: 'me_update' });
    for (const a of (await q('select id from users where is_admin')).rows) sendTo(a.id, { t: 'verify_changed' });
    res.json({ ok: true });
  }));
  app.post('/api/admin/users/:id/verify', auth, adminOnly, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return bad(res, 'bad id');
    const on = !!req.body.verified;
    await setVerified(req.params.id, on);
    audit.log(q, req.user, on ? 'verify' : 'unverify', { id: req.params.id, username: (await q('select username from users where id=$1', [req.params.id])).rows[0]?.username });
    if (on) await q(`update verifications set status='approved', image=null, reviewed_by=$2, reviewed_at=now() where user_id=$1 and status='pending'`, [req.params.id, req.user.id]);
    res.json({ ok: true });
  }));

  // ----- badges -----
  app.get('/api/badges/mine', auth, wrap(async (req, res) => {
    const st = await statsOf(q, req.user);
    const got = new Set((await q('select badge from user_badges where user_id=$1', [req.user.id])).rows.map((r) => r.badge));
    res.json({ badges: BADGES.map((b) => ({ id: b.id, name: b.name, desc: b.desc, icon: b.icon, target: b.target, progress: Math.min(st[b.stat], b.target), earned: got.has(b.id) })) });
  }));
}

// earned badges for a person, used on profiles
async function badgesOf(q, userId) {
  const r = await q('select badge from user_badges where user_id=$1 order by earned_at', [userId]);
  return r.rows.map((x) => BADGES.find((b) => b.id === x.badge)).filter(Boolean).map((b) => ({ id: b.id, name: b.name, desc: b.desc, icon: b.icon }));
}

module.exports = { mount, F, FREE_MSGS, verifiedOn, betaOn, initSystem, ensureSystem, decryptPublic, encryptPublic, payloadDirty, badgeCheck, badgesOf, BADGES };

// lib/features.js - reactions, pins, deletes, reports, public groups, referrals/beta, gifs, themes, changelog
const fs = require('fs');                                    // read the changelog file
const path = require('path');                                // build file paths
const crypto = require('crypto');                            // referral codes

const REF_MINUTES = 30;                                      // beta minutes a referrer earns per activated friend
const REF_CAP = parseInt(process.env.REFERRAL_CAP, 10) || 20; // max credited referrals per person (stops farming)
const PLAY_KEEP = 12;                                        // game sessions kept per user
const TOPICS = ['chill', 'gaming', 'music', 'art', 'study', 'tech', 'memes', 'other'];
const REASONS = ['spam', 'harassment', 'inappropriate', 'impersonation', 'other'];
const PRESETS = ['cocoa', 'midnight', 'forest', 'rose', 'slate'];
const GIF_HOSTS = ['tenor.com', 'giphy.com', 'klipy.com', 'klipy.co', 'imgur.com'];   // only these may be shown or fetched
const GIF_KEY = process.env.GIF_API_KEY || '';               // klipy key (tenor's api was shut down in june 2026)
const GIF_BASE = process.env.GIF_API_BASE || 'https://api.klipy.com/api/v1';

const safety = require('./safety');                          // word filter, verification, badges
const audit = require('./audit');                            // audit log + stats counters
const betaOn = safety.betaOn;                                // beta needs a verified account (admins always have it)
const hostOk = (raw) => { try { const u = new URL(raw); return u.protocol === 'https:' && GIF_HOSTS.some((d) => u.hostname === d || u.hostname.endsWith('.' + d)); } catch { return false; } };
const emojiOk = (s) => typeof s === 'string' && s.length > 0 && s.length <= 16 && /\p{Extended_Pictographic}/u.test(s) && !/[A-Za-z]/.test(s);
const genCode = () => crypto.randomBytes(8).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);

// timeout helper for outbound fetches
async function tfetch(url, opts = {}, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}

// keep only the newest PLAY_KEEP sessions per user (all users, or one)
async function pruneOldPlays(q, userId) {
  await q(`delete from plays where id in (select id from (select id, row_number() over (partition by user_id order by id desc) rn from plays ${userId ? 'where user_id=$1' : ''}) x where rn>${PLAY_KEEP})`, userId ? [userId] : []);
}

// my referral code (made on first ask) plus counts
async function refInfo(q, u) {
  if (!safety.verifiedOn(u)) return { locked: true, code: null, referred: 0, credited: 0, cap: REF_CAP, minutes: REF_MINUTES };   // only verified people get a link
  let code = u.referral_code;
  for (let i = 0; i < 6 && !code; i++) {
    try {
      const r = await q('update users set referral_code=$2 where id=$1 and referral_code is null returning referral_code', [u.id, genCode()]);
      code = r.rows[0] ? r.rows[0].referral_code : (await q('select referral_code from users where id=$1', [u.id])).rows[0].referral_code;
    } catch (e) { if (e.code !== '23505') throw e; }
  }
  const s = await q('select count(*)::int referred, count(*) filter (where ref_credited)::int credited from users where referred_by=$1', [u.id]);
  return { code, referred: s.rows[0].referred, credited: s.rows[0].credited, cap: REF_CAP, minutes: REF_MINUTES };
}

// called when an account gets verified: that is the moment a referral counts and pays the referrer
async function creditReferral(ctx, user) {
  if (!user.referred_by || user.ref_credited || !user.verified) return;
  const { q, sendTo, notify } = ctx;
  const rv = (await q('select verified,is_admin,banned from users where id=$1', [user.referred_by])).rows[0];
  if (!rv || rv.banned || !(rv.verified || rv.is_admin)) return;   // the referrer has to be verified too
  const mark = await q('update users set ref_credited=true where id=$1 and not ref_credited returning id', [user.id]);
  if (!mark.rows[0]) return;
  const n = await q('select count(*)::int c from users where referred_by=$1 and ref_credited', [user.referred_by]);
  if (n.rows[0].c > REF_CAP) return;
  const r = await q(`update users set beta_until=greatest(coalesce(beta_until,now()),now()) + make_interval(mins=>$2) where id=$1 and not banned returning id`, [user.referred_by, REF_MINUTES]);
  if (!r.rows[0]) return;
  notify(user.referred_by, 'referral', { name: user.display_name, minutes: REF_MINUTES }).catch(() => {});
  const ref = (await q('select * from users where id=$1', [user.referred_by])).rows[0];
  if (ref && ctx.ensureFor) await ctx.ensureFor(ref);       // beta lounge opens for them
  sendTo(user.referred_by, { t: 'me_update' });
  safety.badgeCheck(q, user.referred_by);
}

function mount(app, c) {
  const { q, pool, auth, byUser, bad, wrap, sendTo, sendToConv, notify, isUuid, loadConversations, adminOnly, ensureFor } = c;
  const betaOnly = (req, res, next) => (betaOn(req.user) ? next() : res.status(403).json({ error: 'beta_required', message: 'beta only' }));

  // ---------- reactions ----------
  app.put('/api/messages/:id/reactions', auth, byUser('react', 90, 60_000), wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0, emoji = req.body.emoji, on = req.body.on !== false;
    if (!emojiOk(emoji)) return bad(res, 'bad emoji');
    if (!safety.verifiedOn(req.user)) return res.status(403).json({ error: 'verify_required', message: 'verify your account to react' });
    const m = await q('select m.conv_id,m.deleted from messages m join members mem on mem.conv_id=m.conv_id and mem.user_id=$2 where m.id=$1', [id, req.user.id]);
    if (!m.rows[0] || m.rows[0].deleted) return bad(res, 'not found', 404);
    if (on) {
      const cnt = await q('select count(distinct emoji)::int c, bool_or(emoji=$2 and user_id=$3) mine from reactions where msg_id=$1', [id, emoji, req.user.id]);
      if (cnt.rows[0].c >= 20 && !cnt.rows[0].mine) return bad(res, 'too many different reactions');
      const ins = await q('insert into reactions(msg_id,user_id,emoji) values($1,$2,$3) on conflict do nothing returning msg_id', [id, req.user.id, emoji]);
      if (ins.rows[0]) { await q('update users set react_count=react_count+1 where id=$1', [req.user.id]); safety.badgeCheck(q, req.user.id); }
    } else await q('delete from reactions where msg_id=$1 and user_id=$2 and emoji=$3', [id, req.user.id, emoji]);
    await sendToConv(m.rows[0].conv_id, { t: 'reaction', convId: m.rows[0].conv_id, msgId: id, userId: req.user.id, emoji, on });
    res.json({ ok: true });
  }));

  // ---------- pins ----------
  app.post('/api/messages/:id/pin', auth, byUser('pin', 30, 60_000), wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0, on = req.body.on !== false;
    const r = await q('select m.id,m.conv_id,m.deleted,mem.role,c.type from messages m join members mem on mem.conv_id=m.conv_id and mem.user_id=$2 join conversations c on c.id=m.conv_id where m.id=$1', [id, req.user.id]);
    const m = r.rows[0];
    if (!m || m.deleted) return bad(res, 'not found', 404);
    if (m.type === 'group' && m.role !== 'admin' && m.role !== 'mod') return bad(res, 'hosts and mods only', 403);
    if (on) {
      const n = await q('select count(*)::int c from pins where conv_id=$1', [m.conv_id]);
      if (n.rows[0].c >= 5) return bad(res, 'max 5 pins, unpin one first');
      await q('insert into pins(msg_id,conv_id,pinned_by) values($1,$2,$3) on conflict do nothing', [id, m.conv_id, req.user.id]);
    } else await q('delete from pins where msg_id=$1', [id]);
    await sendToConv(m.conv_id, { t: 'pin', convId: m.conv_id, msgId: id, on, by: req.user.id });
    res.json({ ok: true });
  }));
  app.get('/api/conversations/:id/pins', auth, byUser('pins-read', 60, 60_000), wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return bad(res, 'bad id');
    const r = await q(`select m.id,m.sender_id "senderId",m.ciphertext,m.iv,m.key_version "keyVersion",m.created_at "createdAt",m.deleted from pins p join messages m on m.id=p.msg_id
      join members mem on mem.conv_id=p.conv_id and mem.user_id=$2 where p.conv_id=$1 order by p.created_at desc`, [req.params.id, req.user.id]);
    res.json({ pins: r.rows.map((x) => ({ ...x, id: Number(x.id), pinned: true })) });
  }));

  // ---------- deleting (own messages, or anything in a group you host) ----------
  async function deleteMsgs(user, rawIds) {
    const ids = [...new Set((rawIds || []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, 50);
    if (!ids.length) return [];
    const r = await q(`select m.id,m.conv_id,m.sender_id,mem.role,c.type,c.name,sm.role sender_role,su.is_admin sender_admin from messages m join members mem on mem.conv_id=m.conv_id and mem.user_id=$2 join conversations c on c.id=m.conv_id
      left join members sm on sm.conv_id=m.conv_id and sm.user_id=m.sender_id left join users su on su.id=m.sender_id where m.id=any($1) and not m.deleted`, [ids, user.id]);
    const rank = (isAdmin, role) => (isAdmin ? 3 : role === 'admin' ? 2 : role === 'mod' ? 1 : 0);
    const ok = r.rows.filter((x) => x.sender_id === user.id || (x.type === 'group' && rank(user.is_admin, x.role) >= 1 && rank(user.is_admin, x.role) > rank(x.sender_admin, x.sender_role))); // hosts and mods can remove other people's messages, never from someone who outranks them
    if (!ok.length) return [];
    const okIds = ok.map((x) => Number(x.id));
    await q(`update messages set deleted=true,ciphertext='',iv='' where id=any($1)`, [okIds]);
    await q('delete from blobs where msg_id=any($1)', [okIds]);           // images go with their message
    await q('delete from pins where msg_id=any($1)', [okIds]);
    for (const x of ok) if (x.sender_id !== user.id) audit.log(q, user, 'delete_msg', { id: x.sender_id }, { convId: x.conv_id, convName: x.name });
    await q('delete from reactions where msg_id=any($1)', [okIds]);
    const byConv = new Map();
    for (const x of ok) { if (!byConv.has(x.conv_id)) byConv.set(x.conv_id, []); byConv.get(x.conv_id).push(Number(x.id)); }
    for (const [convId, list] of byConv) await sendToConv(convId, { t: 'msgs_deleted', convId, ids: list });
    return okIds;
  }
  app.delete('/api/messages/:id', auth, byUser('msg-del', 60, 60_000), wrap(async (req, res) => {
    const done = await deleteMsgs(req.user, [req.params.id]);
    if (!done.length) return bad(res, 'not found', 404);
    res.json({ ok: true });
  }));
  app.post('/api/messages/delete', auth, byUser('msg-del-bulk', 20, 60_000), wrap(async (req, res) => {
    const done = await deleteMsgs(req.user, Array.isArray(req.body.ids) ? req.body.ids : []);
    res.json({ ok: true, deleted: done });
  }));

  // ---------- reports ----------
  app.post('/api/reports', auth, byUser('report', 10, 3_600_000), wrap(async (req, res) => {
    const b = req.body || {};
    const kind = b.kind, reason = REASONS.includes(b.reason) ? b.reason : null;
    if (!['message', 'user', 'group'].includes(kind) || !reason) return bad(res, 'bad report');
    const note = String(b.note || '').slice(0, 400), snapshot = String(b.snapshot || '').slice(0, 600);
    let target = null, convId = null, msgId = null;
    if (kind === 'message') {
      msgId = parseInt(b.msgId, 10) || 0;
      const m = await q('select m.sender_id,m.conv_id from messages m join members mem on mem.conv_id=m.conv_id and mem.user_id=$2 where m.id=$1', [msgId, req.user.id]);
      if (!m.rows[0]) return bad(res, 'not found', 404);
      target = m.rows[0].sender_id; convId = m.rows[0].conv_id;
    } else if (kind === 'user') {
      const u = await q('select id from users where username=$1', [String(b.username || '').toLowerCase()]);
      if (!u.rows[0]) return bad(res, 'not found', 404);
      target = u.rows[0].id;
    } else {
      if (!isUuid(b.convId)) return bad(res, 'bad group');
      const g = await q('select id,created_by from conversations where id=$1 and is_public', [b.convId]);
      if (!g.rows[0]) return bad(res, 'not found', 404);
      convId = g.rows[0].id; target = g.rows[0].created_by;
    }
    if (target === req.user.id) return bad(res, 'that is you');
    const dupe = await q(`select 1 from reports where reporter_id=$1 and kind=$2 and target_user is not distinct from $3 and msg_id is not distinct from $4 and conv_id is not distinct from $5 and status='open'`, [req.user.id, kind, target, msgId, convId]);
    if (!dupe.rows[0]) {
      await q('insert into reports(reporter_id,kind,target_user,conv_id,msg_id,reason,note,snapshot) values($1,$2,$3,$4,$5,$6,$7,$8)', [req.user.id, kind, target, convId, msgId, reason, note, snapshot]);
      audit.bump(q, 'reports');
      const admins = await q('select id from users where is_admin and not banned');
      for (const a of admins.rows) { notify(a.id, 'report', { kind, reason }).catch(() => {}); sendTo(a.id, { t: 'reports_changed' }); }
    }
    res.json({ ok: true });
  }));
  app.get('/api/admin/reports', auth, adminOnly, wrap(async (req, res) => {
    const all = req.query.status === 'all';
    const r = await q(`select r.id,r.kind,r.reason,r.note,r.snapshot,r.status,r.created_at,r.conv_id,r.msg_id,r.target_user,
        ru.username reporter, tu.username target, tu.display_name target_name, tu.banned target_banned, cv.name conv_name, cv.is_public
      from reports r left join users ru on ru.id=r.reporter_id left join users tu on tu.id=r.target_user left join conversations cv on cv.id=r.conv_id
      ${all ? '' : "where r.status='open'"} order by r.id desc limit 100`);
    res.json({ reports: r.rows.map((x) => ({ id: Number(x.id), kind: x.kind, reason: x.reason, note: x.note, snapshot: x.snapshot, status: x.status, createdAt: x.created_at, convId: x.conv_id, convName: x.conv_name, isPublic: x.is_public, msgId: x.msg_id ? Number(x.msg_id) : null, targetId: x.target_user, target: x.target, targetName: x.target_name, targetBanned: x.target_banned, reporter: x.reporter })) });
  }));
  app.post('/api/admin/reports/:id', auth, adminOnly, wrap(async (req, res) => {
    const status = ['resolved', 'dismissed', 'open'].includes(req.body.status) ? req.body.status : null;
    if (!status) return bad(res, 'bad status');
    await q('update reports set status=$2,handled_by=$3 where id=$1', [parseInt(req.params.id, 10) || 0, status, req.user.id]);
    audit.log(q, req.user, 'report_' + status, null, { detail: '#' + (parseInt(req.params.id, 10) || 0) });
    res.json({ ok: true });
  }));

  // ---------- public groups ----------
  app.get('/api/public', auth, byUser('public-list', 60, 60_000), wrap(async (req, res) => {
    const needle = String(req.query.q || '').trim().toLowerCase().slice(0, 40).replace(/[%_\\]/g, '');
    const topic = TOPICS.includes(req.query.topic) ? req.query.topic : null;
    const r = await q(`select c.id,c.name,c.description,c.topic,c.created_at,
        (select count(*) from members where conv_id=c.id)::int members,
        exists(select 1 from members where conv_id=c.id and user_id=$1) joined
      from conversations c where c.is_public and c.system_kind is null and ($2='' or lower(c.name) like '%'||$2||'%' or lower(coalesce(c.description,'')) like '%'||$2||'%') and ($3::text is null or c.topic=$3)
      order by members desc, c.created_at desc limit 60`, [req.user.id, needle, topic]);
    res.json({ groups: r.rows.map((g) => ({ id: g.id, name: g.name, description: g.description || '', topic: g.topic || 'other', members: g.members, joined: g.joined, createdAt: g.created_at })), topics: TOPICS });
  }));
  app.post('/api/conversations/public', auth, byUser('public-create', 5, 3_600_000), wrap(async (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 40);
    const description = String(req.body.description || '').trim().slice(0, 160);
    const topic = TOPICS.includes(req.body.topic) ? req.body.topic : 'other';
    if (name.length < 3) return bad(res, 'name needs 3+ characters');
    if (safety.F.check(name) || safety.F.check(description)) return bad(res, 'keep the name and description clean');
    const mine = await q('select count(*)::int c from conversations where created_by=$1 and is_public', [req.user.id]);
    if (mine.rows[0].c >= 3) return bad(res, 'you can host up to 3 public groups');
    const dupe = await q('select 1 from conversations where is_public and lower(name)=lower($1)', [name]);
    if (dupe.rows[0]) return bad(res, 'that name is taken', 409);
    const client = await pool.connect();
    let convId;
    try {
      await client.query('begin');
      convId = (await client.query(`insert into conversations(type,name,created_by,is_public,description,topic) values('group',$1,$2,true,$3,$4) returning id`, [name, req.user.id, description, topic])).rows[0].id;
      await client.query(`insert into members(conv_id,user_id,role) values($1,$2,'admin')`, [convId, req.user.id]);
      await client.query('commit');
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
    safety.badgeCheck(q, req.user.id);
    res.json({ ...(await loadConversations(req.user.id, convId)), convId });
  }));
  app.post('/api/public/:id/join', auth, byUser('public-join', 30, 3_600_000), wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return bad(res, 'bad id');
    const g = await q('select id,name from conversations where id=$1 and is_public and system_kind is null', [req.params.id]);
    if (!g.rows[0]) return bad(res, 'not found', 404);
    if ((await q('select 1 from conv_bans where conv_id=$1 and user_id=$2', [req.params.id, req.user.id])).rows[0]) return bad(res, 'you were removed from this group', 403);
    const n = await q('select count(*)::int c from members where conv_id=$1', [req.params.id]);
    if (n.rows[0].c >= 500) return bad(res, 'group is full');
    const ins = await q('insert into members(conv_id,user_id,joined_at) values($1,$2,now() - interval \'3 days\') on conflict do nothing returning user_id', [req.params.id, req.user.id]);
    if (ins.rows[0]) await sendToConv(req.params.id, { t: 'conv_update', convId: req.params.id, refresh: true }, req.user.id);
    res.json({ ...(await loadConversations(req.user.id, req.params.id)), convId: req.params.id });
  }));
  app.patch('/api/conversations/:id/about', auth, byUser('conv-edit', 20, 60_000), wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return bad(res, 'bad id');
    const m = await q('select m.role,c.is_public from members m join conversations c on c.id=m.conv_id where m.conv_id=$1 and m.user_id=$2', [req.params.id, req.user.id]);
    if (!m.rows[0] || m.rows[0].role !== 'admin' || !m.rows[0].is_public) return bad(res, 'hosts only', 403);
    const description = String(req.body.description || '').trim().slice(0, 160);
    if (safety.F.check(description)) return bad(res, 'keep the description clean');
    const topic = TOPICS.includes(req.body.topic) ? req.body.topic : 'other';
    await q('update conversations set description=$2,topic=$3 where id=$1', [req.params.id, description, topic]);
    await sendToConv(req.params.id, { t: 'conv_update', convId: req.params.id, refresh: true });
    res.json({ ok: true });
  }));
  app.delete('/api/admin/groups/:id', auth, adminOnly, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return bad(res, 'bad id');
    const mem = await q('select user_id from members where conv_id=$1', [req.params.id]);
    await q('delete from conversations where id=$1 and is_public and system_kind is null', [req.params.id]);
    for (const m of mem.rows) sendTo(m.user_id, { t: 'conv_removed', convId: req.params.id });
    res.json({ ok: true });
  }));

  // ---------- referrals + beta ----------
  app.get('/api/referral', auth, wrap(async (req, res) => res.json({ ...(await refInfo(q, req.user)), betaUntil: req.user.beta_until || null })));
  app.post('/api/admin/users/:id/beta', auth, adminOnly, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return bad(res, 'bad id');
    const mins = Math.min(Math.max(parseInt(req.body.minutes, 10) || 0, 0), 60 * 24 * 365);
    const r = await q(`update users set beta_until=${mins ? 'greatest(coalesce(beta_until,now()),now()) + make_interval(mins=>$2)' : 'null'} where id=$1 returning id`, mins ? [req.params.id, mins] : [req.params.id]);
    if (!r.rows[0]) return bad(res, 'not found', 404);
    if (ensureFor) await ensureFor((await q('select * from users where id=$1', [req.params.id])).rows[0]);
    sendTo(req.params.id, { t: 'me_update' });
    audit.bump(q, 'beta_grants');
    audit.log(q, req.user, mins ? 'beta_grant' : 'beta_clear', { id: req.params.id, username: (await q('select username from users where id=$1', [req.params.id])).rows[0]?.username }, { detail: mins ? mins + ' min' : '' });
    res.json({ ok: true });
  }));

  // ---------- themes (beta) ----------
  app.put('/api/me/theme', auth, betaOnly, byUser('theme', 30, 60_000), wrap(async (req, res) => {
    const b = req.body || {};
    const t = {
      accent: /^#[0-9a-f]{6}$/i.test(b.accent) ? b.accent.toLowerCase() : null,
      preset: PRESETS.includes(b.preset) ? b.preset : 'cocoa',
      round: ['sharp', 'soft', 'round'].includes(b.round) ? b.round : 'soft',
      size: ['small', 'normal', 'large'].includes(b.size) ? b.size : 'normal',
      font: ['serif', 'sans'].includes(b.font) ? b.font : 'serif',
    };
    await q('update users set theme=$2 where id=$1', [req.user.id, JSON.stringify(t)]);
    res.json({ theme: t });
  }));
  app.delete('/api/me/theme', auth, wrap(async (req, res) => { await q('update users set theme=null where id=$1', [req.user.id]); res.json({ ok: true }); }));

  // ---------- gifs (beta) ----------
  app.get('/api/gifs/status', auth, (req, res) => res.json({ search: !!GIF_KEY }));
  const gifList = (j) => {
    const items = (j && j.data && (Array.isArray(j.data.data) ? j.data.data : Array.isArray(j.data) ? j.data : [])) || [];
    const pick = (it, sizes, fmts) => {
      const f = it.file || it.files || {};
      for (const s of sizes) for (const fm of fmts) { const o = f[s] && f[s][fm]; if (o && o.url && hostOk(o.url)) return { url: o.url, w: o.width || null, h: o.height || null }; }
      return null;
    };
    return items.map((it) => {
      const full = pick(it, ['md', 'sm', 'hd', 'xs'], ['gif', 'webp']);
      const prev = pick(it, ['sm', 'xs', 'md'], ['gif', 'webp']) || full;
      return full ? { id: String(it.id || it.slug || full.url), title: String(it.title || '').slice(0, 80), url: full.url, w: full.w, h: full.h, preview: prev.url } : null;
    }).filter(Boolean);
  };
  const gifFetch = wrap(async (req, res) => {
    if (!GIF_KEY) return res.status(503).json({ error: 'gif_search_off', message: 'gif search is not set up yet, paste a link instead' });
    const term = String(req.query.q || '').trim().slice(0, 60);
    const page = Math.min(parseInt(req.query.page, 10) || 1, 20);
    const who = crypto.createHash('sha256').update(req.user.id).digest('hex').slice(0, 16);
    const url = `${GIF_BASE}/${encodeURIComponent(GIF_KEY)}/gifs/${term ? 'search' : 'trending'}?per_page=24&page=${page}&rating=pg-13&customer_id=${who}${term ? '&q=' + encodeURIComponent(term) : ''}`;
    try {
      const r = await tfetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) return res.status(502).json({ error: 'gif_upstream', message: 'gif service is not answering' });
      const j = await r.json();
      res.json({ gifs: gifList(j), hasNext: !!(j && j.data && j.data.has_next) });
    } catch { res.status(502).json({ error: 'gif_upstream', message: 'gif service is not answering' }); }
  });
  app.get('/api/gifs/search', auth, betaOnly, byUser('gif', 40, 60_000), gifFetch);
  app.get('/api/gifs/resolve', auth, betaOnly, byUser('gif-resolve', 20, 60_000), wrap(async (req, res) => {
    const raw = String(req.query.url || '').trim().slice(0, 400);
    if (!hostOk(raw)) return bad(res, 'that link is not from a supported gif site');
    if (/\.(gif|webp|png|jpe?g)(\?|$)/i.test(new URL(raw).pathname + new URL(raw).search)) return res.json({ url: raw });
    try {
      const r = await tfetch(raw, { headers: { 'User-Agent': 'Mozilla/5.0 chatroom-link-preview', Accept: 'text/html' } });
      if (!r.ok || !hostOk(r.url)) return bad(res, 'could not read that link');
      const html = (await r.text()).slice(0, 600_000);
      const m = html.match(/"contentUrl"\s*:\s*"([^"]+)"/) || html.match(/itemprop="contentUrl"[^>]*content="([^"]+)"/) || html.match(/property="og:image"[^>]*content="([^"]+)"/) || html.match(/name="twitter:image"[^>]*content="([^"]+)"/);
      const found = m && m[1].replace(/&amp;/g, '&').replace(/\\u002F/g, '/');
      if (!found || !hostOk(found)) return bad(res, 'could not find a gif in that link');
      res.json({ url: found });
    } catch { bad(res, 'could not read that link'); }
  }));

  // ---------- changes board ----------
  app.get('/api/changelog', (req, res) => {
    try { res.json({ entries: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'changelog.json'), 'utf8')) }); } catch { res.json({ entries: [] }); }
  });
}

module.exports = { mount, refInfo, creditReferral, pruneOldPlays, betaOn, TOPICS };

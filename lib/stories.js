const express = require('express');
const safety = require('./safety');
const drop = require('./drop');
const audit = require('./audit');

const TTL_MS = 24 * 3600_000;
const MAX_ACTIVE = 6;
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
let ctx = null;
let nudgeT = null;

function nudge() {
  if (nudgeT) return;
  nudgeT = setTimeout(() => {
    nudgeT = null;
    for (const id of ctx.sockets.keys()) ctx.sendTo(id, { t: 'stories_changed' });
  }, 1500);
}

async function init() {
  await ctx.q(`create table if not exists stories(
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    data bytea not null,
    caption text not null default '',
    created_at timestamptz not null default now(),
    expires_at timestamptz not null)`);
  await ctx.q('create index if not exists stories_user on stories(user_id, created_at)');
  await ctx.q('create index if not exists stories_exp on stories(expires_at)');
  await ctx.q(`create table if not exists story_views(
    story_id uuid not null references stories(id) on delete cascade,
    viewer_id uuid not null references users(id) on delete cascade,
    seen_at timestamptz not null default now(),
    primary key(story_id, viewer_id))`);
}

function mount(app, c) {
  ctx = c;
  const { q, auth, bad, wrap, byUser } = c;
  const big = express.json({ limit: '480kb' });
  const gate = (req, res, next) => next();
  const ready = init().catch((e) => console.warn('stories init', e.message));

  app.get('/api/stories', auth, gate, wrap(async (req, res) => {
    await ready;
    const r = await q(`select u.id, u.username, u.display_name, u.avatar, count(*)::int as n, max(s.created_at) as latest,
        bool_and(v.viewer_id is not null or s.user_id=$1) as seen
      from stories s join users u on u.id=s.user_id
      left join story_views v on v.story_id=s.id and v.viewer_id=$1
      where s.expires_at > now() and not u.banned
      group by u.id order by bool_and(v.viewer_id is not null or s.user_id=$1) asc, max(s.created_at) desc limit 200`, [req.user.id]);
    res.json({ users: r.rows.map((x) => ({ userId: x.id, username: x.username, displayName: x.display_name, avatar: x.avatar, count: x.n, latest: x.latest, seen: x.seen })) });
  }));

  app.get('/api/stories/user/:id', auth, gate, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return bad(res, 'bad id', 404);
    const mine = req.user.id === req.params.id;
    const r = await q(`select s.id, s.caption, s.created_at, s.expires_at, (v.viewer_id is not null) as seen,
        (select count(*)::int from story_views x where x.story_id=s.id) as views
      from stories s join users u on u.id=s.user_id left join story_views v on v.story_id=s.id and v.viewer_id=$2
      where s.user_id=$1 and s.expires_at > now() and not u.banned order by s.created_at asc`, [req.params.id, req.user.id]);
    res.json({ stories: r.rows.map((x) => ({ id: x.id, caption: x.caption, createdAt: x.created_at, expiresAt: x.expires_at, seen: mine || x.seen, views: mine || req.user.is_admin ? x.views : undefined })) });
  }));

  app.get('/api/stories/:id/img', wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return bad(res, 'bad id', 404);
    const r = await q('select data from stories where id=$1 and expires_at > now()', [req.params.id]);
    if (!r.rows[0]) return bad(res, 'gone', 404);
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'Cross-Origin-Resource-Policy': 'cross-origin' }).send(r.rows[0].data);
  }));

  app.post('/api/stories', auth, gate, big, byUser('story-post', 12, 3_600_000), wrap(async (req, res) => {
    await ready;
    if (!safety.verifiedOn(req.user)) return bad(res, 'verify your account to post a story', 403);
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String((req.body && req.body.image) || ''));
    if (!m) return bad(res, 'bad photo');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length < 500 || buf.length > 340_000 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return bad(res, 'that photo did not work, try again');
    const caption = String((req.body && req.body.caption) || '').trim().slice(0, 140);
    if (caption && safety.F.check(caption)) return bad(res, 'keep the caption clean');
    const n = (await q('select count(*)::int as n from stories where user_id=$1 and expires_at > now()', [req.user.id])).rows[0].n;
    if (n >= MAX_ACTIVE) return bad(res, `you already have ${MAX_ACTIVE} stories up, delete one first`);
    const r = await q('insert into stories(user_id,data,caption,expires_at) values($1,$2,$3,$4) returning id', [req.user.id, buf, caption, new Date(Date.now() + TTL_MS)]);
    nudge();
    res.json({ id: r.rows[0].id });
  }));

  app.post('/api/stories/:id/view', auth, gate, byUser('story-view', 400, 3_600_000), wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return bad(res, 'bad id', 404);
    await q(`insert into story_views(story_id,viewer_id) select s.id,$2 from stories s where s.id=$1 and s.user_id<>$2 and s.expires_at > now() on conflict do nothing`, [req.params.id, req.user.id]);
    res.json({ ok: true });
  }));

  app.get('/api/stories/:id/views', auth, gate, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return bad(res, 'bad id', 404);
    const s = (await q('select user_id from stories where id=$1', [req.params.id])).rows[0];
    if (!s) return bad(res, 'gone', 404);
    if (s.user_id !== req.user.id && !req.user.is_admin) return bad(res, 'forbidden', 403);
    const r = await q('select u.username, u.display_name, v.seen_at from story_views v join users u on u.id=v.viewer_id where v.story_id=$1 order by v.seen_at desc limit 100', [req.params.id]);
    res.json({ views: r.rows.map((x) => ({ username: x.username, displayName: x.display_name, at: x.seen_at })) });
  }));

  app.delete('/api/stories/:id', auth, gate, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return bad(res, 'bad id', 404);
    const s = (await q('select id,user_id from stories where id=$1', [req.params.id])).rows[0];
    if (!s) return res.json({ ok: true });
    if (s.user_id !== req.user.id && !req.user.is_admin) return bad(res, 'forbidden', 403);
    await q('delete from stories where id=$1', [s.id]);
    if (s.user_id !== req.user.id) audit.log(q, req.user, 'story_delete', { id: s.id, userId: s.user_id });
    nudge();
    res.json({ ok: true });
  }));
}

function start() {
  const t = setInterval(() => { ctx.q("delete from stories where expires_at < now() - interval '1 hour'").catch(() => {}); }, 600_000);
  if (t.unref) t.unref();
}

module.exports = { mount, start };

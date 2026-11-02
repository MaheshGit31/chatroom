const crypto = require('crypto');
const { WORDS } = require('./gamedata');
const safety = require('./safety');

const FRAMES = ['none', 'gold', 'neon', 'sunset', 'ocean', 'rose'];
const LINK_HOSTS = ['youtube.com', 'youtu.be', 'music.youtube.com', 'spotify.com', 'open.spotify.com', 'soundcloud.com', 'music.apple.com', 'tidal.com', 'deezer.com', 'bandcamp.com', 'twitch.tv', 'github.com', 'instagram.com', 'tiktok.com', 'x.com', 'twitter.com'];
const MAX_TRIES = 6;

const dayStr = (d = new Date()) => d.toISOString().slice(0, 10);

function init(ctx) {
  const { q, secret, games } = ctx;

  const wordFor = (day) => {
    const h = crypto.createHmac('sha256', String(secret())).update('daily|' + day).digest();
    return WORDS[h.readUInt32BE(0) % WORDS.length];
  };

  const score = (guess, answer) => {
    const out = Array(5).fill('x');
    const left = {};
    for (let i = 0; i < 5; i++) {
      if (guess[i] === answer[i]) out[i] = 'g';
      else left[answer[i]] = (left[answer[i]] || 0) + 1;
    }
    for (let i = 0; i < 5; i++) {
      if (out[i] === 'g') continue;
      if (left[guess[i]] > 0) { out[i] = 'y'; left[guess[i]]--; }
    }
    return out.join('');
  };

  async function streakOf(userId) {
    const r = await q(`select day::text d from daily_words where user_id=$1 and won order by day desc limit 400`, [userId]);
    const days = new Set(r.rows.map((x) => x.d));
    let cur = new Date();
    if (!days.has(dayStr(cur))) cur = new Date(Date.now() - 86400_000);
    let n = 0;
    while (days.has(dayStr(cur))) { n++; cur = new Date(cur.getTime() - 86400_000); }
    return n;
  }

  async function dailyState(userId) {
    const day = dayStr();
    const r = await q('select guesses,done,won from daily_words where day=$1 and user_id=$2', [day, userId]);
    const row = r.rows[0] || { guesses: [], done: false, won: false };
    const answer = wordFor(day);
    return {
      day,
      rows: row.guesses.map((g) => ({ word: g, fb: score(g, answer) })),
      done: row.done,
      won: row.won,
      answer: row.done ? answer : null,
      tries: MAX_TRIES,
      streak: await streakOf(userId),
    };
  }

  async function guess(userId, raw) {
    const w = String(raw || '').toLowerCase().trim();
    if (!/^[a-z]{5}$/.test(w)) return { error: 'five letters please' };
    const day = dayStr();
    await q('insert into daily_words(day,user_id) values($1,$2) on conflict do nothing', [day, userId]);
    const row = (await q('select guesses,done from daily_words where day=$1 and user_id=$2', [day, userId])).rows[0];
    if (row.done) return { error: 'you already finished today' };
    if (row.guesses.includes(w)) return { error: 'already tried that one' };
    const answer = wordFor(day);
    const list = [...row.guesses, w];
    const won = w === answer;
    const done = won || list.length >= MAX_TRIES;
    await q('update daily_words set guesses=$3, done=$4, won=$5, finished_at=case when $4 then now() else null end where day=$1 and user_id=$2 and not done', [day, userId, JSON.stringify(list), done, won]);
    return { ok: true };
  }

  async function dailyTop() {
    const r = await q(
      `select u.username,u.display_name,u.avatar,jsonb_array_length(d.guesses) tries
       from daily_words d join users u on u.id=d.user_id
       where d.day=$1 and d.won order by jsonb_array_length(d.guesses), d.finished_at limit 10`, [dayStr()]);
    return r.rows.map((x) => ({ username: x.username, displayName: x.display_name, avatar: x.avatar || null, tries: x.tries }));
  }

  async function board(kind) {
    if (kind === 'wins') {
      const r = await q(
        `select u.username,u.display_name,u.avatar,count(*)::int n from games2 g
         join users u on u.id = case g.winner when 'p1' then g.p1 when 'p2' then g.p2 end
         where g.winner in ('p1','p2') and g.created_at>now()-interval '30 days' and g.p1<>g.p2 and not u.is_bot
         group by 1,2,3 order by n desc limit 10`);
      return r.rows.map((x) => ({ username: x.username, displayName: x.display_name, avatar: x.avatar || null, value: x.n, label: x.n === 1 ? 'win' : 'wins' }));
    }
    if (kind === 'streak') {
      const r = await q(`select user_id, array_agg(day::text order by day desc) days from daily_words where won and day>current_date-120 group by 1`);
      const today = dayStr(), yest = dayStr(new Date(Date.now() - 86400_000));
      const out = [];
      for (const row of r.rows) {
        const set = new Set(row.days);
        let cur = set.has(today) ? new Date() : set.has(yest) ? new Date(Date.now() - 86400_000) : null;
        let n = 0;
        while (cur && set.has(dayStr(cur))) { n++; cur = new Date(cur.getTime() - 86400_000); }
        if (n) out.push({ id: row.user_id, n });
      }
      out.sort((a, b) => b.n - a.n);
      const top = out.slice(0, 10);
      if (!top.length) return [];
      const us = await q('select id,username,display_name,avatar from users where id=any($1)', [top.map((x) => x.id)]);
      const by = new Map(us.rows.map((u) => [u.id, u]));
      return top.map((x) => { const u = by.get(x.id); return { username: u.username, displayName: u.display_name, avatar: u.avatar || null, value: x.n, label: x.n === 1 ? 'day' : 'days' }; });
    }
    if (kind === 'reacts') {
      const r = await q(
        `select u.username,u.display_name,u.avatar,count(*)::int n from reactions r
         join messages m on m.id=r.msg_id join users u on u.id=m.sender_id
         where r.user_id<>m.sender_id and r.created_at>now()-interval '7 days' and not u.is_bot
         group by 1,2,3 order by n desc limit 10`);
      return r.rows.map((x) => ({ username: x.username, displayName: x.display_name, avatar: x.avatar || null, value: x.n, label: x.n === 1 ? 'reaction' : 'reactions' }));
    }
    if (kind === 'memes') {
      const r = await q(
        `select m.id,m.conv_id,m.sender_id,m.key_version,m.ciphertext,m.iv,m.created_at,c.name conv_name,u.username,u.display_name,u.avatar,count(*)::int n
         from reactions r join messages m on m.id=r.msg_id join conversations c on c.id=m.conv_id join users u on u.id=m.sender_id
         where not m.deleted and r.user_id<>m.sender_id and r.created_at>now()-interval '7 days' and m.created_at>now()-interval '7 days'
           and (c.is_public or c.system_kind='all') and c.system_kind is distinct from 'beta'
         group by m.id,c.name,u.username,u.display_name,u.avatar,c.id order by n desc limit 60`);
      const out = [];
      for (const m of r.rows) {
        const p = safety.decryptPublic(m.conv_id, m.sender_id, m.key_version, m.ciphertext, m.iv);
        if (!p || p.t !== 'meme' || safety.payloadDirty(p)) continue;
        out.push({ id: Number(m.id), convId: m.conv_id, convName: m.conv_name || 'everyone', username: m.username, displayName: m.display_name, avatar: m.avatar || null, votes: m.n, meme: { style: p.style, top: p.top, bottom: p.bottom, lines: p.lines } });
        if (out.length >= 5) break;
      }
      return out;
    }
    return null;
  }

  async function profileExtra(userId) {
    const r = await q('select profile_extra e from users where id=$1', [userId]);
    const e = r.rows[0] && r.rows[0].e;
    if (!e) return null;
    const out = { accent: e.accent || null, frame: e.frame || 'none', link: e.link || null, game: null, friends: [] };
    if (e.game && games.byId.has(e.game)) out.game = { path: e.game, title: games.byId.get(e.game).title };
    if (Array.isArray(e.friends) && e.friends.length) {
      const us = await q('select id,username,display_name,avatar from users where id=any($1)', [e.friends]);
      const by = new Map(us.rows.map((u) => [u.id, u]));
      out.friends = e.friends.map((id) => by.get(id)).filter(Boolean).map((u) => ({ username: u.username, displayName: u.display_name, avatar: u.avatar || null }));
    }
    return out;
  }

  function cleanLink(url, label) {
    if (!url) return { link: null };
    let u;
    try { u = new URL(String(url).trim()); } catch { return { error: 'that link is not valid' }; }
    if (u.protocol !== 'https:') return { error: 'links must start with https' };
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (!LINK_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return { error: 'allowed links: youtube, spotify, soundcloud, apple music, tidal, deezer, bandcamp, twitch, github, instagram, tiktok, x' };
    const text = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (text && safety.payloadDirty({ t: 'text', text })) return { error: 'keep the label clean' };
    return { link: { url: u.toString().slice(0, 300), label: text || host } };
  }

  function mount(app, c) {
    const { auth, byUser, bad, wrap, requireMember, sendToConv, betaOn } = c;

    app.get('/api/daily', auth, byUser('daily-read', 60, 60_000), wrap(async (req, res) => res.json(await dailyState(req.user.id))));
    app.post('/api/daily/guess', auth, byUser('daily-guess', 40, 60_000), wrap(async (req, res) => {
      const r = await guess(req.user.id, req.body.word);
      if (r.error) return bad(res, r.error);
      res.json(await dailyState(req.user.id));
    }));
    app.get('/api/daily/top', auth, byUser('daily-top', 30, 60_000), wrap(async (req, res) => res.json({ top: await dailyTop() })));

    app.get('/api/boards/:kind', auth, byUser('boards', 40, 60_000), wrap(async (req, res) => {
      const rows = await board(req.params.kind);
      if (!rows) return bad(res, 'unknown board', 404);
      res.json({ kind: req.params.kind, rows });
    }));

    app.put('/api/conversations/:id/game', auth, byUser('conv-game', 20, 60_000), wrap(async (req, res) => {
      const m = await requireMember(req, res);
      if (!m) return;
      if ((m.is_public || m.system_kind) && m.role !== 'admin' && !req.user.is_admin) return bad(res, 'only admins can pin a game in a public room', 403);
      const path = req.body.path ? String(req.body.path) : null;
      if (path && !games.byId.has(path)) return bad(res, 'unknown game', 404);
      await q('update conversations set game_path=$2, game_title=$3 where id=$1', [req.params.id, path, path ? games.byId.get(path).title : null]);
      await sendToConv(req.params.id, { t: 'conv_update', convId: req.params.id, refresh: true });
      res.json({ ok: true });
    }));

    app.get('/api/me/profile-extra', auth, byUser('pex-read', 30, 60_000), wrap(async (req, res) => {
      const r = await q('select profile_extra e from users where id=$1', [req.user.id]);
      const e = r.rows[0] && r.rows[0].e || {};
      const friends = e.friends && e.friends.length ? (await q('select username from users where id=any($1)', [e.friends])).rows.map((x) => x.username) : [];
      res.json({ accent: e.accent || '', frame: e.frame || 'none', link: e.link || null, game: e.game || null, friends, frames: FRAMES, beta: betaOn(req.user) });
    }));

    app.put('/api/me/profile-extra', auth, byUser('pex-write', 20, 60_000), wrap(async (req, res) => {
      if (!betaOn(req.user)) return res.status(403).json({ error: 'beta_required', message: 'profile glow-ups are for beta' });
      const b = req.body || {};
      const out = {};
      if (b.accent) {
        if (!/^#[0-9a-fA-F]{6}$/.test(String(b.accent))) return bad(res, 'pick a valid color');
        out.accent = String(b.accent).toLowerCase();
      }
      out.frame = FRAMES.includes(b.frame) ? b.frame : 'none';
      if (b.game) {
        if (!games.byId.has(String(b.game))) return bad(res, 'unknown game');
        out.game = String(b.game);
      }
      const l = cleanLink(b.linkUrl, b.linkLabel);
      if (l.error) return bad(res, l.error);
      if (l.link) out.link = l.link;
      const names = Array.isArray(b.friends) ? b.friends.map((x) => String(x).toLowerCase()).slice(0, 3) : [];
      if (names.length) {
        const r = await q(
          `select distinct u.id,u.username from users u join members a on a.user_id=u.id join conversations c on c.id=a.conv_id and c.type='dm'
           join members b on b.conv_id=c.id and b.user_id=$1 where u.username=any($2) and u.id<>$1`, [req.user.id, names]);
        const by = new Map(r.rows.map((x) => [x.username, x.id]));
        const missing = names.filter((n) => !by.has(n));
        if (missing.length) return bad(res, 'you need a dm with ' + missing.join(', ') + ' first');
        out.friends = names.map((n) => by.get(n));
      }
      await q('update users set profile_extra=$2 where id=$1', [req.user.id, JSON.stringify(out)]);
      res.json({ ok: true });
    }));
  }

  return { mount, profileExtra, streakOf };
}

module.exports = { init };

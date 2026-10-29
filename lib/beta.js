// lib/beta.js - beta-only extras: message edits, scheduled messages, polls, mini games, disappearing timers, folders, profile banners, stickers
const safety = require('./safety');                          // word filter, beta rule
const { WORDS, TRIVIA } = require('./gamedata');            // word duel words and trivia questions
const betaOn = safety.betaOn;                                // beta needs a verified account (admins always have it)

const PRICE_CENTS = parseInt(process.env.BETA_PRICE_CENTS, 10) || 50;   // beta costs this per week, paid by talking to an admin
const TTLS = [300, 3600, 28800, 86400];                      // disappearing timers a chat can pick (seconds), anything shorter than the 2 day default
const b64re = /^[A-Za-z0-9+/=_-]+$/;
const isB64 = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max && b64re.test(s);
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const IMG_HOSTS = ['imgur.com', 'discordapp.com', 'discordapp.net', 'discord.com', 'giphy.com', 'tenor.com', 'klipy.com', 'githubusercontent.com', 'wikimedia.org', 'redd.it', 'twimg.com', 'cloudinary.com', 'postimg.cc', 'ibb.co'];

// an image link is https, a normal host (not an ip or localhost) and either ends in an image extension or is on a known image host
function imgUrlOk(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || raw.length > 400 || !/\./.test(u.hostname) || /^[\d.]+$/.test(u.hostname) || u.hostname.endsWith('.local') || u.username || u.password) return false;
    // google image thumbnails, cdn links and signed urls often have no extension, so any normal https host is fine.
    // it is only ever shown inside an <img>, and the client already checks it loads before saving
    return true;
  } catch { return false; }
}
const cropOf = (c) => { const n = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d); c = c || {}; return { x: n(c.x, 0, 100, 50), y: n(c.y, 0, 100, 50), z: n(c.z, 1, 4, 1) }; };

function mount(app, c) {
  const { q, pool, auth, adminOnly, byUser, bad, wrap, sendTo, sendToConv, notify, isUuid, requireMember, isBlockedEitherWay } = c;
  const betaOnly = (req, res, next) => (betaOn(req.user) ? next() : res.status(403).json({ error: 'beta_required', message: 'that is a beta feature' }));
  const msgOf = async (id, uid) => (await q(`select m.id,m.conv_id,m.sender_id,m.deleted,m.key_version,c.is_public,c.type,c.key_version ckv from messages m join conversations c on c.id=m.conv_id join members mem on mem.conv_id=m.conv_id and mem.user_id=$2 where m.id=$1`, [id, uid])).rows[0];

  // ---------- beta tab info: price and who to talk to ----------
  app.get('/api/beta/info', auth, wrap(async (req, res) => {
    const ad = await q('select username,display_name from users where is_admin and not banned order by created_at limit 4');
    res.json({ priceCents: PRICE_CENTS, per: 'week', admins: ad.rows.map((a) => ({ username: a.username, displayName: a.display_name })) });
  }));

  // ---------- edit your own message ----------
  app.patch('/api/messages/:id', auth, betaOnly, byUser('msg-edit', 30, 60_000), wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0, { ciphertext, iv, keyVersion } = req.body || {};
    if (!isB64(ciphertext, 16000) || !isB64(iv, 40)) return bad(res, 'bad message');
    const m = await msgOf(id, req.user.id);
    if (!m || m.deleted) return bad(res, 'not found', 404);
    if (m.sender_id !== req.user.id) return bad(res, 'you can only edit your own messages', 403);
    if (keyVersion !== m.ckv || m.key_version !== m.ckv) return res.status(409).json({ error: 'key_version_stale', message: 'that message is from before the last key change and cannot be edited' });
    if (m.is_public) {                                       // public rooms are readable by the server, so edits are filtered too
      const p = safety.decryptPublic(m.conv_id, req.user.id, keyVersion, ciphertext, iv);
      if (!p) return bad(res, 'could not read that message');
      if (safety.payloadDirty(p)) return res.status(400).json({ error: 'blocked_word', message: 'keep it clean' });
    }
    const r = await q('update messages set ciphertext=$2,iv=$3,edited_at=now() where id=$1 returning edited_at', [id, ciphertext, iv]);
    await sendToConv(m.conv_id, { t: 'msg_edit', convId: m.conv_id, msgId: id, ciphertext, iv, keyVersion, editedAt: r.rows[0].edited_at });
    res.json({ ok: true, editedAt: r.rows[0].edited_at });
  }));

  // ---------- scheduled messages ----------
  app.post('/api/scheduled', auth, betaOnly, byUser('sched', 20, 60_000), wrap(async (req, res) => {
    const b = req.body || {};
    if (!isUuid(b.convId) || !isB64(b.ciphertext, 16000) || !isB64(b.iv, 40)) return bad(res, 'bad message');
    const at = new Date(b.sendAt);
    if (!(at.getTime() > Date.now() + 20_000) || at.getTime() > Date.now() + 7 * 864e5) return bad(res, 'pick a time between now and 7 days from now');
    const mem = await q('select c.key_version,c.is_public,c.type,c.system_kind from members m join conversations c on c.id=m.conv_id where m.conv_id=$1 and m.user_id=$2', [b.convId, req.user.id]);
    if (!mem.rows[0]) return bad(res, 'not a member', 403);
    if (b.keyVersion !== mem.rows[0].key_version) return res.status(409).json({ error: 'key_version_stale' });
    const n = await q('select count(*)::int c from scheduled where sender_id=$1', [req.user.id]);
    if (n.rows[0].c >= 10) return bad(res, 'you can have 10 scheduled messages at a time');
    if (mem.rows[0].is_public) {
      const p = safety.decryptPublic(b.convId, req.user.id, b.keyVersion, b.ciphertext, b.iv);
      if (!p || safety.payloadDirty(p)) return res.status(400).json({ error: 'blocked_word', message: 'keep it clean' });
    }
    const r = await q('insert into scheduled(conv_id,sender_id,ciphertext,iv,key_version,send_at) values($1,$2,$3,$4,$5,$6) returning id', [b.convId, req.user.id, b.ciphertext, b.iv, b.keyVersion, at]);
    res.json({ id: Number(r.rows[0].id), sendAt: at.toISOString() });
  }));
  app.get('/api/scheduled', auth, wrap(async (req, res) => {
    const r = await q('select id,conv_id "convId",ciphertext,iv,key_version "keyVersion",send_at "sendAt" from scheduled where sender_id=$1 order by send_at', [req.user.id]);
    res.json({ items: r.rows.map((x) => ({ ...x, id: Number(x.id) })) });
  }));
  app.delete('/api/scheduled/:id', auth, wrap(async (req, res) => {
    await q('delete from scheduled where id=$1 and sender_id=$2', [parseInt(req.params.id, 10) || 0, req.user.id]);
    res.json({ ok: true });
  }));

  // ---------- polls (max 10 options) ----------
  const pollCounts = async (msgId, n) => {
    const r = await q('select opt,count(*)::int c from poll_votes where msg_id=$1 group by opt', [msgId]);
    const counts = Array(n).fill(0); for (const x of r.rows) if (x.opt >= 0 && x.opt < n) counts[x.opt] = x.c; return counts;
  };
  app.post('/api/messages/:id/poll', auth, betaOnly, byUser('poll-make', 20, 3_600_000), wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0, n = parseInt(req.body.n, 10) || 0;
    if (n < 2 || n > 10) return bad(res, 'a poll needs 2 to 10 options');
    const m = await msgOf(id, req.user.id);
    if (!m || m.deleted || m.sender_id !== req.user.id) return bad(res, 'not found', 404);
    await q('insert into polls(msg_id,conv_id,n) values($1,$2,$3) on conflict do nothing', [id, m.conv_id, n]);
    await sendToConv(m.conv_id, { t: 'extra', convId: m.conv_id, msgId: id, kind: 'poll', n, counts: Array(n).fill(0) });
    res.json({ ok: true });
  }));
  app.post('/api/messages/:id/vote', auth, byUser('vote', 60, 60_000), wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0, opt = parseInt(req.body.opt, 10);
    const p = (await q('select p.n,p.conv_id from polls p join members mem on mem.conv_id=p.conv_id and mem.user_id=$2 where p.msg_id=$1', [id, req.user.id])).rows[0];
    if (!p) return bad(res, 'not found', 404);
    if (opt === -1) await q('delete from poll_votes where msg_id=$1 and user_id=$2', [id, req.user.id]);
    else if (opt >= 0 && opt < p.n) await q('insert into poll_votes(msg_id,user_id,opt) values($1,$2,$3) on conflict(msg_id,user_id) do update set opt=$3', [id, req.user.id, opt]);
    else return bad(res, 'bad option');
    const counts = await pollCounts(id, p.n);
    await sendToConv(p.conv_id, { t: 'extra', convId: p.conv_id, msgId: id, kind: 'poll', n: p.n, counts }, req.user.id);
    res.json({ counts, mine: opt });
  }));

  // ---------- mini games inside a dm: tic-tac-toe and rock paper scissors ----------
  const newState = (kind) => {
    if (kind === 'ttt') return { board: Array(9).fill('') };
    if (kind === 'c4') return { board: Array(42).fill('') };
    if (kind === 'wd') return { word: WORDS[Math.floor(Math.random() * WORDS.length)], g1: [], g2: [] };
    if (kind === 'tr') { const idx = TRIVIA.map((_, i) => i); for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; } return { qs: idx.slice(0, 5), a1: [], a2: [] }; }
    return { c1: null, c2: null };
  };
  const wordFb = (guess, word) => {                          // g = right spot, y = wrong spot, x = not in the word
    const fb = Array(5).fill('x'), left = {};
    for (let i = 0; i < 5; i++) { if (guess[i] === word[i]) fb[i] = 'g'; else left[word[i]] = (left[word[i]] || 0) + 1; }
    for (let i = 0; i < 5; i++) if (fb[i] === 'x' && left[guess[i]] > 0) { fb[i] = 'y'; left[guess[i]]--; }
    return fb.join('');
  };
  const c4Win = (b, r, c, me) => {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      let n = 1;
      for (const sgn of [1, -1]) for (let k = 1; k < 4; k++) { const rr = r + dr * k * sgn, cc = c + dc * k * sgn; if (rr < 0 || rr > 5 || cc < 0 || cc > 6 || b[rr * 7 + cc] !== me) break; n++; }
      if (n >= 4) return true;
    }
    return false;
  };
  const gameView = (g, uid) => {
    const base = { kind: g.kind, p1: g.p1, p2: g.p2, turn: g.turn, winner: g.winner };
    if (g.kind === 'ttt' || g.kind === 'c4') return { ...base, board: g.state.board };
    if (g.kind === 'wd') {
      const me1 = uid === g.p1, mine = me1 ? g.state.g1 : g.state.g2, theirs = me1 ? g.state.g2 : g.state.g1;
      return { ...base, mine: mine.map((x) => ({ w: x.w, fb: x.fb })), theirs: theirs.map((x) => x.fb), word: g.winner ? g.state.word : null };
    }
    if (g.kind === 'tr') {
      const me1 = uid === g.p1, mine = me1 ? g.state.a1 : g.state.a2, theirs = me1 ? g.state.a2 : g.state.a1;
      const score = (a) => a.reduce((n, c, i) => n + (TRIVIA[g.state.qs[i]][2] === c ? 1 : 0), 0);
      const qi = mine.length, q = qi < g.state.qs.length ? TRIVIA[g.state.qs[qi]] : null;
      return { ...base, total: g.state.qs.length, qi, q: q ? { t: q[0], o: q[1] } : null, myScore: score(mine), theirDone: theirs.length, theirScore: g.winner ? score(theirs) : null, lastRight: qi ? TRIVIA[g.state.qs[qi - 1]][2] === mine[qi - 1] : null };
    }
    const mine = uid === g.p1 ? g.state.c1 : g.state.c2, theirs = uid === g.p1 ? g.state.c2 : g.state.c1;
    return { ...base, mine: mine || null, theirChosen: !!theirs, theirs: g.winner ? theirs : null };   // the other choice stays hidden until both have picked
  };
  const pushGame = (g) => { sendTo(g.p1, { t: 'extra', convId: g.conv_id, msgId: Number(g.msg_id), kind: 'game', view: gameView(g, g.p1) }); sendTo(g.p2, { t: 'extra', convId: g.conv_id, msgId: Number(g.msg_id), kind: 'game', view: gameView(g, g.p2) }); };
  app.post('/api/messages/:id/game', auth, betaOnly, byUser('game-make', 20, 3_600_000), wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0, kind = req.body.kind;
    if (!['ttt', 'rps', 'c4', 'wd', 'tr'].includes(kind)) return bad(res, 'unknown game');
    const m = await msgOf(id, req.user.id);
    if (!m || m.deleted || m.sender_id !== req.user.id || m.type !== 'dm') return bad(res, 'games only work in a 1 on 1 chat', 404);
    const other = (await q('select user_id from members where conv_id=$1 and user_id<>$2', [m.conv_id, req.user.id])).rows[0];
    if (!other) return bad(res, 'not found', 404);
    if (await isBlockedEitherWay(req.user.id, other.user_id)) return bad(res, 'blocked', 403);
    const state = newState(kind);
    const ins = await q('insert into games2(msg_id,conv_id,kind,p1,p2,state,turn) values($1,$2,$3,$4,$5,$6,$4) on conflict do nothing returning *', [id, m.conv_id, kind, req.user.id, other.user_id, JSON.stringify(state)]);
    if (ins.rows[0]) pushGame(ins.rows[0]);
    res.json({ ok: true });
  }));
  app.post('/api/messages/:id/move', auth, byUser('game-move', 90, 60_000), wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const client = await pool.connect();
    let g;
    try {
      await client.query('begin');
      g = (await client.query('select * from games2 where msg_id=$1 for update', [id])).rows[0];
      if (!g || ![g.p1, g.p2].includes(req.user.id)) { await client.query('rollback'); return bad(res, 'not found', 404); }
      if (g.winner) { await client.query('rollback'); return bad(res, 'that game is over'); }
      const st = g.state, me1 = req.user.id === g.p1;
      if (g.kind === 'ttt') {
        const cell = parseInt(req.body.cell, 10);
        if (g.turn !== req.user.id) { await client.query('rollback'); return bad(res, 'not your turn'); }
        if (!(cell >= 0 && cell < 9) || st.board[cell]) { await client.query('rollback'); return bad(res, 'that square is taken'); }
        st.board[cell] = me1 ? 'X' : 'O';
        const win = LINES.find((l) => st.board[l[0]] && st.board[l[0]] === st.board[l[1]] && st.board[l[1]] === st.board[l[2]]);
        g.winner = win ? (st.board[win[0]] === 'X' ? 'p1' : 'p2') : st.board.every(Boolean) ? 'draw' : null;
        g.turn = me1 ? g.p2 : g.p1;
      } else if (g.kind === 'c4') {
        const col = parseInt(req.body.col, 10);
        if (g.turn !== req.user.id) { await client.query('rollback'); return bad(res, 'not your turn'); }
        if (!(col >= 0 && col < 7) || st.board[col]) { await client.query('rollback'); return bad(res, 'that column is full'); }
        let row = 5; while (st.board[row * 7 + col]) row--;
        const me = me1 ? 'X' : 'O'; st.board[row * 7 + col] = me; st.last = row * 7 + col;
        g.winner = c4Win(st.board, row, col, me) ? (me1 ? 'p1' : 'p2') : st.board.every(Boolean) ? 'draw' : null;
        g.turn = me1 ? g.p2 : g.p1;
      } else if (g.kind === 'wd') {
        const w = String(req.body.word || '').toLowerCase();
        const mine = me1 ? st.g1 : st.g2, theirs = me1 ? st.g2 : st.g1;
        if (!/^[a-z]{5}$/.test(w)) { await client.query('rollback'); return bad(res, 'type a 5 letter word'); }
        if (mine.length >= 6 || (mine.length && mine[mine.length - 1].w === st.word)) { await client.query('rollback'); return bad(res, 'you are done'); }
        mine.push({ w, fb: wordFb(w, st.word) });
        if (w === st.word) g.winner = me1 ? 'p1' : 'p2';
        else if (st.g1.length >= 6 && st.g2.length >= 6) g.winner = 'draw';
      } else if (g.kind === 'tr') {
        const ch = parseInt(req.body.choice, 10), mine = me1 ? st.a1 : st.a2;
        if (!(ch >= 0 && ch < 4)) { await client.query('rollback'); return bad(res, 'pick an answer'); }
        if (mine.length >= st.qs.length) { await client.query('rollback'); return bad(res, 'you are done'); }
        mine.push(ch);
        if (st.a1.length >= st.qs.length && st.a2.length >= st.qs.length) {
          const sc = (a) => a.reduce((n, c, i) => n + (TRIVIA[st.qs[i]][2] === c ? 1 : 0), 0);
          const s1 = sc(st.a1), s2 = sc(st.a2); g.winner = s1 === s2 ? 'draw' : s1 > s2 ? 'p1' : 'p2';
        }
      } else {
        const ch = req.body.choice;
        if (!['rock', 'paper', 'scissors'].includes(ch)) { await client.query('rollback'); return bad(res, 'pick rock, paper or scissors'); }
        const key = me1 ? 'c1' : 'c2';
        if (st[key]) { await client.query('rollback'); return bad(res, 'you already picked'); }
        st[key] = ch;
        if (st.c1 && st.c2) { const beats = { rock: 'scissors', paper: 'rock', scissors: 'paper' }; g.winner = st.c1 === st.c2 ? 'draw' : beats[st.c1] === st.c2 ? 'p1' : 'p2'; }
      }
      await client.query('update games2 set state=$2,turn=$3,winner=$4 where msg_id=$1', [id, JSON.stringify(st), g.turn, g.winner]);
      await client.query('commit');
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
    pushGame(g);
    res.json({ view: gameView(g, req.user.id) });
  }));

  // polls and games for a chat, fetched when it opens
  app.get('/api/conversations/:id/extras', auth, byUser('extras', 120, 60_000), wrap(async (req, res) => {
    const m = await requireMember(req, res); if (!m) return;
    const polls = {}, games = {};
    for (const p of (await q('select p.msg_id,p.n,(select opt from poll_votes where msg_id=p.msg_id and user_id=$2) mine from polls p where p.conv_id=$1', [req.params.id, req.user.id])).rows)
      polls[Number(p.msg_id)] = { n: p.n, counts: await pollCounts(p.msg_id, p.n), mine: p.mine === null ? -1 : p.mine };
    for (const g of (await q('select * from games2 where conv_id=$1', [req.params.id])).rows) games[Number(g.msg_id)] = gameView(g, req.user.id);
    res.json({ polls, games });
  }));

  // ---------- disappearing messages: a shorter timer for one chat ----------
  app.put('/api/conversations/:id/ttl', auth, betaOnly, byUser('ttl', 20, 60_000), wrap(async (req, res) => {
    const m = await requireMember(req, res); if (!m) return;
    if (m.system_kind) return bad(res, 'the built in rooms keep the normal timer', 403);
    if (m.type === 'group' && m.role !== 'admin') return bad(res, 'hosts only', 403);
    const s = req.body.seconds === null ? null : parseInt(req.body.seconds, 10);
    if (s !== null && !TTLS.includes(s)) return bad(res, 'pick one of the timers');
    await q('update conversations set ttl_seconds=$2 where id=$1', [req.params.id, s]);
    await sendToConv(req.params.id, { t: 'conv_update', convId: req.params.id, refresh: true });
    res.json({ ok: true, seconds: s });
  }));

  // ---------- chat folders ----------
  app.put('/api/me/folders', auth, byUser('folders', 30, 60_000), wrap(async (req, res) => {
    const list = Array.isArray(req.body.folders) ? req.body.folders : null;
    if (!list || list.length > 20) return bad(res, "up to 20 folders");
    if (list.length && !betaOn(req.user)) return res.status(403).json({ error: 'beta_required', message: 'folders are a beta feature' });
    const out = [];
    for (const f of list) {
      const name = String((f && f.name) || '').trim().slice(0, 16);
      if (!name || safety.F.check(name)) return bad(res, 'give each folder a clean name');
      out.push({ id: String((f && f.id) || Math.random().toString(36).slice(2, 8)).replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'f' + out.length, name, convIds: (Array.isArray(f.convIds) ? f.convIds : []).filter(isUuid).slice(0, 200) });
    }
    await q('update users set folders=$2 where id=$1', [req.user.id, JSON.stringify(out)]);
    res.json({ folders: out });
  }));

  // ---------- profile bio + banner (gradients live only here) ----------
  app.put('/api/me/profile', auth, betaOnly, byUser('profile', 20, 60_000), wrap(async (req, res) => {
    const bio = String(req.body.bio || '').trim().slice(0, 160);
    if (safety.F.check(bio)) return bad(res, 'keep your bio clean');
    const banner = req.body.banner == null ? null : String(req.body.banner);
    if (banner !== null && !/^#[0-9a-f]{6}(,#[0-9a-f]{6})?$/i.test(banner)) return bad(res, 'bad banner');
    await q('update users set bio=$2,banner=$3 where id=$1', [req.user.id, bio, banner]);
    res.json({ bio, banner });
  }));

  // ---------- stickers: image links only, with a square crop ----------
  app.get('/api/stickers', auth, wrap(async (req, res) => {
    const r = await q('select id,name,url,crop from stickers where user_id=$1 order by id', [req.user.id]);
    res.json({ stickers: r.rows.map((s) => ({ id: Number(s.id), name: s.name, url: s.url, crop: cropOf(s.crop) })) });
  }));
  app.post('/api/stickers', auth, betaOnly, byUser('sticker-add', 30, 3_600_000), wrap(async (req, res) => {
    const name = String(req.body.name || '').toLowerCase().trim(), url = String(req.body.url || '').trim();
    if (!/^[a-z0-9_]{1,16}$/.test(name) || safety.F.check(name.replace(/_/g, ' '))) return bad(res, 'name it with 1 to 16 letters, numbers or _');
    if (!imgUrlOk(url)) return bad(res, 'that does not look like an https image link');
    const n = await q('select count(*)::int c from stickers where user_id=$1', [req.user.id]);
    if (n.rows[0].c >= 30) return bad(res, 'you can keep 30 stickers');
    const r = await q('insert into stickers(user_id,name,url,crop) values($1,$2,$3,$4) returning id', [req.user.id, name, url, JSON.stringify(cropOf(req.body.crop))]);
    res.json({ sticker: { id: Number(r.rows[0].id), name, url, crop: cropOf(req.body.crop) } });
  }));
  app.patch('/api/stickers/:id', auth, betaOnly, byUser('sticker-edit', 60, 60_000), wrap(async (req, res) => {
    const crop = cropOf(req.body.crop);
    const r = await q('update stickers set crop=$3 where id=$1 and user_id=$2 returning id', [parseInt(req.params.id, 10) || 0, req.user.id, JSON.stringify(crop)]);
    if (!r.rows[0]) return bad(res, 'not found', 404);
    res.json({ crop });
  }));
  app.delete('/api/stickers/:id', auth, wrap(async (req, res) => {
    await q('delete from stickers where id=$1 and user_id=$2', [parseInt(req.params.id, 10) || 0, req.user.id]);
    res.json({ ok: true });
  }));
}

// chats with a short disappearing timer lose old messages (pinned ones stay)
async function sweepShort(q) {
  await q(`delete from messages m using conversations c where c.id=m.conv_id and c.ttl_seconds is not null and m.created_at < now() - make_interval(secs=>c.ttl_seconds) and m.id not in (select msg_id from pins)`);
}

// background loop: send scheduled messages that are due, clear short-timer chats
function start(ctx) {
  const { q, sendTo, notify, pushTo, sockets, isBlockedEitherWay } = ctx;
  async function sendDue() {
    const due = (await q('delete from scheduled where send_at<=now() returning *')).rows;   // claiming the rows first means nothing sends twice
    for (const s of due) {
      try {
        const cv = (await q('select c.key_version,c.is_public,c.type,(m.muted_until>now() or coalesce(u.muted_until>now(),false) or u.banned) as silenced from members m join conversations c on c.id=m.conv_id join users u on u.id=m.user_id where m.conv_id=$1 and m.user_id=$2', [s.conv_id, s.sender_id])).rows[0];
        let ok = !!cv && cv.key_version === s.key_version && !cv.silenced;
        if (ok && cv.type === 'dm') { const o = (await q('select user_id from members where conv_id=$1 and user_id<>$2', [s.conv_id, s.sender_id])).rows[0]; if (o && await isBlockedEitherWay(s.sender_id, o.user_id)) ok = false; }
        if (ok && cv.is_public) { const p = safety.decryptPublic(s.conv_id, s.sender_id, s.key_version, s.ciphertext, s.iv); if (!p || safety.payloadDirty(p)) ok = false; }
        if (!ok) { notify(s.sender_id, 'sched_failed', {}).catch(() => {}); continue; }
        const r = await q('insert into messages(conv_id,sender_id,ciphertext,iv,key_version) values($1,$2,$3,$4,$5) returning id,created_at', [s.conv_id, s.sender_id, s.ciphertext, s.iv, s.key_version]);
        const message = { id: Number(r.rows[0].id), senderId: s.sender_id, ciphertext: s.ciphertext, iv: s.iv, keyVersion: s.key_version, createdAt: r.rows[0].created_at, deleted: false };
        q('update users set msg_count=msg_count+1 where id=$1', [s.sender_id]).then(() => safety.badgeCheck(q, s.sender_id)).catch(() => {});
        for (const mm of (await q('select user_id,muted from members where conv_id=$1', [s.conv_id])).rows) {
          sendTo(mm.user_id, { t: 'msg', convId: s.conv_id, message, cid: null, muted: mm.muted });
          if (!cv.is_public && mm.user_id !== s.sender_id && !mm.muted && !sockets.has(mm.user_id)) pushTo(mm.user_id, s.conv_id).catch(() => {});
        }
      } catch (e) { console.warn('scheduled send failed', e.message); }
    }
  }
  setInterval(() => { sendDue().catch((e) => console.warn('sched', e.message)); sweepShort(q).catch(() => {}); }, 15_000).unref();
}

module.exports = { mount, start, sweepShort, PRICE_CENTS, imgUrlOk };

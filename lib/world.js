const { TRIVIA } = require('./gamedata');

const W = 1000, H = 600;
const EMOTES = new Set(['wave', 'heart', 'laugh', 'fire', 'gg', 'sad']);
const COIN_MAX = 8, COIN_EVERY = 3000, COIN_LIFE = 25_000, ROUND_MS = 300_000;
const Q_MS = 12_000, REVEAL_MS = 4000, TRIVIA_Q = 6, TRIVIA_COOLDOWN = 120_000;

function init(c) {
  const { q, sendTo, F, limiter } = c;
  const worlds = new Map();
  const where = new Map();

  const rnd = (n) => Math.floor(Math.random() * n);
  const bc = (w, evt, except) => { for (const id of w.players.keys()) if (id !== except) sendTo(id, evt); };
  const top = (m, n, w) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id, s]) => ({ id, name: (w.players.get(id) || w.gone.get(id) || {}).name || 'someone', score: s }));

  function make(convId, name) {
    const w = { convId, name, players: new Map(), gone: new Map(), coins: [], coinId: 1, lastCoin: 0, scores: new Map(), roundEnds: Date.now() + ROUND_MS, trivia: null, triviaEnded: 0, dirty: new Set() };
    worlds.set(convId, w);
    return w;
  }

  const snapshot = (w) => ({
    t: 'world_state', convId: w.convId, name: w.name, w: W, h: H,
    players: [...w.players.values()].map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, score: w.scores.get(p.id) || 0 })),
    coins: w.coins.map((k) => ({ id: k.id, x: k.x, y: k.y })),
    roundEnds: w.roundEnds,
    trivia: w.trivia ? triviaView(w) : null,
  });

  const triviaView = (w) => {
    const t = w.trivia, qq = TRIVIA[t.qs[t.i]];
    return { phase: t.phase, i: t.i, total: t.qs.length, q: qq[0], o: qq[1], ends: t.ends, a: t.phase === 'reveal' ? qq[2] : undefined, top: top(t.scores, 5, w) };
  };

  function nextQuestion(w) {
    const t = w.trivia; if (!t) return;
    t.phase = 'q'; t.ends = Date.now() + Q_MS; t.answers = new Map();
    bc(w, { t: 'world_trivia', ...triviaView(w) });
    t.timer = setTimeout(() => reveal(w), Q_MS);
  }
  function reveal(w) {
    const t = w.trivia; if (!t) return;
    t.phase = 'reveal'; t.ends = Date.now() + REVEAL_MS;
    bc(w, { t: 'world_trivia', ...triviaView(w) });
    t.timer = setTimeout(() => {
      t.i++;
      if (t.i >= t.qs.length) {
        const res = top(t.scores, 5, w);
        bc(w, { t: 'world_trivia', phase: 'end', top: res });
        for (const [id, s] of t.scores) w.scores.set(id, (w.scores.get(id) || 0) + Math.round(s / 20));
        w.trivia = null; w.triviaEnded = Date.now();
      } else nextQuestion(w);
    }, REVEAL_MS);
  }

  async function join(ws, m) {
    const uid = ws.userId;
    if (typeof m.convId !== 'string') return;
    const r = (await q(`select c.name,c.is_public,u.username,u.display_name,u.muted_until from members mm join conversations c on c.id=mm.conv_id join users u on u.id=mm.user_id where mm.conv_id=$1 and mm.user_id=$2`, [m.convId, uid])).rows[0];
    if (!r || !r.is_public) return sendTo(uid, { t: 'world_error', message: 'the hangout world is only in public rooms' });
    leave(uid);
    const w = worlds.get(m.convId) || make(m.convId, r.name);
    const p = { id: uid, name: r.display_name || r.username, x: W / 2 + rnd(120) - 60, y: H / 2 + rnd(80) - 40, say: '', lastSay: 0, muted: !!(r.muted_until && new Date(r.muted_until) > new Date()), at: Date.now() };
    w.players.set(uid, p); where.set(uid, m.convId);
    sendTo(uid, snapshot(w));
    bc(w, { t: 'world_join', id: uid, name: p.name, x: p.x, y: p.y }, uid);
  }

  function leave(uid) {
    const id = where.get(uid); if (!id) return;
    where.delete(uid);
    const w = worlds.get(id); if (!w) return;
    const p = w.players.get(uid);
    if (p) w.gone.set(uid, { name: p.name });
    w.players.delete(uid);
    bc(w, { t: 'world_leave', id: uid });
    if (!w.players.size) { if (w.trivia && w.trivia.timer) clearTimeout(w.trivia.timer); worlds.delete(id); }
  }

  function handle(ws, m) {
    const uid = ws.userId, id = where.get(uid), w = id && worlds.get(id);
    if (m.t === 'world_join') return join(ws, m).catch(() => {});
    if (m.t === 'world_leave') return leave(uid);
    if (!w) return;
    const p = w.players.get(uid); if (!p) return;
    if (m.t === 'world_move') {
      const x = Math.min(W, Math.max(0, Number(m.x))), y = Math.min(H, Math.max(0, Number(m.y)));
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (Math.hypot(x - p.x, y - p.y) > 160) return;
      p.x = x; p.y = y; w.dirty.add(uid);
    } else if (m.t === 'world_say') {
      const text = String(m.text || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if (!text || p.muted || Date.now() - p.lastSay < 1200) return;
      if (F.check(text)) return sendTo(uid, { t: 'world_error', message: 'keep it clean' });
      p.lastSay = Date.now();
      bc(w, { t: 'world_say', id: uid, text });
    } else if (m.t === 'world_emote') {
      if (!EMOTES.has(m.e) || !limiter.hit('wemo:' + uid, 4, 5000).ok) return;
      bc(w, { t: 'world_emote', id: uid, e: m.e });
    } else if (m.t === 'world_coin') {
      const k = w.coins.find((x) => x.id === m.id);
      if (!k || Math.hypot(k.x - p.x, k.y - p.y) > 60) return;
      w.coins = w.coins.filter((x) => x !== k);
      const s = (w.scores.get(uid) || 0) + 1; w.scores.set(uid, s);
      bc(w, { t: 'world_coin', id: k.id, by: uid, score: s });
    } else if (m.t === 'world_trivia_start') {
      if (w.trivia) return;
      const wait = TRIVIA_COOLDOWN - (Date.now() - w.triviaEnded);
      if (wait > 0) return sendTo(uid, { t: 'world_error', message: `big trivia was just played, try again in ${Math.ceil(wait / 1000)}s` });
      const idx = TRIVIA.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = rnd(i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      w.trivia = { qs: idx.slice(0, TRIVIA_Q), i: 0, phase: 'q', ends: 0, scores: new Map(), answers: new Map(), timer: null };
      nextQuestion(w);
    } else if (m.t === 'world_answer') {
      const t = w.trivia;
      if (!t || t.phase !== 'q' || Date.now() > t.ends || t.answers.has(uid) || t.i !== m.i) return;
      const a = parseInt(m.a, 10); if (!(a >= 0 && a < 4)) return;
      t.answers.set(uid, a);
      const ok = TRIVIA[t.qs[t.i]][2] === a;
      if (ok) t.scores.set(uid, (t.scores.get(uid) || 0) + 100 + Math.ceil((t.ends - Date.now()) / 100));
      sendTo(uid, { t: 'world_answered', i: t.i });
    }
  }

  const loop = setInterval(() => {
    const now = Date.now();
    for (const w of worlds.values()) {
      if (w.dirty.size) {
        const pos = [...w.dirty].map((id) => { const p = w.players.get(id); return p && [id, Math.round(p.x), Math.round(p.y)]; }).filter(Boolean);
        w.dirty.clear();
        if (pos.length) bc(w, { t: 'world_pos', p: pos });
      }
      w.coins = w.coins.filter((k) => now - k.at < COIN_LIFE);
      if (w.coins.length < COIN_MAX && now - w.lastCoin > COIN_EVERY) {
        w.lastCoin = now;
        const k = { id: w.coinId++, x: 40 + rnd(W - 80), y: 40 + rnd(H - 80), at: now };
        w.coins.push(k);
        bc(w, { t: 'world_coin_new', id: k.id, x: k.x, y: k.y });
      }
      if (now >= w.roundEnds) {
        bc(w, { t: 'world_round', top: top(w.scores, 3, w), next: now + ROUND_MS });
        w.scores = new Map(); w.gone.clear(); w.roundEnds = now + ROUND_MS;
      }
    }
  }, 100);
  loop.unref();

  return { handle, leave, count: () => [...worlds.values()].reduce((n, w) => n + w.players.size, 0) };
}

module.exports = { init, W, H };

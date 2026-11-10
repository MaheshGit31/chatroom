const crypto = require('crypto');
const drop = require('./drop');

const BUS_MS = +process.env.BOSS_BUS_MS || 30_000;
const FIGHT_MS = +process.env.BOSS_FIGHT_MS || 600_000;
const WARN_MS = 300_000;
const RESULT_MS = 120_000;
const BASE_HP = 15_000;
const PER_HP = 11_000;
const HIT_DMG = 10;
const MAX_HPS = 14;
const MIN_REWARD_DMG = 300;
const ARENA = { w: 2400, h: 1800 };
const TZ = 'America/Chicago';
const REWARDS = [[1, 4320], [3, 2880], [10, 1440]];

let ctx = null;
let ready = null;
let cfg = { enabled: true, times: ['12:00', '18:00'], dropEvent: true };
let ev = null;
const finished = new Set();
const uinfo = new Map();
let snapAt = 0;
let meAt = 0;
let adminIds = { at: 0, set: new Set() };

const rewardMins = (rank) => { for (const [max, m] of REWARDS) if (rank <= max) return m; return 0; };

function tzOff(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
function localToEpoch(y, m, d, H, M) {
  const g = Date.UTC(y, m, d, H, M);
  let t = g - tzOff(g, TZ);
  t = g - tzOff(t, TZ);
  return t;
}
function ymd(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month - 1, d: +p.day };
}
function candidates() {
  const out = [];
  const now = Date.now();
  for (let k = -1; k <= 2; k++) {
    const { y, m, d } = ymd(now + k * 86_400_000);
    for (const t of cfg.times) {
      const [H, M] = t.split(':').map(Number);
      out.push({ id: `${y}-${m + 1}-${d}-${t}`, at: localToEpoch(y, m, d, H, M) });
    }
  }
  const dp = drop.pub();
  if (cfg.dropEvent && dp.at) out.push({ id: 'drop-' + dp.at, at: dp.at + 60_000 });
  return out.sort((a, b) => a.at - b.at);
}
const total = () => BUS_MS + FIGHT_MS;

async function load() {
  const r = (await ctx.q("select value from settings where key='boss'")).rows[0];
  if (r) { try { const j = JSON.parse(r.value); cfg = { ...cfg, ...j }; } catch {} }
}
async function save() {
  await ctx.q("insert into settings(key,value) values('boss',$1) on conflict(key) do update set value=$1", [JSON.stringify(cfg)]);
}
async function init() {
  await ctx.q(`create table if not exists boss_events(
    id text primary key, starts_at timestamptz not null, seed int not null, test boolean not null default false,
    max_hp int not null, hp int not null, won boolean not null default false, participants int not null default 0, ended_at timestamptz)`);
  await ctx.q(`create table if not exists boss_scores(
    event_id text not null references boss_events(id) on delete cascade, user_id uuid not null references users(id) on delete cascade,
    damage int not null default 0, hits int not null default 0, deaths int not null default 0, rank int, reward_mins int not null default 0,
    primary key(event_id, user_id))`);
  await ctx.q('create index if not exists boss_scores_user on boss_scores(user_id)');
  await load();
  const r = await ctx.q("select id from boss_events where starts_at > now() - interval '3 days'");
  for (const x of r.rows) finished.add(x.id);
}

async function info(id) {
  const c = uinfo.get(id);
  if (c && Date.now() - c.at < 60_000) return c;
  const r = (await ctx.q('select id,username,display_name,is_admin,verified,banned from users where id=$1', [id])).rows[0];
  const v = r ? { at: Date.now(), id, username: r.username, name: r.display_name, admin: r.is_admin, banned: r.banned } : null;
  if (v) uinfo.set(id, v);
  return v;
}
async function admins() {
  if (Date.now() - adminIds.at < 60_000) return adminIds.set;
  const r = await ctx.q('select id from users where is_admin');
  adminIds = { at: Date.now(), set: new Set(r.rows.map((x) => x.id)) };
  return adminIds.set;
}

function status(now = Date.now()) {
  if (!ev) return null;
  if (ev.status === 'ended') return 'ended';
  if (now < ev.startsAt) return 'scheduled';
  if (now < ev.startsAt + BUS_MS) return 'bus';
  return 'fight';
}
function pub() {
  if (!ev) return null;
  return { id: ev.id, status: ev.status, startsAt: ev.startsAt, now: Date.now(), hp: Math.max(0, Math.round(ev.hp)), max: ev.max, test: ev.test, seed: ev.seed, busMs: BUS_MS, fightMs: FIGHT_MS, n: ev.players.size, won: ev.won, arena: ARENA, endedAt: ev.endedAt || null };
}
function raw(userId, str) {
  const set = ctx.sockets.get(userId);
  if (!set) return;
  for (const ws of set) if (ws.readyState === 1) ws.send(str);
}
async function broadcastState() {
  const s = JSON.stringify({ t: 'boss_state', ev: pub() });
  if (ev && ev.test) { for (const id of await admins()) raw(id, s); return; }
  for (const id of ctx.sockets.keys()) raw(id, s);
}

async function canPlay(userId) {
  const u = await info(userId);
  if (!u || u.banned) return null;
  if (!ev) return null;
  if (ev.test) return u.admin ? u : null;
  return u.admin || drop.released() ? u : null;
}

function startEvent(id, startsAt, test) {
  ev = { id, startsAt, status: 'scheduled', seed: crypto.randomInt(1, 2 ** 30), hp: BASE_HP, max: BASE_HP, test: !!test, players: new Map(), won: false, endedAt: 0, results: null, persisted: false };
  finished.add(id);
  broadcastState().catch(() => {});
}

function ranked() {
  return [...ev.players.values()].filter((p) => !p.admin && p.dmg > 0).sort((a, b) => b.dmg - a.dmg || a.joined - b.joined);
}

async function endEvent(won) {
  if (!ev || ev.status === 'ended') return;
  ev.status = 'ended'; ev.won = !!won; ev.endedAt = Date.now();
  const list = ranked();
  const top = list.map((p, i) => ({ rank: i + 1, id: p.id, username: p.username, name: p.name, damage: p.dmg, hits: p.hits, deaths: p.deaths, mins: ev.test || p.dmg < MIN_REWARD_DMG ? 0 : rewardMins(i + 1) }));
  ev.results = top;
  const e = ev;
  try {
    await ctx.q('insert into boss_events(id,starts_at,seed,test,max_hp,hp,won,participants,ended_at) values($1,$2,$3,$4,$5,$6,$7,$8,now()) on conflict(id) do update set hp=$6,won=$7,participants=$8,ended_at=now(),max_hp=$5',
      [e.id, new Date(e.startsAt), e.seed, e.test, e.max, Math.max(0, Math.round(e.hp)), e.won, top.length]);
    if (!e.test) {
      for (const r of top.slice(0, 200)) {
        await ctx.q('insert into boss_scores(event_id,user_id,damage,hits,deaths,rank,reward_mins) values($1,$2,$3,$4,$5,$6,$7) on conflict(event_id,user_id) do update set damage=$3,hits=$4,deaths=$5,rank=$6,reward_mins=$7', [e.id, r.id, r.damage, r.hits, r.deaths, r.rank, r.mins]);
        if (r.mins > 0) {
          await ctx.q('update users set beta_until=greatest(coalesce(beta_until,now()),now()) + make_interval(mins=>$2) where id=$1 and not banned', [r.id, r.mins]);
          ctx.notify(r.id, 'boss_reward', { rank: r.rank, days: Math.round(r.mins / 1440), damage: r.damage }).catch(() => {});
          ctx.sendTo(r.id, { t: 'me_update' });
        }
      }
    }
  } catch (err) { console.warn('boss end', err.message); }
  const payload = JSON.stringify({ t: 'boss_end', ev: pub(), top: top.slice(0, 10), total: top.length });
  for (const p of e.players.values()) raw(p.id, payload);
  broadcastState().catch(() => {});
}

function snapshot(now) {
  const alive = [];
  for (const p of ev.players.values()) if (p.in && now - p.last < 4000) alive.push(p);
  const pick = alive.length > 60 ? alive.sort((a, b) => (a.snapN || 0) - (b.snapN || 0)).slice(0, 60) : alive;
  for (const p of pick) p.snapN = (p.snapN || 0) + 1;
  const top = ranked().slice(0, 5).map((p) => [p.name, p.dmg]);
  const s = JSON.stringify({ t: 'boss_snap', hp: Math.max(0, Math.round(ev.hp)), max: ev.max, st: ev.status, n: alive.length, top, p: pick.map((p) => [p.id.slice(0, 8), Math.round(p.x), Math.round(p.y), +p.a.toFixed(2), p.f, p.username, p.name]) });
  for (const p of alive) raw(p.id, s);
}
function sendMe(now) {
  const list = ranked();
  const idx = new Map(list.map((p, i) => [p.id, i + 1]));
  for (const p of ev.players.values()) if (p.in) raw(p.id, JSON.stringify({ t: 'boss_me', dmg: p.dmg, rank: p.admin ? 0 : (idx.get(p.id) || 0), of: list.length }));
}

async function tick() {
  try {
    await ready;
    const now = Date.now();
    if (!ev) {
      if (!cfg.enabled && !drop.pub().at) return;
      if (!drop.released()) return;
      for (const c of candidates()) {
        if (finished.has(c.id)) continue;
        if (c.at - now > WARN_MS) break;
        if (c.at + total() + RESULT_MS < now) continue;
        if (c.id.startsWith('drop-') ? !cfg.dropEvent : !cfg.enabled) continue;
        startEvent(c.id, c.at, false);
        break;
      }
      return;
    }
    if (ev.status === 'ended') {
      if (now - ev.endedAt > RESULT_MS) { ev = null; broadcastState().catch(() => {}); for (const id of ctx.sockets.keys()) raw(id, JSON.stringify({ t: 'boss_state', ev: null })); }
      return;
    }
    const st = status(now);
    if (st !== ev.status && st !== 'ended') { ev.status = st; broadcastState().catch(() => {}); }
    if (ev.status === 'fight') {
      if (ev.hp <= 0) return endEvent(true);
      if (now >= ev.startsAt + total()) return endEvent(false);
    }
    if ((ev.status === 'bus' || ev.status === 'fight') && now - snapAt >= 500) { snapAt = now; snapshot(now); }
    if (ev.status === 'fight' && now - meAt >= 2000) { meAt = now; sendMe(now); }
  } catch (e) { console.warn('boss tick', e.message); }
}

async function handle(ws, m) {
  await ready;
  const uid = ws.userId;
  if (!uid || !ev) return;
  if (m.t === 'boss_join') {
    const u = await canPlay(uid);
    const now = Date.now();
    if (!u || ev.status === 'ended' || ev.status === 'scheduled' && ev.startsAt - now > 20_000) return raw(uid, JSON.stringify({ t: 'boss_denied' }));
    let p = ev.players.get(uid);
    if (!p) {
      p = { id: uid, username: u.username, name: u.name, admin: u.admin, dmg: 0, hits: 0, deaths: 0, x: 0, y: 0, a: 0, f: 0, in: true, last: now, budget: MAX_HPS * 2, bt: now, joined: now };
      ev.players.set(uid, p);
      if (!u.admin) { ev.max += PER_HP; ev.hp += PER_HP; }
    }
    p.in = true; p.last = now;
    raw(uid, JSON.stringify({ t: 'boss_joined', ev: pub(), dmg: p.dmg }));
  } else if (m.t === 'boss_leave') {
    const p = ev.players.get(uid); if (p) p.in = false;
  } else if (m.t === 'boss_die') {
    const p = ev.players.get(uid); if (p && p.in && ev.status === 'fight') p.deaths++;
  } else if (m.t === 'boss_t') {
    const p = ev.players.get(uid);
    if (!p || !p.in) return;
    const now = Date.now();
    const x = Number(m.x), y = Number(m.y), a = Number(m.a);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(a)) { p.x = Math.max(0, Math.min(ARENA.w, x)); p.y = Math.max(0, Math.min(ARENA.h, y)); p.a = a; }
    p.f = m.f ? 1 : 0;
    p.last = now;
    const dt = Math.min(5, Math.max(0, (now - p.bt) / 1000)); p.bt = now;
    p.budget = Math.min(MAX_HPS * 3, p.budget + MAX_HPS * dt);
    const h = Math.floor(Number(m.h) || 0);
    if (h > 0 && ev.status === 'fight' && ev.hp > 0 && now >= ev.startsAt + BUS_MS) {
      const ok = Math.max(0, Math.min(h, Math.floor(p.budget), 16));
      p.budget -= ok;
      if (ok > 0) { p.hits += ok; p.dmg += ok * HIT_DMG; ev.hp -= ok * HIT_DMG; }
    }
  }
}

async function leaderboard(scope) {
  await ready;
  if (scope === 'last') {
    if (ev && ev.status === 'ended' && !ev.test && ev.results) return { title: 'last fight', won: ev.won, rows: ev.results.slice(0, 10) };
    const e = (await ctx.q('select id,won from boss_events where not test and ended_at is not null order by starts_at desc limit 1')).rows[0];
    if (!e) return { title: 'last fight', rows: [] };
    const r = await ctx.q('select s.rank, s.damage, s.reward_mins, u.username, u.display_name from boss_scores s join users u on u.id=s.user_id where s.event_id=$1 order by s.rank limit 10', [e.id]);
    return { title: 'last fight', won: e.won, rows: r.rows.map((x) => ({ rank: x.rank, username: x.username, name: x.display_name, damage: x.damage, mins: x.reward_mins })) };
  }
  const where = scope === 'today' ? "and e.starts_at > now() - interval '1 day'" : '';
  const r = await ctx.q(`select u.username, u.display_name, sum(s.damage)::int as damage, count(*)::int as fights from boss_scores s join boss_events e on e.id=s.event_id join users u on u.id=s.user_id where not e.test ${where} group by u.id order by damage desc limit 15`);
  return { title: scope === 'today' ? 'last 24 hours' : 'all time', rows: r.rows.map((x, i) => ({ rank: i + 1, username: x.username, name: x.display_name, damage: x.damage, fights: x.fights })) };
}

function nextStarts(n = 3) {
  const now = Date.now();
  const out = [];
  if (cfg.enabled) for (const c of candidates()) if (c.at > now - total() && !c.id.startsWith('drop-') && !finished.has(c.id)) out.push(c.at);
  const dp = drop.pub();
  if (cfg.dropEvent && dp.at && dp.at + 60_000 > now && !finished.has('drop-' + dp.at)) out.push(dp.at + 60_000);
  return out.sort((a, b) => a - b).slice(0, n);
}

function mount(app, c) {
  ctx = c;
  const { q, auth, adminOnly, ownerOnly, bad, wrap, byUser } = c;
  ready = init().catch((e) => console.warn('boss init', e.message));
  const gate = (req, res, next) => (drop.on(req.user) ? next() : bad(res, 'not yet', 403));

  app.get('/api/boss', auth, gate, wrap(async (req, res) => {
    await ready;
    let e = pub();
    if (ev && ev.test && !req.user.is_admin) e = null;
    res.json({ ev: e, next: nextStarts(3), tz: TZ });
  }));
  app.get('/api/boss/leaderboard', auth, gate, wrap(async (req, res) => {
    const scope = ['last', 'today', 'all'].includes(req.query.scope) ? req.query.scope : 'last';
    res.json(await leaderboard(scope));
  }));

  app.get('/api/admin/boss', auth, adminOnly, wrap(async (req, res) => {
    await ready;
    const h = await q('select id,starts_at,won,max_hp,hp,participants,test from boss_events order by starts_at desc limit 8');
    res.json({ cfg, ev: pub(), next: nextStarts(4), tz: TZ, isOwner: req.user.username === c.ownerName, history: h.rows.map((x) => ({ id: x.id, at: x.starts_at, won: x.won, max: x.max_hp, hp: x.hp, n: x.participants, test: x.test })) });
  }));
  app.put('/api/admin/boss', auth, adminOnly, ownerOnly, byUser('boss-cfg', 30, 3_600_000), wrap(async (req, res) => {
    await ready;
    const b = req.body || {};
    if (b.times !== undefined) {
      if (!Array.isArray(b.times) || b.times.length > 6 || !b.times.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return bad(res, 'times must look like 12:00');
      cfg.times = [...new Set(b.times)].sort();
    }
    if (b.enabled !== undefined) cfg.enabled = !!b.enabled;
    if (b.dropEvent !== undefined) cfg.dropEvent = !!b.dropEvent;
    await save();
    res.json({ cfg, next: nextStarts(4) });
  }));
  app.post('/api/admin/boss/start', auth, adminOnly, byUser('boss-start', 20, 3_600_000), wrap(async (req, res) => {
    await ready;
    const test = !!(req.body && req.body.test);
    if (!test && req.user.username !== c.ownerName) return bad(res, 'only the owner can start a real fight', 403);
    if (!test && !drop.released()) return bad(res, 'the doomsclock has not hit zero yet, start a test fight instead');
    if (ev && ev.status !== 'ended') return bad(res, 'a fight is already running, stop it first');
    startEvent((test ? 't-' : 'm-') + Date.now(), Date.now() + 20_000, test);
    res.json({ ev: pub() });
  }));
  app.post('/api/admin/boss/stop', auth, adminOnly, wrap(async (req, res) => {
    if (!ev || ev.status === 'ended') return res.json({ ok: true });
    if (!ev.test && req.user.username !== c.ownerName) return bad(res, 'only the owner can stop a real fight', 403);
    ev.endedAt = Date.now() - RESULT_MS + 3000;
    ev.status = 'ended'; ev.results = [];
    broadcastState().catch(() => {});
    for (const p of ev.players.values()) raw(p.id, JSON.stringify({ t: 'boss_end', ev: pub(), top: [], total: 0, stopped: true }));
    res.json({ ok: true });
  }));
}

function start() {
  const t = setInterval(tick, 1000);
  if (t.unref) t.unref();
}

module.exports = { mount, start, handle };

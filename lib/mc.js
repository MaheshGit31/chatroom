const G = require('../client/mcgen.js');
const audit = require('./audit');
const safety = require('./safety');

const SEED = 20261104;
const { H, CS, B } = G;
const DAY_MS = 600_000;
const MAX_HP = 20, REACH = 7.5, SPAWN_PROT = 6;
const MOB_CAP = 24;

function init(c) {
  const { q, sendTo, F, limiter } = c;
  const spawn = G.spawnPoint(SEED);
  const edits = new Map();
  const cache = new Map();
  const players = new Map();
  const mobs = new Map();
  let mobId = 1;
  let queue = [];

  const ck = (cx, cz) => cx + ',' + cz;
  const chunk = (cx, cz) => {
    const k = ck(cx, cz);
    let d = cache.get(k);
    if (d) { cache.delete(k); cache.set(k, d); return d; }
    d = G.genChunk(SEED, cx, cz);
    cache.set(k, d);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return d;
  };
  const baseAt = (x, y, z) => {
    if (y < 0 || y >= H) return 0;
    return chunk(Math.floor(x / CS), Math.floor(z / CS))[G.idx(((x % CS) + CS) % CS, y, ((z % CS) + CS) % CS)];
  };
  const getBlock = (x, y, z) => {
    if (y < 0 || y >= H) return 0;
    const m = edits.get(ck(Math.floor(x / CS), Math.floor(z / CS)));
    const e = m && m.get(x + ',' + y + ',' + z);
    return e === undefined ? baseAt(x, y, z) : e;
  };
  const setEdit = (x, y, z, b, by) => {
    const k = ck(Math.floor(x / CS), Math.floor(z / CS));
    let m = edits.get(k); if (!m) { m = new Map(); edits.set(k, m); }
    m.set(x + ',' + y + ',' + z, b);
    queue.push([x, y, z, b, by || null]);
  };
  const surfaceY = (x, z) => { for (let y = H - 1; y > 0; y--) { const b = getBlock(x, y, z); if (b !== 0 && b !== B.LEAVES) return b === B.WATER ? -1 : y + 1; } return -1; };

  async function load() {
    const r = await q('select x,y,z,b from mc_edits');
    for (const e of r.rows) {
      const k = ck(Math.floor(e.x / CS), Math.floor(e.z / CS));
      let m = edits.get(k); if (!m) { m = new Map(); edits.set(k, m); }
      m.set(e.x + ',' + e.y + ',' + e.z, e.b);
    }
  }

  async function flush() {
    if (!queue.length) return;
    const batch = queue; queue = [];
    const last = new Map(); for (const e of batch) last.set(e[0] + ',' + e[1] + ',' + e[2], e);
    const rows = [...last.values()];
    try {
      await q('insert into mc_edits(x,y,z,b,by_user,ts) select a,b2,c,d,e::uuid,now() from unnest($1::int[],$2::int[],$3::int[],$4::int[],$5::text[]) as t(a,b2,c,d,e) on conflict(x,y,z) do update set b=excluded.b,by_user=excluded.by_user,ts=now()',
        [rows.map((e) => e[0]), rows.map((e) => e[1]), rows.map((e) => e[2]), rows.map((e) => e[3]), rows.map((e) => e[4])]);
    } catch (e) { console.error('mc flush', e.message); queue = batch.concat(queue); }
  }

  const bc = (evt, except) => { for (const id of players.keys()) if (id !== except) sendTo(id, evt); };
  const pub = (p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch });
  const invOf = (p) => p.inv;
  const give = (p, b, n) => { p.inv[b] = Math.min(999, (p.inv[b] || 0) + n); };

  async function savePlayer(p) {
    try { await q('insert into mc_players(user_id,x,y,z,hp,inv) values($1,$2,$3,$4,$5,$6) on conflict(user_id) do update set x=$2,y=$3,z=$4,hp=$5,inv=$6,updated_at=now()', [p.id, p.x, p.y, p.z, p.hp, JSON.stringify(p.inv)]); } catch (e) { console.error('mc save', e.message); }
  }

  async function join(ws) {
    const uid = ws.userId;
    const u = (await q('select * from users where id=$1', [uid])).rows[0]; if (!u) return;
    leave(uid);
    const sv = (await q('select x,y,z,hp,inv from mc_players where user_id=$1', [uid])).rows[0];
    const p = { id: uid, name: u.display_name || u.username, username: u.username, admin: !!u.is_admin, verified: safety.verifiedOn(u) || !!u.is_admin, muted: !!(u.muted_until && new Date(u.muted_until) > new Date()),
      x: sv ? sv.x : spawn.x, y: sv ? sv.y : spawn.y, z: sv ? sv.z : spawn.z, yaw: 0, pitch: 0, hp: sv ? sv.hp : MAX_HP, inv: sv ? sv.inv || {} : {}, lastSay: 0, lastHurt: 0, dirty: false };
    if (p.hp <= 0) p.hp = MAX_HP;
    players.set(uid, p);
    sendTo(uid, { t: 'mc_state', seed: SEED, spawn, now: Date.now(), day: DAY_MS, you: { x: p.x, y: p.y, z: p.z, hp: p.hp, inv: p.inv, verified: p.verified, admin: p.admin },
      players: [...players.values()].filter((o) => o.id !== uid).map(pub), mobs: [...mobs.values()].map((m) => ({ id: m.id, x: m.x, y: m.y, z: m.z, yaw: m.yaw })) });
    bc({ t: 'mc_join', ...pub(p) }, uid);
  }

  function leave(uid) {
    const p = players.get(uid); if (!p) return;
    players.delete(uid);
    savePlayer(p);
    bc({ t: 'mc_leave', id: uid });
  }

  function hurt(p, n, why) {
    const now = Date.now();
    if (now - p.lastHurt < 150) return;
    p.lastHurt = now;
    p.hp = Math.max(0, p.hp - n);
    sendTo(p.id, { t: 'mc_hp', hp: p.hp });
    if (p.hp <= 0) {
      bc({ t: 'mc_say', id: null, name: '', text: `${p.name} ${why || 'died'}` });
      p.hp = MAX_HP; p.x = spawn.x; p.y = spawn.y; p.z = spawn.z; p.dirty = true;
      sendTo(p.id, { t: 'mc_respawn', x: p.x, y: p.y, z: p.z, hp: p.hp });
      bc({ t: 'mc_pos', p: [[p.id, p.x, p.y, p.z, 0, 0]] });
    }
  }

  const dist = (p, x, y, z) => Math.hypot(p.x - (x + 0.5), p.y + 1.2 - (y + 0.5), p.z - (z + 0.5));
  const protectedSpot = (p, x, z) => !p.admin && Math.abs(x - Math.floor(spawn.x)) <= SPAWN_PROT && Math.abs(z - Math.floor(spawn.z)) <= SPAWN_PROT;

  function revert(uid, x, y, z) { sendTo(uid, { t: 'mc_block', x, y, z, b: getBlock(x, y, z) }); }

  function handle(ws, m) {
    const uid = ws.userId;
    if (m.t === 'mc_join') return join(ws).catch((e) => console.error('mc join', e.message));
    if (m.t === 'mc_leave') return leave(uid);
    const p = players.get(uid); if (!p) return;
    if (m.t === 'mc_move') {
      const x = Number(m.x), y = Number(m.y), z = Number(m.z);
      if (![x, y, z].every(Number.isFinite) || y < -20 || y > H + 40) return;
      if (Math.hypot(x - p.x, z - p.z) > 12 || Math.abs(y - p.y) > 30) return;
      p.x = x; p.y = y; p.z = z; p.yaw = Number(m.yaw) || 0; p.pitch = Number(m.pitch) || 0; p.dirty = true;
    } else if (m.t === 'mc_break') {
      if (!p.verified || !limiter.hit('mcb:' + uid, 14, 1000).ok) return;
      const x = m.x | 0, y = m.y | 0, z = m.z | 0;
      if (y < 1 || y >= H) return revert(uid, x, y, z);
      const b = getBlock(x, y, z);
      if (!b || b === B.WATER || b === B.BEDROCK || dist(p, x, y, z) > REACH || protectedSpot(p, x, z)) return revert(uid, x, y, z);
      setEdit(x, y, z, 0, uid);
      give(p, G.DROP[b] || b, 1);
      bc({ t: 'mc_block', x, y, z, b: 0 });
      sendTo(uid, { t: 'mc_inv', inv: p.inv });
    } else if (m.t === 'mc_place') {
      if (!p.verified || !limiter.hit('mcp:' + uid, 14, 1000).ok) return;
      const x = m.x | 0, y = m.y | 0, z = m.z | 0, b = m.b | 0;
      if (!G.PLACEABLE.includes(b) || (p.inv[b] || 0) < 1 || y < 1 || y >= H) return revert(uid, x, y, z);
      const cur = getBlock(x, y, z);
      if ((cur !== 0 && cur !== B.WATER) || dist(p, x, y, z) > REACH || protectedSpot(p, x, z)) return revert(uid, x, y, z);
      for (const o of players.values()) if (Math.abs(o.x - (x + 0.5)) < 0.8 && Math.abs(o.z - (z + 0.5)) < 0.8 && o.y < y + 1 && o.y + 1.8 > y) return revert(uid, x, y, z);
      p.inv[b]--; if (!p.inv[b]) delete p.inv[b];
      setEdit(x, y, z, b, uid);
      bc({ t: 'mc_block', x, y, z, b });
      sendTo(uid, { t: 'mc_inv', inv: p.inv });
    } else if (m.t === 'mc_craft') {
      if (!limiter.hit('mcc:' + uid, 10, 1000).ok) return;
      const r = G.RECIPES.find((x) => x.id === m.id); if (!r) return;
      for (const k of Object.keys(r.inp)) if ((p.inv[k] || 0) < r.inp[k]) return;
      for (const k of Object.keys(r.inp)) { p.inv[k] -= r.inp[k]; if (!p.inv[k]) delete p.inv[k]; }
      for (const k of Object.keys(r.out)) give(p, +k, r.out[k]);
      sendTo(uid, { t: 'mc_inv', inv: p.inv });
    } else if (m.t === 'mc_dmg') {
      const n = Math.min(20, Math.max(0, m.n | 0)); if (n) hurt(p, n, 'fell from a high place');
    } else if (m.t === 'mc_hit') {
      if (!limiter.hit('mch:' + uid, 4, 1000).ok) return;
      const mob = mobs.get(m.id | 0); if (!mob || Math.hypot(mob.x - p.x, mob.z - p.z) > 5 || Math.abs(mob.y - p.y) > 3) return;
      mob.hp -= 4;
      const d = Math.hypot(mob.x - p.x, mob.z - p.z) || 1; mob.x += (mob.x - p.x) / d * 1.2; mob.z += (mob.z - p.z) / d * 1.2;
      if (mob.hp <= 0) { mobs.delete(mob.id); bc({ t: 'mc_mob_gone', id: mob.id }); }
    } else if (m.t === 'mc_say') {
      const text = String(m.text || '').trim().replace(/\s+/g, ' ').slice(0, 100);
      if (!text || p.muted || Date.now() - p.lastSay < 800) return;
      p.lastSay = Date.now();
      if (p.admin && text.startsWith('/undo ')) {
        const [, name, mins] = text.split(' ');
        undoBy(name, Math.min(1440, parseInt(mins, 10) || 30)).then((n) => sendTo(uid, { t: 'mc_say', id: null, name: '', text: `undid ${n} blocks by ${name}` })).catch(() => {});
        return;
      }
      if (F.check(text)) return sendTo(uid, { t: 'mc_say', id: null, name: '', text: 'keep it clean' });
      bc({ t: 'mc_say', id: uid, name: p.name, text });
    }
  }

  async function undoBy(username, minutes) {
    const r = await q(`delete from mc_edits e using users u where u.id=e.by_user and u.username=$1 and e.ts > now() - make_interval(mins=>$2) returning e.x,e.y,e.z`, [String(username).toLowerCase(), minutes]);
    for (const e of r.rows) {
      const m = edits.get(ck(Math.floor(e.x / CS), Math.floor(e.z / CS)));
      if (m) m.delete(e.x + ',' + e.y + ',' + e.z);
      bc({ t: 'mc_block', x: e.x, y: e.y, z: e.z, b: baseAt(e.x, e.y, e.z) });
    }
    return r.rows.length;
  }

  function mount(app, k) {
    const { auth, byUser, bad, wrap, adminOnly } = k;
    app.get('/api/mc/edits', auth, byUser('mc-edits', 90, 60_000), wrap(async (req, res) => {
      const x0 = parseInt(req.query.x0, 10), z0 = parseInt(req.query.z0, 10), x1 = parseInt(req.query.x1, 10), z1 = parseInt(req.query.z1, 10);
      if (![x0, z0, x1, z1].every(Number.isFinite) || x1 < x0 || z1 < z0 || x1 - x0 > 16 || z1 - z0 > 16) return bad(res, 'bad range');
      const out = [];
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const m = edits.get(ck(cx, cz)); if (!m) continue;
        for (const [key, b] of m) { const [x, y, z] = key.split(',').map(Number); out.push(x, y, z, b); }
      }
      res.json({ e: out });
    }));
    app.post('/api/admin/mc/undo', auth, adminOnly, wrap(async (req, res) => {
      const n = await undoBy(String((req.body && req.body.username) || ''), Math.min(1440, parseInt(req.body && req.body.minutes, 10) || 30));
      audit.log(q, req.user, 'mc_undo', null, { detail: `${req.body && req.body.username}: ${n} blocks` });
      res.json({ undone: n });
    }));
  }

  const nightNow = () => { const f = (Date.now() % DAY_MS) / DAY_MS; return f >= 0.65 && f < 0.95; };
  let tickN = 0, mobSeen = Date.now();
  const loop = setInterval(() => {
    tickN++;
    if (!players.size) { if (mobs.size) mobs.clear(); return; }
    const pos = [];
    for (const p of players.values()) if (p.dirty) { p.dirty = false; pos.push([p.id, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100, Math.round(p.yaw * 100) / 100, Math.round(p.pitch * 100) / 100]); }
    if (pos.length) bc({ t: 'mc_pos', p: pos });
    if (tickN % 2 === 0) {
      const dt = (Date.now() - mobSeen) / 1000; mobSeen = Date.now();
      const night = nightNow();
      for (const mob of [...mobs.values()]) {
        let best = null, bd = 1e9;
        for (const p of players.values()) { const d = Math.hypot(p.x - mob.x, p.z - mob.z); if (d < bd) { bd = d; best = p; } }
        if (!best || bd > 48 || !night) { mobs.delete(mob.id); bc({ t: 'mc_mob_gone', id: mob.id }); continue; }
        if (bd > 1.1) { const sp = 2.6 * dt; mob.x += (best.x - mob.x) / bd * sp; mob.z += (best.z - mob.z) / bd * sp; mob.yaw = Math.atan2(best.x - mob.x, best.z - mob.z); }
        const sy = surfaceY(Math.floor(mob.x), Math.floor(mob.z)); if (sy > 0) mob.y = sy;
        mob.cd -= dt;
        if (bd < 1.4 && Math.abs(best.y - mob.y) < 2 && mob.cd <= 0) { mob.cd = 1.2; hurt(best, 4, 'was killed by a zombie'); }
      }
      if (mobs.size) bc({ t: 'mc_mobs', m: [...mobs.values()].map((m) => [m.id, Math.round(m.x * 100) / 100, Math.round(m.y * 100) / 100, Math.round(m.z * 100) / 100, Math.round(m.yaw * 100) / 100]) });
    }
    if (tickN % 10 === 0) {
      const night = nightNow();
      if (night && mobs.size < MOB_CAP) for (const p of players.values()) {
        const near = [...mobs.values()].filter((m) => Math.hypot(m.x - p.x, m.z - p.z) < 40).length;
        if (near >= 4) continue;
        const a = Math.random() * 6.283, d = 20 + Math.random() * 12;
        const x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d), y = surfaceY(x, z);
        if (y < 0) continue;
        const m = { id: mobId++, x: x + 0.5, y, z: z + 0.5, yaw: 0, hp: 12, cd: 1 };
        mobs.set(m.id, m); bc({ t: 'mc_mob', id: m.id, x: m.x, y: m.y, z: m.z, yaw: 0 });
      }
      for (const p of players.values()) if (p.hp < MAX_HP && Date.now() - p.lastHurt > 5000) { p.hp++; sendTo(p.id, { t: 'mc_hp', hp: p.hp }); }
    }
  }, 100);
  loop.unref();
  const saver = setInterval(() => { flush(); for (const p of players.values()) savePlayer(p); }, 5000);
  saver.unref();

  return { handle, leave, mount, load, flush, count: () => players.size, getBlock };
}

module.exports = { init, SEED };

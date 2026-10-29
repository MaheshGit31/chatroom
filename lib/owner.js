// lib/owner.js - everything only the owner can see or do: the update video, the console, lockdowns, timed events
const events = require('./events');                          // timed global events
const audit = require('./audit');                            // every console command is written to the audit log (hidden from other admins)

const DRIVE_ID = /^[A-Za-z0-9_-]{10,80}$/;                   // what a google drive file id looks like
const errors = [];                                           // the last server errors, for "peek errors"
for (const lvl of ['error', 'warn']) {                       // wrap console so the owner can read problems without opening railway
  const orig = console[lvl].bind(console);
  console[lvl] = (...a) => { try { errors.push(new Date().toISOString().slice(11, 19) + ' ' + lvl + ' ' + a.map((x) => (x && x.message) || String(x)).join(' ').slice(0, 220)); while (errors.length > 40) errors.shift(); } catch {} orig(...a); };
}

// pull the file id out of any normal drive share link
function driveId(raw) {
  const s = String(raw || '').trim();
  if (DRIVE_ID.test(s)) return s;                            // a bare id also works
  try {
    const u = new URL(s);
    if (u.hostname !== 'drive.google.com' && u.hostname !== 'docs.google.com') return null;
    const m = u.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/) || u.pathname.match(/\/d\/([A-Za-z0-9_-]+)/);
    const id = (m && m[1]) || u.searchParams.get('id');
    return id && DRIVE_ID.test(id) ? id : null;
  } catch { return null; }
}
const durMins = (s) => {                                     // 10m, 2h, 1d, 1w
  const m = String(s || '').trim().toLowerCase().match(/^(\d{1,5})\s*(m|min|h|hr|d|w)?$/);
  if (!m) return 0;
  const n = parseInt(m[1], 10), u = m[2] || 'm';
  return n * (u.startsWith('m') ? 1 : u.startsWith('h') ? 60 : u === 'd' ? 1440 : 10080);
};
const niceMins = (m) => (m % 10080 === 0 ? m / 10080 + 'w' : m % 1440 === 0 ? m / 1440 + 'd' : m % 60 === 0 ? m / 60 + 'h' : m + 'm');
const left = (iso) => niceMins(Math.max(1, Math.round((new Date(iso) - Date.now()) / 60_000)));

function init(ctx) {
  const { q, sendTo, sockets, ownerName, getMod, getGng } = ctx;
  let video = null;                                          // { id, fileId, title, note, at }
  let lock = { signups: false, send: false };                // lockdown switches

  async function load() {
    await events.load(q);
    try { const r = await q("select value from settings where key='update_video'"); video = r.rows[0] ? JSON.parse(r.rows[0].value) : null; } catch { video = null; }
    try { const r = await q("select value from settings where key='lockdown'"); if (r.rows[0]) lock = { ...lock, ...JSON.parse(r.rows[0].value) }; } catch {}
  }
  const saveSetting = (key, val) => q('insert into settings(key,value) values($1,$2) on conflict(key) do update set value=$2', [key, val]);
  const videoOut = () => (video ? { id: video.id, title: video.title, note: video.note, at: video.at, embed: `https://drive.google.com/file/d/${video.fileId}/preview`, link: `https://drive.google.com/file/d/${video.fileId}/view` } : null);

  async function setVideo(link, title, note) {
    const fileId = driveId(link);
    if (!fileId) return { error: 'that is not a google drive link. share the file as "anyone with the link" and paste the link' };
    video = { id: Date.now().toString(36), fileId, title: String(title || 'what is new').trim().slice(0, 60) || 'what is new', note: String(note || '').trim().slice(0, 300), at: new Date().toISOString() };
    await saveSetting('update_video', JSON.stringify(video));
    return { video: videoOut() };
  }
  async function clearVideo() { video = null; await q("delete from settings where key='update_video'"); }

  const userByName = async (tok) => {                        // "@name" or "name"
    const n = String(tok || '').replace(/^@/, '').toLowerCase();
    return n ? (await q('select * from users where username=$1', [n])).rows[0] || null : null;
  };

  // ----- the console -----
  const HELP = [
    'owner console. everything here is logged where only you can see it.',
    '',
    'events (timed, switch themselves off):',
    '  event start refbonus <minutes> <duration>   referral pays <minutes> beta instead of the normal amount (ex: event start refbonus 60 3d)',
    '  event start welcome <minutes> <duration>    every newly verified account gets free beta minutes',
    '  event list | event stop <id|kind|all>',
    '',
    'people:',
    '  beta @user <duration>        add beta time (1d, 2h, 1w)       beta clear @user',
    '  beta all <duration> --yes    give beta to every verified account',
    '  ban @user [reason] | unban @user',
    '  broadcast <text> [--yes]     pin a banner for everyone and ping everyone online',
    '',
    'chatroom:',
    '  lockdown signups on|off     stop or allow new accounts',
    '  lockdown send on|off        only admins can send messages',
    '  lockdown status',
    '  video <drive link> [| title | note]    set the update video   video clear | video show',
    '',
    'gng:',
    '  gng say <text>              he says it in Everyone',
    '  gng mute | gng unmute',
    '  gng chance <0-1> | gng cooldown <seconds> | gng status',
    '',
    'peek (stuff admins cannot see):',
    '  peek health | online | admins | audit [n] | errors | rooms | signups | user @name',
  ];

  async function run(line, actor) {
    const toks = line.trim().split(/\s+/).filter(Boolean);
    const cmd = (toks.shift() || '').toLowerCase();
    const sub = (toks[0] || '').toLowerCase();
    const yes = toks.includes('--yes');
    const args = toks.filter((t) => t !== '--yes');
    const log = (action, detail, target) => audit.log(q, actor, action, target || null, { detail: String(detail || line).slice(0, 280) });

    if (!cmd || cmd === 'help' || cmd === '?') return HELP;

    // ---- events ----
    if (cmd === 'event' || cmd === 'events') {
      if (!sub || sub === 'list') {
        const l = events.all();
        return l.length ? l.map((e) => `${e.id}  ${e.kind} = ${e.value}   ${left(e.until)} left`) : ['no events running', 'kinds: ' + Object.entries(events.KINDS).map(([k, v]) => `${k} (${v.label})`).join(', ')];
      }
      if (sub === 'start') {
        const [, kind, val, dur] = args;
        const r = await events.start(q, String(kind || '').toLowerCase(), parseInt(val, 10), durMins(dur), actor.username);
        if (r.error) return [r.error, 'usage: event start <kind> <value> <duration>   ex: event start refbonus 60 3d'];
        log('owner_cmd', line);
        return [`started ${r.event.kind} = ${r.event.value} for ${left(r.event.until)} (id ${r.event.id})`];
      }
      if (sub === 'stop') {
        const n = await events.stop(q, String(args[1] || '').toLowerCase());
        log('owner_cmd', line);
        return [n ? `stopped ${n} event${n > 1 ? 's' : ''}` : 'no matching event'];
      }
      return ['try: event list | event start <kind> <value> <duration> | event stop <id|kind|all>'];
    }

    // ---- beta ----
    if (cmd === 'beta') {
      if (sub === 'clear') {
        const u = await userByName(args[1]); if (!u) return ['who? usage: beta clear @user'];
        await q('update users set beta_until=null where id=$1', [u.id]); sendTo(u.id, { t: 'me_update' });
        log('owner_cmd', line, u); return [`cleared beta for @${u.username}`];
      }
      const mins = durMins(args[1]);
      if (!mins || mins > 60 * 24 * 365) return ['usage: beta @user <duration>   or   beta all <duration> --yes'];
      if (sub === 'all') {
        const n = (await q("select count(*)::int c from users where verified and not banned and not is_bot")).rows[0].c;
        if (!yes) return [`this would give ${niceMins(mins)} of beta to ${n} verified accounts.`, 'run it again with --yes on the end to do it'];
        await q('update users set beta_until=greatest(coalesce(beta_until,now()),now()) + make_interval(mins=>$1) where verified and not banned and not is_bot', [mins]);
        for (const id of sockets.keys()) sendTo(id, { t: 'me_update' });
        audit.bump(q, 'beta_grants', n);
        log('owner_cmd', line); return [`gave ${niceMins(mins)} of beta to ${n} accounts`];
      }
      const u = await userByName(sub); if (!u) return [`no user called ${sub || '(nothing)'}`];
      await q('update users set beta_until=greatest(coalesce(beta_until,now()),now()) + make_interval(mins=>$2) where id=$1', [u.id, mins]);
      sendTo(u.id, { t: 'me_update' }); audit.bump(q, 'beta_grants');
      log('owner_cmd', line, u); return [`gave @${u.username} ${niceMins(mins)} of beta`];
    }

    // ---- ban / unban ----
    if (cmd === 'ban' || cmd === 'unban') {
      const u = await userByName(sub); if (!u) return [`no user called ${sub || '(nothing)'}`];
      const r = await getMod().setBanned(actor, u, cmd === 'ban', args.slice(1).join(' ').slice(0, 200));
      if (!r.ok) return [r.error];
      return [`@${u.username} is ${cmd === 'ban' ? 'suspended' : 'back'}`];
    }

    // ---- broadcast ----
    if (cmd === 'broadcast') {
      const text = args.join(' ').trim();
      if (!text) return ['usage: broadcast <text>'];
      if (!yes) return [`this posts a banner and pings everyone online (${sockets.size} connected):`, `"${text.slice(0, 300)}"`, 'run it again with --yes on the end to send'];
      await q('insert into announcements(title,body,created_by) values($1,$2,$3)', ['from the owner', text.slice(0, 600), actor.id]);
      for (const id of sockets.keys()) sendTo(id, { t: 'owner_note', text: text.slice(0, 200) });
      log('owner_cmd', line); return [`sent to ${sockets.size} online, banner is up`];
    }

    // ---- lockdown ----
    if (cmd === 'lockdown') {
      if (!sub || sub === 'status') return [`signups: ${lock.signups ? 'LOCKED' : 'open'}`, `sending: ${lock.send ? 'LOCKED (admins only)' : 'open'}`];
      if (!['signups', 'send'].includes(sub) || !['on', 'off'].includes((args[1] || '').toLowerCase())) return ['usage: lockdown signups|send on|off'];
      lock[sub] = args[1].toLowerCase() === 'on'; await saveSetting('lockdown', JSON.stringify(lock));
      log('owner_cmd', line); return [`${sub} is now ${lock[sub] ? 'LOCKED' : 'open'}`];
    }

    // ---- update video ----
    if (cmd === 'video') {
      if (sub === 'show' || !sub) return video ? [`${video.title}  (${video.at.slice(0, 10)})`, `https://drive.google.com/file/d/${video.fileId}/view`, video.note || ''] : ['no update video set'];
      if (sub === 'clear') { await clearVideo(); log('owner_cmd', line); return ['update video removed'] }
      const [link, title, note] = line.trim().slice(cmd.length).trim().split('|').map((s) => s.trim());
      const r = await setVideo(link, title, note);
      if (r.error) return [r.error];
      log('owner_cmd', line); return ['update video set. everyone sees it fullscreen the next time they open the app'];
    }

    // ---- gng ----
    if (cmd === 'gng') {
      const g = getGng();
      if (!g || !g.control) return ['gng is not running (set AI_API_KEY)'];
      const r = await g.control(sub, args.slice(1));
      if (sub !== 'status') log('owner_cmd', line);
      return r;
    }

    // ---- peek ----
    if (cmd === 'peek') {
      if (sub === 'health') {
        const db = (await q('select pg_database_size(current_database())::bigint b')).rows[0].b;
        const m = process.memoryUsage();
        return [`uptime ${Math.round(process.uptime() / 60)} min   memory ${Math.round(m.rss / 1e6)} MB   db ${(Number(db) / 1e6).toFixed(1)} MB`, `connected: ${sockets.size} people`, `node ${process.version}`, `lockdown: signups ${lock.signups ? 'LOCKED' : 'open'}, sending ${lock.send ? 'LOCKED' : 'open'}`, `events: ${events.all().map((e) => e.kind + '=' + e.value).join(', ') || 'none'}`, ...(getGng() && getGng().control ? await getGng().control('status', []) : ['gng: off'])];
      }
      if (sub === 'online') {
        const ids = [...sockets.keys()];
        if (!ids.length) return ['nobody connected'];
        const r = await q('select id,username from users where id=any($1::uuid[]) order by username', [ids]);
        return [`${r.rows.length} online:`, r.rows.map((u) => '@' + u.username + (sockets.get(u.id).size > 1 ? ' x' + sockets.get(u.id).size : '')).join('  ')];
      }
      if (sub === 'admins') {
        const r = await q(`select u.username, u.id, (select count(*)::int from audit a where a.actor_id=u.id and a.at > now() - interval '7 days') acts, (select max(at) from audit a where a.actor_id=u.id) last from users u where u.is_admin order by acts desc`);
        return r.rows.map((u) => `@${u.username}${u.username === ownerName ? ' (you)' : ''}   ${u.acts} actions this week   last: ${u.last ? new Date(u.last).toISOString().slice(0, 16).replace('T', ' ') : 'never'}   ${sockets.has(u.id) ? 'online' : 'offline'}`);
      }
      if (sub === 'audit') {
        const n = Math.min(Math.max(parseInt(args[1], 10) || 20, 1), 60);
        const r = await q('select at,actor_name,action,target_name,detail from audit order by id desc limit $1', [n]);
        return r.rows.map((a) => `${new Date(a.at).toISOString().slice(5, 16).replace('T', ' ')}  ${a.actor_name}  ${a.action}${a.target_name ? ' @' + a.target_name : ''}${a.detail ? '  ' + a.detail : ''}`);
      }
      if (sub === 'errors') return errors.length ? errors.slice(-25) : ['no errors logged since the last restart'];
      if (sub === 'rooms') {
        const t = await q("select type, count(*)::int c from conversations group by type");
        const big = await q("select c.name, c.is_public, count(m.user_id)::int n from conversations c join members m on m.conv_id=c.id where c.type='group' group by c.id order by n desc limit 10");
        return [t.rows.map((x) => `${x.type}: ${x.c}`).join('   '), '', 'biggest groups (names only, contents are end-to-end encrypted):', ...big.rows.map((x) => `${x.n} members  ${x.name || '(unnamed)'}${x.is_public ? '  [public]' : ''}`)];
      }
      if (sub === 'signups') {
        const r = await q('select day,signups,verified,messages,bans from daily_stats order by day desc limit 7');
        return r.rows.length ? r.rows.map((d) => `${String(d.day).slice(0, 10)}  signups ${d.signups}  verified ${d.verified}  msgs ${d.messages}  bans ${d.bans}`) : ['no stats yet'];
      }
      if (sub === 'user') {
        const u = await userByName(args[1]); if (!u) return ['usage: peek user @name'];
        const refs = (await q('select count(*)::int a, count(*) filter (where ref_credited)::int b from users where referred_by=$1', [u.id])).rows[0];
        const by = u.referred_by ? (await q('select username from users where id=$1', [u.referred_by])).rows[0] : null;
        const ses = (await q('select count(*)::int c from sessions where user_id=$1', [u.id])).rows[0].c;
        const recent = await q('select at,action,detail from audit where target_id=$1 or actor_id=$1 order by id desc limit 5', [u.id]);
        return [`@${u.username} (${u.display_name})  id ${u.id}`, `joined ${new Date(u.created_at).toISOString().slice(0, 16).replace('T', ' ')}   messages ${u.msg_count || 0}   sessions ${ses}`,
          `admin ${!!u.is_admin}  verified ${!!u.verified}  banned ${!!u.banned}${u.ban_reason ? ' (' + u.ban_reason + ')' : ''}  beta until ${u.beta_until ? new Date(u.beta_until).toISOString().slice(0, 16).replace('T', ' ') : 'no'}`,
          `referred by ${by ? '@' + by.username : 'nobody'}   referred ${refs.a} friends, ${refs.b} paid out   ${sockets.has(u.id) ? 'online now' : 'offline'}`,
          ...recent.rows.map((a) => `  ${new Date(a.at).toISOString().slice(5, 16).replace('T', ' ')} ${a.action} ${a.detail || ''}`)];
      }
      return ['peek what? health | online | admins | audit [n] | errors | rooms | signups | user @name'];
    }

    return [`unknown command "${cmd}". type help`];
  }

  function mount(app, m) {
    const { auth, ownerOnly, byUser, bad, wrap } = m;
    // anyone signed in: is there an update video they have not watched yet?
    app.get('/api/update-video', auth, wrap(async (req, res) => {
      const v = videoOut();
      if (!v) return res.json({ video: null });
      const seen = (await q('select video_seen from users where id=$1', [req.user.id])).rows[0];
      res.json({ video: v, seen: !!seen && seen.video_seen === v.id });
    }));
    app.post('/api/update-video/seen', auth, byUser('video-seen', 30, 60_000), wrap(async (req, res) => {
      if (video && req.body.id === video.id) await q('update users set video_seen=$2 where id=$1', [req.user.id, video.id]);
      res.json({ ok: true });
    }));
    // owner only from here on
    app.get('/api/owner/state', auth, ownerOnly, wrap(async (req, res) => res.json({ video: videoOut(), events: events.all(), lock, kinds: events.KINDS })));
    app.post('/api/owner/video', auth, ownerOnly, byUser('owner-video', 20, 60_000), wrap(async (req, res) => {
      if (req.body.clear) { await clearVideo(); audit.log(q, req.user, 'owner_cmd', null, { detail: 'video clear' }); return res.json({ video: null }); }
      const r = await setVideo(req.body.link, req.body.title, req.body.note);
      if (r.error) return bad(res, r.error);
      audit.log(q, req.user, 'owner_cmd', null, { detail: 'video set: ' + r.video.title });
      res.json(r);
    }));
    app.post('/api/owner/console', auth, ownerOnly, byUser('owner-console', 120, 60_000), wrap(async (req, res) => {
      const line = String(req.body.line || '').slice(0, 600);
      try { res.json({ out: await run(line, req.user) }); } catch (e) { console.warn('console:', e.message); res.json({ out: ['that failed: ' + e.message] }); }
    }));
  }

  // hooks the rest of the server calls
  const locked = (what) => !!lock[what];
  async function welcome(user) {                             // a "welcome" event gives every newly verified account free beta
    const e = events.active('welcome'); if (!e || !user) return;
    await q('update users set beta_until=greatest(coalesce(beta_until,now()),now()) + make_interval(mins=>$2) where id=$1 and not banned', [user.id, e.value]).catch(() => {});
    sendTo(user.id, { t: 'me_update' });
  }
  return { load, mount, locked, welcome, events };
}
module.exports = { init };

const audit = require('./audit');
const safety = require('./safety');

const KINDS = ['text', 'voice', 'video', 'stage'];
const MAX_CHANNELS = 12, MAX_PER_USER = 3, MAX_THREADS = 40;

function mount(app, c) {
  const { q, auth, byUser, bad, wrap, isUuid, sendToConv, isStaff, filter, voice } = c;

  const memberOf = async (req, res, convId) => {
    if (!isUuid(convId)) { bad(res, 'bad id'); return null; }
    const r = (await q('select m.role,m.muted_until,cv.type,cv.name,cv.is_public,cv.system_kind from members m join conversations cv on cv.id=m.conv_id where m.conv_id=$1 and m.user_id=$2', [convId, req.user.id])).rows[0];
    if (!r) { bad(res, 'not a member', 403); return null; }
    if (r.type !== 'group' || !r.is_public) { bad(res, 'channels are for public rooms'); return null; }
    return r;
  };
  const canMake = (req, res, m) => {
    if (req.user.muted_until && new Date(req.user.muted_until) > new Date()) { bad(res, 'you are muted', 403); return false; }
    if (m.muted_until && new Date(m.muted_until) > new Date()) { bad(res, 'you are muted in this room', 403); return false; }
    if (!isStaff(req.user, m.role) && !safety.verifiedOn(req.user)) { bad(res, 'verify your account to make channels', 403); return false; }
    return true;
  };
  const cleanName = (s, max) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9 _-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, max);

  app.get('/api/conversations/:id/channels', auth, byUser('chan-list', 60, 60_000), wrap(async (req, res) => {
    const m = await memberOf(req, res, req.params.id); if (!m) return;
    const ch = await q('select ch.id,ch.name,ch.kind,ch.created_by,u.display_name creator from channels ch left join users u on u.id=ch.created_by where ch.conv_id=$1 order by ch.created_at', [req.params.id]);
    const th = await q('select t.id,t.title,t.channel_id,t.created_by,t.root_msg_id,t.last_at,u.display_name creator from threads t left join users u on u.id=t.created_by where t.conv_id=$1 order by t.last_at desc limit $2', [req.params.id, MAX_THREADS]);
    res.json({
      staff: isStaff(req.user, m.role),
      channels: ch.rows.map((x) => ({ id: x.id, name: x.name, kind: x.kind, mine: x.created_by === req.user.id, creator: x.creator || 'former member', live: x.kind === 'text' ? 0 : voice.occupants(x.id) })),
      threads: th.rows.map((x) => ({ id: x.id, title: x.title, channelId: x.channel_id, rootMsgId: x.root_msg_id ? Number(x.root_msg_id) : null, mine: x.created_by === req.user.id, creator: x.creator || 'former member', lastAt: x.last_at })),
      max: MAX_CHANNELS
    });
  }));

  app.post('/api/conversations/:id/channels', auth, byUser('chan-new', 10, 3_600_000), wrap(async (req, res) => {
    const m = await memberOf(req, res, req.params.id); if (!m) return;
    if (!canMake(req, res, m)) return;
    const staff = isStaff(req.user, m.role);
    const kind = String((req.body && req.body.kind) || 'text');
    if (!KINDS.includes(kind)) return bad(res, 'pick text, voice, video or stage');
    if (kind === 'stage' && !staff) return bad(res, 'only mods can open a stage', 403);
    if (m.system_kind && !staff) return bad(res, 'only mods can add channels to the built-in rooms', 403);
    const name = cleanName(req.body && req.body.name, 24);
    if (name.length < 2) return bad(res, 'give it a name (2+ letters)');
    if (filter.checkName(name)) return bad(res, 'keep the name clean');
    const rows = (await q('select name,created_by from channels where conv_id=$1', [req.params.id])).rows;
    if (rows.some((x) => x.name === name)) return bad(res, 'a channel with that name exists');
    if (!staff && rows.length >= MAX_CHANNELS) return bad(res, `this room has ${MAX_CHANNELS} channels already`);
    if (!staff && rows.filter((x) => x.created_by === req.user.id).length >= MAX_PER_USER) return bad(res, `you can make ${MAX_PER_USER} channels per room`);
    if (staff && rows.length >= 40) return bad(res, 'that is a lot of channels, delete some');
    const ch = (await q('insert into channels(conv_id,name,kind,created_by) values($1,$2,$3,$4) returning id,name,kind', [req.params.id, name, kind, req.user.id])).rows[0];
    const evt = { id: ch.id, name: ch.name, kind: ch.kind, creator: req.user.display_name };
    await sendToConv(req.params.id, { t: 'channel_new', convId: req.params.id, channel: { ...evt, live: 0 }, by: req.user.id });
    res.json({ channel: { ...evt, mine: true, live: 0 } });
  }));

  const chanOf = async (req, res) => {
    if (!isUuid(req.params.cid)) { bad(res, 'bad id'); return {}; }
    const ch = (await q('select id,conv_id,name,kind,created_by from channels where id=$1', [req.params.cid])).rows[0];
    if (!ch) { bad(res, 'channel not found', 404); return {}; }
    const m = await memberOf(req, res, ch.conv_id); if (!m) return {};
    return { ch, m };
  };

  app.patch('/api/channels/:cid', auth, byUser('chan-edit', 20, 60_000), wrap(async (req, res) => {
    const { ch, m } = await chanOf(req, res); if (!ch) return;
    if (ch.created_by !== req.user.id && !isStaff(req.user, m.role)) return bad(res, 'only the creator or a mod can rename this', 403);
    const name = cleanName(req.body && req.body.name, 24);
    if (name.length < 2) return bad(res, 'give it a name (2+ letters)');
    if (filter.checkName(name)) return bad(res, 'keep the name clean');
    if ((await q('select 1 from channels where conv_id=$1 and name=$2 and id<>$3', [ch.conv_id, name, ch.id])).rows[0]) return bad(res, 'a channel with that name exists');
    await q('update channels set name=$2 where id=$1', [ch.id, name]);
    await sendToConv(ch.conv_id, { t: 'channel_update', convId: ch.conv_id, id: ch.id, name });
    res.json({ ok: true, name });
  }));

  app.delete('/api/channels/:cid', auth, byUser('chan-del', 20, 60_000), wrap(async (req, res) => {
    const { ch, m } = await chanOf(req, res); if (!ch) return;
    const staff = isStaff(req.user, m.role);
    if (ch.created_by !== req.user.id && !staff) return bad(res, 'only the creator or a mod can delete this', 403);
    await q('delete from channels where id=$1', [ch.id]);
    voice.closeRoom('ch:' + ch.id);
    if (staff && ch.created_by !== req.user.id) audit.log(q, req.user, 'channel_delete', null, { convId: ch.conv_id, convName: m.name, detail: ch.name });
    await sendToConv(ch.conv_id, { t: 'channel_gone', convId: ch.conv_id, id: ch.id });
    res.json({ ok: true });
  }));

  app.post('/api/conversations/:id/threads', auth, byUser('thread-new', 15, 3_600_000), wrap(async (req, res) => {
    const m = await memberOf(req, res, req.params.id); if (!m) return;
    if (!canMake(req, res, m)) return;
    const b = req.body || {};
    const title = String(b.title || '').trim().replace(/\s+/g, ' ').slice(0, 50);
    if (title.length < 2) return bad(res, 'give the thread a title');
    if (filter.check(title)) return bad(res, 'keep the title clean');
    let channelId = null;
    if (b.channelId) {
      if (!isUuid(b.channelId)) return bad(res, 'bad channel');
      const ch = (await q('select kind from channels where id=$1 and conv_id=$2', [b.channelId, req.params.id])).rows[0];
      if (!ch || ch.kind !== 'text') return bad(res, 'threads live in text channels');
      channelId = b.channelId;
    }
    let root = null;
    if (b.rootMsgId != null) {
      root = parseInt(b.rootMsgId, 10) || null;
      if (root) {
        const mm = (await q('select channel_id,thread_id from messages where id=$1 and conv_id=$2 and not deleted', [root, req.params.id])).rows[0];
        if (!mm) return bad(res, 'that message is gone');
        if (mm.thread_id) return bad(res, 'that message is already in a thread');
        if ((mm.channel_id || null) !== channelId) return bad(res, 'wrong channel for that message');
        if ((await q('select 1 from threads where root_msg_id=$1', [root])).rows[0]) return bad(res, 'that message already has a thread');
      }
    }
    const staff = isStaff(req.user, m.role);
    const n = (await q('select count(*)::int c from threads where conv_id=$1', [req.params.id])).rows[0].c;
    if (n >= 200) return bad(res, 'too many threads in this room');
    if (!staff && (await q('select count(*)::int c from threads where conv_id=$1 and created_by=$2 and created_at>now()-interval \'1 day\'', [req.params.id, req.user.id])).rows[0].c >= 5) return bad(res, 'you made a lot of threads today, try tomorrow');
    const t = (await q('insert into threads(conv_id,channel_id,title,root_msg_id,created_by) values($1,$2,$3,$4,$5) returning id,title,channel_id,root_msg_id', [req.params.id, channelId, title, root, req.user.id])).rows[0];
    const thread = { id: t.id, title: t.title, channelId: t.channel_id, rootMsgId: t.root_msg_id ? Number(t.root_msg_id) : null, creator: req.user.display_name, lastAt: new Date().toISOString() };
    await sendToConv(req.params.id, { t: 'thread_new', convId: req.params.id, thread, by: req.user.id });
    res.json({ thread: { ...thread, mine: true } });
  }));

  app.delete('/api/threads/:tid', auth, byUser('thread-del', 20, 60_000), wrap(async (req, res) => {
    if (!isUuid(req.params.tid)) return bad(res, 'bad id');
    const t = (await q('select id,conv_id,created_by,title from threads where id=$1', [req.params.tid])).rows[0];
    if (!t) return bad(res, 'thread not found', 404);
    const m = await memberOf(req, res, t.conv_id); if (!m) return;
    const staff = isStaff(req.user, m.role);
    if (t.created_by !== req.user.id && !staff) return bad(res, 'only the creator or a mod can delete this', 403);
    await q('delete from threads where id=$1', [t.id]);
    if (staff && t.created_by !== req.user.id) audit.log(q, req.user, 'thread_delete', null, { convId: t.conv_id, convName: m.name, detail: t.title });
    await sendToConv(t.conv_id, { t: 'thread_gone', convId: t.conv_id, id: t.id });
    res.json({ ok: true });
  }));

  app.put('/api/me/calls', auth, byUser('calls-pref', 30, 60_000), wrap(async (req, res) => {
    const b = req.body || {};
    if (typeof b.off === 'boolean') await q('update users set calls_off=$2 where id=$1', [req.user.id, b.off]);
    if (b.pref === 'sound' || b.pref === 'title') await q('update users set call_pref=$2 where id=$1', [req.user.id, b.pref]);
    const u = (await q('select calls_off,call_pref from users where id=$1', [req.user.id])).rows[0];
    res.json({ callsOff: !!u.calls_off, callPref: u.call_pref || null });
  }));
}

async function resolveTarget(q, convId, channelId, threadId, isUuid) {
  if (channelId && !isUuid(channelId)) return { error: 'bad channel' };
  if (threadId && !isUuid(threadId)) return { error: 'bad thread' };
  if (channelId && threadId) return { error: 'pick a channel or a thread' };
  if (channelId) {
    const ch = (await q('select kind from channels where id=$1 and conv_id=$2', [channelId, convId])).rows[0];
    if (!ch) return { error: 'channel not found' };
    if (ch.kind !== 'text') return { error: 'that is not a text channel' };
  }
  if (threadId) {
    const t = (await q('select channel_id from threads where id=$1 and conv_id=$2', [threadId, convId])).rows[0];
    if (!t) return { error: 'thread not found' };
    return { channelId: null, threadId, parentChannel: t.channel_id };
  }
  return { channelId: channelId || null, threadId: null };
}

module.exports = { mount, resolveTarget };

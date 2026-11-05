const audit = require('./audit');
const safety = require('./safety');

const MAX_BOARDS = 5, MAX_STROKES = 4000, BW = 1000, BH = 700;
const HEX = /^#[0-9a-f]{6}$/i;

function mount(app, c) {
  const { q, auth, byUser, bad, wrap, isUuid, requireMember, sendToConv, sendTo, notify, isStaff, filter } = c;

  const memberOnly = async (req, res, convId) => {
    const r = (await q('select m.role,m.muted_until,cv.type,cv.name,cv.is_public,cv.system_kind from members m join conversations cv on cv.id=m.conv_id where m.conv_id=$1 and m.user_id=$2', [convId, req.user.id])).rows[0];
    if (!r) { bad(res, 'not a member', 403); return null; }
    if (r.type !== 'group' || r.system_kind) { bad(res, 'whiteboards are for groups'); return null; }
    return r;
  };
  const canWrite = (req, res, m) => {
    if (req.user.muted_until && new Date(req.user.muted_until) > new Date()) { bad(res, 'you are muted', 403); return false; }
    if (m.muted_until && new Date(m.muted_until) > new Date()) { bad(res, 'you are muted in this group', 403); return false; }
    if (m.is_public && !safety.verifiedOn(req.user) && !req.user.is_admin) { bad(res, 'verify your account to draw in public groups', 403); return false; }
    return true;
  };
  const boardOf = async (req, res) => {
    if (!isUuid(req.params.bid)) { bad(res, 'bad id'); return {}; }
    const b = (await q('select id,conv_id,title,created_by from boards where id=$1', [req.params.bid])).rows[0];
    if (!b) { bad(res, 'board not found', 404); return {}; }
    const m = await memberOnly(req, res, b.conv_id); if (!m) return {};
    return { b, m };
  };

  app.get('/api/conversations/:id/whiteboards', auth, byUser('boards-list', 60, 60_000), wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return bad(res, 'bad id');
    const m = await memberOnly(req, res, req.params.id); if (!m) return;
    const r = await q('select b.id,b.title,b.created_by,u.display_name creator,b.created_at,(select count(*)::int from board_strokes s where s.board_id=b.id) strokes from boards b left join users u on u.id=b.created_by where b.conv_id=$1 order by b.created_at desc', [req.params.id]);
    res.json({ boards: r.rows.map((x) => ({ id: x.id, title: x.title, creator: x.creator || 'former member', mine: x.created_by === req.user.id, strokes: x.strokes, createdAt: x.created_at })), max: MAX_BOARDS });
  }));

  app.post('/api/conversations/:id/whiteboards', auth, byUser('board-new', 10, 3_600_000), wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return bad(res, 'bad id');
    const m = await memberOnly(req, res, req.params.id); if (!m) return;
    if (!canWrite(req, res, m)) return;
    const title = String((req.body && req.body.title) || '').trim().replace(/\s+/g, ' ').slice(0, 40) || 'untitled board';
    if (filter.check(title)) return bad(res, 'keep the title clean');
    const n = (await q('select count(*)::int c from boards where conv_id=$1', [req.params.id])).rows[0].c;
    if (n >= MAX_BOARDS) return bad(res, `this group has ${MAX_BOARDS} boards already, delete one first`);
    const b = (await q('insert into boards(conv_id,title,created_by) values($1,$2,$3) returning id,title', [req.params.id, title, req.user.id])).rows[0];
    await sendToConv(req.params.id, { t: 'board_new', convId: req.params.id, id: b.id, title: b.title }, req.user.id);
    res.json({ board: { id: b.id, title: b.title } });
  }));

  app.get('/api/whiteboards/:bid', auth, byUser('board-get', 60, 60_000), wrap(async (req, res) => {
    const { b, m } = await boardOf(req, res); if (!b) return;
    const s = await q('select id,user_id,data from board_strokes where board_id=$1 order by id', [b.id]);
    res.json({ board: { id: b.id, convId: b.conv_id, title: b.title, mine: b.created_by === req.user.id, staff: isStaff(req.user, m.role), isPublic: m.is_public }, strokes: s.rows.map((x) => ({ id: Number(x.id), u: x.user_id, d: x.data })) });
  }));

  const cleanStroke = (d) => {
    if (!d || typeof d !== 'object') return null;
    const tool = d.k === 'text' ? 'text' : 'pen';
    const col = HEX.test(d.c || '') ? d.c.toLowerCase() : '#222222';
    const w = Math.min(40, Math.max(1, Math.round(Number(d.w) || 4)));
    const num = (v, hi) => Math.min(hi, Math.max(0, Math.round(Number(v) || 0)));
    if (tool === 'text') {
      const t = String(d.t || '').trim().slice(0, 40);
      if (!t || filter.check(t)) return t ? 'dirty' : null;
      return { k: 'text', c: col, w: Math.min(40, Math.max(10, w * 4)), t, x: num(d.x, BW), y: num(d.y, BH) };
    }
    if (!Array.isArray(d.p) || !d.p.length) return null;
    const p = d.p.slice(0, 400).map((pt) => [num(pt && pt[0], BW), num(pt && pt[1], BH)]);
    return { k: 'pen', c: col, w, p };
  };

  app.post('/api/whiteboards/:bid/strokes', auth, byUser('board-stroke', 240, 60_000), wrap(async (req, res) => {
    const { b, m } = await boardOf(req, res); if (!b) return;
    if (!canWrite(req, res, m)) return;
    const d = cleanStroke(req.body);
    if (d === 'dirty') return bad(res, 'keep it clean');
    if (!d) return bad(res, 'empty stroke');
    const n = (await q('select count(*)::int c from board_strokes where board_id=$1', [b.id])).rows[0].c;
    if (n >= MAX_STROKES) return bad(res, 'this board is full, ask a mod to clear it');
    const r = (await q('insert into board_strokes(board_id,user_id,data) values($1,$2,$3) returning id', [b.id, req.user.id, JSON.stringify(d)])).rows[0];
    await sendToConv(b.conv_id, { t: 'board_stroke', convId: b.conv_id, boardId: b.id, id: Number(r.id), u: req.user.id, d });
    res.json({ id: Number(r.id) });
  }));

  app.delete('/api/whiteboards/:bid/strokes/:sid', auth, byUser('board-undo', 120, 60_000), wrap(async (req, res) => {
    const { b, m } = await boardOf(req, res); if (!b) return;
    const sid = parseInt(req.params.sid, 10) || 0;
    const s = (await q('select user_id from board_strokes where id=$1 and board_id=$2', [sid, b.id])).rows[0];
    if (!s) return bad(res, 'gone', 404);
    if (s.user_id !== req.user.id && !isStaff(req.user, m.role)) return bad(res, 'only the artist or a mod can remove that', 403);
    await q('delete from board_strokes where id=$1', [sid]);
    await sendToConv(b.conv_id, { t: 'board_unstroke', convId: b.conv_id, boardId: b.id, id: sid });
    res.json({ ok: true });
  }));

  app.post('/api/whiteboards/:bid/clear', auth, byUser('board-clear', 20, 3_600_000), wrap(async (req, res) => {
    const { b, m } = await boardOf(req, res); if (!b) return;
    if (b.created_by !== req.user.id && !isStaff(req.user, m.role)) return bad(res, 'only the creator or a mod can clear it', 403);
    await q('delete from board_strokes where board_id=$1', [b.id]);
    audit.log(q, req.user, 'board_clear', null, { convId: b.conv_id, convName: m.name, detail: b.title });
    await sendToConv(b.conv_id, { t: 'board_clear', convId: b.conv_id, boardId: b.id });
    res.json({ ok: true });
  }));

  app.delete('/api/whiteboards/:bid', auth, byUser('board-del', 20, 3_600_000), wrap(async (req, res) => {
    const { b, m } = await boardOf(req, res); if (!b) return;
    if (b.created_by !== req.user.id && !isStaff(req.user, m.role)) return bad(res, 'only the creator or a mod can delete it', 403);
    await q('delete from boards where id=$1', [b.id]);
    if (b.created_by !== req.user.id) audit.log(q, req.user, 'board_delete', { id: b.created_by }, { convId: b.conv_id, convName: m.name, detail: b.title });
    await sendToConv(b.conv_id, { t: 'board_del', convId: b.conv_id, boardId: b.id });
    res.json({ ok: true });
  }));

  app.get('/api/admin/whiteboards/:bid', auth, wrap(async (req, res) => {
    if (!req.user.is_admin) return bad(res, 'forbidden', 403);
    if (!isUuid(req.params.bid)) return bad(res, 'bad id');
    const rep = (await q(`select 1 from reports where kind='board' and snapshot like $1 limit 1`, ['%' + req.params.bid + '%'])).rows[0];
    if (!rep) return bad(res, 'that board has not been reported', 403);
    const b = (await q('select id,title,conv_id from boards where id=$1', [req.params.bid])).rows[0];
    if (!b) return bad(res, 'board is gone', 404);
    const s = await q('select id,user_id,data from board_strokes where board_id=$1 order by id', [b.id]);
    res.json({ board: { id: b.id, convId: b.conv_id, title: b.title, mine: false, staff: true }, strokes: s.rows.map((x) => ({ id: Number(x.id), u: x.user_id, d: x.data })) });
  }));

  app.post('/api/admin/whiteboards/:bid/clear', auth, wrap(async (req, res) => {
    if (!req.user.is_admin) return bad(res, 'forbidden', 403);
    if (!isUuid(req.params.bid)) return bad(res, 'bad id');
    const b = (await q('select id,conv_id,title from boards where id=$1', [req.params.bid])).rows[0];
    if (!b) return bad(res, 'board is gone', 404);
    await q('delete from board_strokes where board_id=$1', [b.id]);
    audit.log(q, req.user, 'board_clear', null, { convId: b.conv_id, detail: b.title });
    await sendToConv(b.conv_id, { t: 'board_clear', convId: b.conv_id, boardId: b.id });
    res.json({ ok: true });
  }));

  // ---------- game nights ----------
  const nightView = (x, me) => ({ id: x.id, title: x.title, gamePath: x.game_path || null, gameTitle: x.game_title || null, startsAt: x.starts_at, creator: x.creator || 'someone', going: x.going, mine: !!x.mine, mineCreated: x.created_by === me });

  app.get('/api/conversations/:id/nights', auth, byUser('nights-list', 60, 60_000), wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return bad(res, 'bad id');
    const m = await memberOnly(req, res, req.params.id); if (!m) return;
    const r = await q(`select n.*,u.display_name creator,(select count(*)::int from game_night_rsvp r where r.night_id=n.id) going,exists(select 1 from game_night_rsvp r where r.night_id=n.id and r.user_id=$2) mine
      from game_nights n left join users u on u.id=n.created_by where n.conv_id=$1 and n.starts_at > now() - interval '2 hours' order by n.starts_at`, [req.params.id, req.user.id]);
    res.json({ nights: r.rows.map((x) => nightView(x, req.user.id)) });
  }));

  app.post('/api/conversations/:id/nights', auth, byUser('night-new', 10, 3_600_000), wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return bad(res, 'bad id');
    const m = await memberOnly(req, res, req.params.id); if (!m) return;
    if (!isStaff(req.user, m.role)) return bad(res, 'only the host or a mod can plan a game night', 403);
    const b = req.body || {};
    const title = String(b.title || '').trim().replace(/\s+/g, ' ').slice(0, 50);
    if (title.length < 2) return bad(res, 'give the night a name');
    if (filter.check(title)) return bad(res, 'keep it clean');
    const at = new Date(b.startsAt);
    if (isNaN(at) || at < new Date(Date.now() - 60_000) || at > new Date(Date.now() + 30 * 86400_000)) return bad(res, 'pick a time in the next 30 days');
    const n = (await q('select count(*)::int c from game_nights where conv_id=$1 and starts_at > now()', [req.params.id])).rows[0].c;
    if (n >= 5) return bad(res, 'max 5 upcoming game nights');
    const gp = typeof b.gamePath === 'string' ? b.gamePath.slice(0, 200) : null, gt = typeof b.gameTitle === 'string' ? b.gameTitle.slice(0, 80) : null;
    const r = (await q('insert into game_nights(conv_id,title,game_path,game_title,starts_at,created_by) values($1,$2,$3,$4,$5,$6) returning id', [req.params.id, title, gp, gt, at.toISOString(), req.user.id])).rows[0];
    await q('insert into game_night_rsvp(night_id,user_id) values($1,$2) on conflict do nothing', [r.id, req.user.id]);
    await sendToConv(req.params.id, { t: 'night_new', convId: req.params.id, id: r.id, title }, req.user.id);
    res.json({ id: r.id });
  }));

  app.post('/api/nights/:nid/rsvp', auth, byUser('night-rsvp', 60, 3_600_000), wrap(async (req, res) => {
    if (!isUuid(req.params.nid)) return bad(res, 'bad id');
    const n = (await q('select id,conv_id from game_nights where id=$1', [req.params.nid])).rows[0];
    if (!n) return bad(res, 'not found', 404);
    const m = await memberOnly(req, res, n.conv_id); if (!m) return;
    if (req.body && req.body.going === false) await q('delete from game_night_rsvp where night_id=$1 and user_id=$2', [n.id, req.user.id]);
    else await q('insert into game_night_rsvp(night_id,user_id) values($1,$2) on conflict do nothing', [n.id, req.user.id]);
    res.json({ ok: true });
  }));

  app.delete('/api/nights/:nid', auth, byUser('night-del', 30, 3_600_000), wrap(async (req, res) => {
    if (!isUuid(req.params.nid)) return bad(res, 'bad id');
    const n = (await q('select id,conv_id,created_by from game_nights where id=$1', [req.params.nid])).rows[0];
    if (!n) return bad(res, 'not found', 404);
    const m = await memberOnly(req, res, n.conv_id); if (!m) return;
    if (n.created_by !== req.user.id && !isStaff(req.user, m.role)) return bad(res, 'not yours to cancel', 403);
    await q('delete from game_nights where id=$1', [n.id]);
    res.json({ ok: true });
  }));

  const tick = setInterval(async () => {
    try {
      const due = (await q(`select n.id,n.conv_id,n.title,n.game_path,n.game_title,cv.name from game_nights n join conversations cv on cv.id=n.conv_id where not n.notified and n.starts_at <= now() + interval '1 minute' and n.starts_at > now() - interval '2 hours' limit 20`)).rows;
      for (const n of due) {
        await q('update game_nights set notified=true where id=$1', [n.id]);
        const going = (await q('select user_id from game_night_rsvp where night_id=$1', [n.id])).rows;
        for (const g of going) { notify(g.user_id, 'game_night', { convId: n.conv_id, title: n.title, convName: n.name, gamePath: n.game_path }).catch(() => {}); }
      }
      await q(`delete from game_nights where starts_at < now() - interval '1 day'`);
    } catch (e) { console.error('night tick', e.message); }
  }, 60_000);
  tick.unref();
}

module.exports = { mount };

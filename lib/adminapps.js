const audit = require('./audit');
const safety = require('./safety');

const COOLDOWN_MS = 14 * 24 * 3600_000;
const MIN_AGE_MS = 3 * 24 * 3600_000;

function mount(app, c) {
  const { q, auth, adminOnly, ownerOnly, byUser, bad, wrap, sendTo, notify } = c;

  const isOpen = async () => {
    const r = (await q("select value from settings where key='admin_apps_open'")).rows[0];
    return !r || r.value !== 'off';
  };
  const clean = (s, max) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, max);
  const shape = (x) => x && ({ id: Number(x.id), status: x.status, response: x.response || '', createdAt: x.created_at, decidedAt: x.decided_at });

  app.get('/api/admin-apps/mine', auth, byUser('aa-mine', 60, 60_000), wrap(async (req, res) => {
    const last = (await q('select id,status,response,created_at,decided_at from admin_apps where user_id=$1 order by id desc limit 1', [req.user.id])).rows[0];
    const open = await isOpen();
    const age = Date.now() - new Date(req.user.created_at).getTime();
    let why = '';
    if (req.user.is_admin) why = 'you are already an admin';
    else if (!open) why = 'applications are closed right now';
    else if (!safety.verifiedOn(req.user)) why = 'verify your account first';
    else if (age < MIN_AGE_MS) why = 'your account needs to be 3 days old';
    else if (last && last.status === 'pending') why = 'your application is waiting for a decision';
    else if (last && last.decided_at && Date.now() - new Date(last.decided_at) < COOLDOWN_MS) why = 'you can apply again 14 days after the last decision';
    res.json({ open, canApply: !why, why, last: shape(last) });
  }));

  app.post('/api/admin-apps', auth, byUser('aa-new', 5, 3_600_000), wrap(async (req, res) => {
    const u = req.user;
    if (u.is_admin) return bad(res, 'you are already an admin');
    if (!(await isOpen())) return bad(res, 'applications are closed right now', 403);
    if (!safety.verifiedOn(u)) return bad(res, 'verify your account first', 403);
    if (Date.now() - new Date(u.created_at).getTime() < MIN_AGE_MS) return bad(res, 'your account needs to be 3 days old', 403);
    const b = req.body || {};
    const why = clean(b.why, 600), exp = clean(b.experience, 400), hours = clean(b.hours, 40), handle = clean(b.scenario, 400);
    if (why.length < 40) return bad(res, 'tell us more about why you want to be an admin (40+ characters)');
    if (handle.length < 20) return bad(res, 'answer the scenario question in a sentence or two');
    if (!hours) return bad(res, 'say roughly how many hours a week you could help');
    if ([why, exp, handle, hours].some((t) => safety.F.check(t))) return bad(res, 'keep it respectful');
    const last = (await q('select status,decided_at from admin_apps where user_id=$1 order by id desc limit 1', [u.id])).rows[0];
    if (last && last.status === 'pending') return bad(res, 'you already have an application waiting', 409);
    if (last && last.decided_at && Date.now() - new Date(last.decided_at) < COOLDOWN_MS) return bad(res, 'you can apply again 14 days after the last decision', 409);
    await q('insert into admin_apps(user_id,why,experience,hours,scenario) values($1,$2,$3,$4,$5)', [u.id, why, exp, hours, handle]);
    for (const a of (await q('select id from users where is_admin and not banned')).rows) { notify(a.id, 'adminapp_new', { by: u.display_name, username: u.username }).catch(() => {}); sendTo(a.id, { t: 'adminapps_changed' }); }
    res.json({ ok: true });
  }));

  app.get('/api/admin/admin-apps', auth, adminOnly, byUser('aa-list', 60, 60_000), wrap(async (req, res) => {
    const all = req.query.status === 'all';
    const r = await q(`select a.id,a.why,a.experience,a.hours,a.scenario,a.status,a.response,a.created_at,a.decided_at,u.id user_id,u.username,u.display_name,u.msg_count,u.created_at joined,u.is_admin, d.username decider
      from admin_apps a join users u on u.id=a.user_id left join users d on d.id=a.decided_by ${all ? '' : "where a.status='pending'"} order by a.id desc limit 60`);
    res.json({
      open: await isOpen(),
      canDecide: req.user.username === c.ownerName,
      apps: r.rows.map((x) => ({ id: Number(x.id), why: x.why, experience: x.experience || '', hours: x.hours, scenario: x.scenario, status: x.status, response: x.response || '', createdAt: x.created_at, decidedAt: x.decided_at, userId: x.user_id, username: x.username, displayName: x.display_name, messages: Number(x.msg_count || 0), joined: x.joined, isAdmin: !!x.is_admin, decidedBy: x.decider || null }))
    });
  }));

  app.post('/api/admin/admin-apps/:id', auth, adminOnly, ownerOnly, byUser('aa-decide', 40, 60_000), wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const approve = !!(req.body && req.body.approve);
    const response = clean(req.body && req.body.response, 300);
    const a = (await q('select a.id,a.user_id,u.username,u.display_name,u.banned from admin_apps a join users u on u.id=a.user_id where a.id=$1 and a.status=\'pending\'', [id])).rows[0];
    if (!a) return bad(res, 'already answered', 404);
    if (approve && a.banned) return bad(res, 'that account is suspended');
    await q('update admin_apps set status=$2,response=$3,decided_by=$4,decided_at=now() where id=$1', [id, approve ? 'approved' : 'denied', response || null, req.user.id]);
    if (approve) {
      await q('update users set is_admin=true where id=$1', [a.user_id]);
      const nu = (await q('select * from users where id=$1', [a.user_id])).rows[0];
      safety.ensureSystem(q, nu).catch(() => {});
      audit.log(q, req.user, 'admin_add', { id: a.user_id, username: a.username }, { detail: 'from application' });
    } else audit.log(q, req.user, 'adminapp_denied', { id: a.user_id, username: a.username }, { detail: response });
    notify(a.user_id, 'adminapp_result', { approved: approve, response }).catch(() => {});
    sendTo(a.user_id, { t: 'me_update' });
    for (const ad of (await q('select id from users where is_admin and not banned')).rows) sendTo(ad.id, { t: 'adminapps_changed' });
    res.json({ ok: true });
  }));

  app.put('/api/owner/admin-apps/open', auth, adminOnly, ownerOnly, wrap(async (req, res) => {
    const on = !!(req.body && req.body.open);
    await q("insert into settings(key,value) values('admin_apps_open',$1) on conflict(key) do update set value=$1", [on ? 'on' : 'off']);
    res.json({ open: on });
  }));
}

module.exports = { mount };

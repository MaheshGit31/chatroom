const audit = require('./audit');

const COLORS = /^#[0-9a-f]{6}$/i;
const MAX_ROLES = 12;

async function gateRules(q, user, m, convId, isStaff) {
  const c = (await q('select rules_on,rules_ver from conversations where id=$1', [convId])).rows[0];
  if (!c || !c.rules_on || isStaff(user, m.role)) return null;
  const ok = (await q('select rules_ver_ok from members where conv_id=$1 and user_id=$2', [convId, user.id])).rows[0];
  if (ok && ok.rules_ver_ok >= c.rules_ver) return null;
  return { status: 403, body: { error: 'rules_required', message: 'read and accept the group rules before you can post' } };
}

function mount(app, c) {
  const { q, auth, byUser, bad, wrap, isUuid, requireMember, sendToConv, filter } = c;
  const refresh = (id) => sendToConv(id, { t: 'conv_update', convId: id, refresh: true }).catch(() => {});
  const host = async (req, res) => {
    const m = await requireMember(req, res); if (!m) return null;
    if (m.type !== 'group' || (m.system_kind && !req.user.is_admin)) { bad(res, 'only normal groups have roles'); return null; }
    if (m.role !== 'admin' && !req.user.is_admin) { bad(res, 'only the host can do that', 403); return null; }
    return m;
  };

  app.post('/api/conversations/:id/roles', auth, byUser('role-make', 30, 3_600_000), wrap(async (req, res) => {
    const m = await host(req, res); if (!m) return;
    const name = String((req.body && req.body.name) || '').trim().replace(/\s+/g, ' ').slice(0, 20);
    const color = COLORS.test((req.body && req.body.color) || '') ? req.body.color.toLowerCase() : '#c9a227';
    if (name.length < 2) return bad(res, 'give the role a name');
    if (filter && filter.checkName(name)) return bad(res, 'keep role names clean');
    const n = (await q('select count(*)::int c from group_roles where conv_id=$1', [req.params.id])).rows[0].c;
    if (n >= MAX_ROLES) return bad(res, `max ${MAX_ROLES} roles`);
    if ((await q('select 1 from group_roles where conv_id=$1 and lower(name)=lower($2)', [req.params.id, name])).rows[0]) return bad(res, 'that role exists', 409);
    const r = (await q('insert into group_roles(conv_id,name,color) values($1,$2,$3) returning id,name,color', [req.params.id, name, color])).rows[0];
    audit.log(q, req.user, 'role_create', null, { convId: req.params.id, convName: m.name, detail: name });
    await refresh(req.params.id);
    res.json({ role: r });
  }));

  app.patch('/api/conversations/:id/roles/:rid', auth, byUser('role-edit', 60, 3_600_000), wrap(async (req, res) => {
    const m = await host(req, res); if (!m) return;
    if (!isUuid(req.params.rid)) return bad(res, 'bad id');
    const b = req.body || {};
    const name = b.name == null ? null : String(b.name).trim().replace(/\s+/g, ' ').slice(0, 20);
    if (name !== null && (name.length < 2 || (filter && filter.checkName(name)))) return bad(res, 'bad role name');
    const color = b.color != null && COLORS.test(b.color) ? b.color.toLowerCase() : null;
    const r = await q('update group_roles set name=coalesce($3,name), color=coalesce($4,color) where id=$2 and conv_id=$1 returning id,name,color', [req.params.id, req.params.rid, name, color]);
    if (!r.rows[0]) return bad(res, 'no such role', 404);
    await refresh(req.params.id);
    res.json({ role: r.rows[0] });
  }));

  app.delete('/api/conversations/:id/roles/:rid', auth, byUser('role-del', 60, 3_600_000), wrap(async (req, res) => {
    const m = await host(req, res); if (!m) return;
    if (!isUuid(req.params.rid)) return bad(res, 'bad id');
    const r = await q('delete from group_roles where id=$2 and conv_id=$1 returning name', [req.params.id, req.params.rid]);
    if (!r.rows[0]) return bad(res, 'no such role', 404);
    audit.log(q, req.user, 'role_delete', null, { convId: req.params.id, convName: m.name, detail: r.rows[0].name });
    await refresh(req.params.id);
    res.json({ ok: true });
  }));

  app.put('/api/conversations/:id/roles/:rid/members/:uid', auth, byUser('role-give', 120, 3_600_000), wrap(async (req, res) => {
    const m = await host(req, res); if (!m) return;
    if (!isUuid(req.params.rid) || !isUuid(req.params.uid)) return bad(res, 'bad id');
    const role = (await q('select name from group_roles where id=$2 and conv_id=$1', [req.params.id, req.params.rid])).rows[0];
    if (!role) return bad(res, 'no such role', 404);
    const t = (await q('select u.id,u.username from members mm join users u on u.id=mm.user_id where mm.conv_id=$1 and mm.user_id=$2', [req.params.id, req.params.uid])).rows[0];
    if (!t) return bad(res, 'they are not in this group', 404);
    if (req.body && req.body.on === false) await q('delete from member_roles where role_id=$1 and user_id=$2', [req.params.rid, t.id]);
    else {
      const n = (await q('select count(*)::int c from member_roles where conv_id=$1 and user_id=$2', [req.params.id, t.id])).rows[0].c;
      if (n >= 3) return bad(res, 'max 3 roles per person');
      await q('insert into member_roles(conv_id,user_id,role_id) values($1,$2,$3) on conflict do nothing', [req.params.id, t.id, req.params.rid]);
    }
    audit.log(q, req.user, req.body && req.body.on === false ? 'role_take' : 'role_give', t, { convId: req.params.id, convName: m.name, detail: role.name });
    await refresh(req.params.id);
    res.json({ ok: true });
  }));

  app.put('/api/conversations/:id/rules', auth, byUser('rules-set', 30, 3_600_000), wrap(async (req, res) => {
    const m = await host(req, res); if (!m) return;
    const text = String((req.body && req.body.text) || '').trim().slice(0, 1200);
    const on = !!(req.body && req.body.on) && text.length >= 5;
    if (req.body && req.body.on && text.length < 5) return bad(res, 'write the rules first');
    if (filter && text && filter.check(text)) return bad(res, 'keep the rules clean');
    await q('update conversations set rules=$2, rules_on=$3, rules_ver=rules_ver+(case when rules is distinct from $2 then 1 else 0 end) where id=$1', [req.params.id, text || null, on]);
    audit.log(q, req.user, on ? 'rules_set' : 'rules_off', null, { convId: req.params.id, convName: m.name });
    await refresh(req.params.id);
    res.json({ ok: true });
  }));

  app.post('/api/conversations/:id/rules/accept', auth, byUser('rules-accept', 30, 60_000), wrap(async (req, res) => {
    const m = await requireMember(req, res); if (!m) return;
    await q('update members set rules_ver_ok=(select rules_ver from conversations where id=$1) where conv_id=$1 and user_id=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  }));
}

module.exports = { mount, gateRules };

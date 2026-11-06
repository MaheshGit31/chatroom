const audit = require('./audit');
const safety = require('./safety');

const NEED = 2, WEEKLY = 3, MAX_STRIKES = 2, MIN_VOUCHER_AGE_H = 24;

function mount(app, c) {
  const { q, auth, byUser, bad, wrap, isUuid, sendTo, notify, adminOnly } = c;

  const byName = async (name) => {
    const n = String(name || '').trim().toLowerCase().replace(/^@/, '').slice(0, 32);
    if (!n) return null;
    return (await q('select * from users where username=$1', [n])).rows[0] || null;
  };
  const goodVouchers = async (targetId) => (await q(`select u.id,u.username,u.display_name from vouches v join users u on u.id=v.voucher where v.vouchee=$1 and not u.banned and (u.verified or u.is_admin) order by v.created_at`, [targetId])).rows;
  const voucherOk = (u) => {
    if (u.banned) return 'your account is suspended';
    if (!safety.verifiedOn(u)) return 'only verified people can vouch';
    if ((u.vouch_strikes || 0) >= MAX_STRIKES) return 'you can no longer vouch, people you vouched for broke the rules';
    if (!u.is_admin && u.verified_at && Date.now() - new Date(u.verified_at) < MIN_VOUCHER_AGE_H * 3600_000) return `you can vouch ${MIN_VOUCHER_AGE_H} hours after you get verified`;
    return null;
  };

  app.get('/api/vouch/status', auth, byUser('vouch-status', 60, 60_000), wrap(async (req, res) => {
    const mine = await goodVouchers(req.user.id);
    const why = voucherOk(req.user);
    const given = (await q('select u.username,u.display_name,(u.verified or u.is_admin) verified from vouches v join users u on u.id=v.vouchee where v.voucher=$1 order by v.created_at desc limit 20', [req.user.id])).rows;
    const week = (await q(`select count(*)::int c from vouches where voucher=$1 and created_at>now()-interval '7 days'`, [req.user.id])).rows[0].c;
    res.json({
      need: NEED, verified: safety.verifiedOn(req.user), via: req.user.verified_via || null,
      vouchers: mine.map((x) => ({ username: x.username, displayName: x.display_name })),
      canVouch: !why, whyNot: why, left: Math.max(0, WEEKLY - week), weekly: WEEKLY,
      given: given.map((x) => ({ username: x.username, displayName: x.display_name, verified: !!x.verified }))
    });
  }));

  app.post('/api/vouch/ask', auth, byUser('vouch-ask', 8, 3_600_000), wrap(async (req, res) => {
    if (safety.verifiedOn(req.user)) return bad(res, 'you are already verified');
    const t = await byName(req.body && req.body.username);
    if (!t || t.banned || t.id === req.user.id) return bad(res, 'no one by that name', 404);
    if (!safety.verifiedOn(t)) return bad(res, 'they are not verified yet, so they cannot vouch');
    await notify(t.id, 'vouch_ask', { from: req.user.display_name, username: req.user.username });
    res.json({ ok: true });
  }));

  app.post('/api/vouch', auth, byUser('vouch', 10, 3_600_000), wrap(async (req, res) => {
    const why = voucherOk(req.user);
    if (why) return bad(res, why, 403);
    const t = await byName(req.body && req.body.username);
    if (!t || t.banned) return bad(res, 'no one by that name', 404);
    if (t.id === req.user.id) return bad(res, 'you cannot vouch for yourself');
    if (safety.verifiedOn(t)) return bad(res, 'they are already verified');
    const shared = (await q(`select 1 from members a join members b on a.conv_id=b.conv_id join conversations cv on cv.id=a.conv_id where a.user_id=$1 and b.user_id=$2 and cv.system_kind is null limit 1`, [req.user.id, t.id])).rows[0];
    if (!shared) return bad(res, 'you can only vouch for people you share a chat or group with, outside the built-in rooms');
    if ((t.msg_count || 0) < 3) return bad(res, 'they need to chat a little first');
    if ((await q('select 1 from vouches where voucher=$1 and vouchee=$2', [req.user.id, t.id])).rows[0]) return bad(res, 'you already vouched for them');
    const week = (await q(`select count(*)::int c from vouches where voucher=$1 and created_at>now()-interval '7 days'`, [req.user.id])).rows[0].c;
    if (week >= WEEKLY && !req.user.is_admin) return bad(res, `you can vouch for ${WEEKLY} people a week`);
    await q('insert into vouches(voucher,vouchee) values($1,$2)', [req.user.id, t.id]);
    const all = await goodVouchers(t.id);
    audit.log(q, req.user, 'vouch', { id: t.id, username: t.username }, { detail: `${all.length}/${NEED}` });
    if (all.length >= NEED) {
      await safety.setVerified(t.id, true);
      await q(`update users set verified_via='vouch' where id=$1`, [t.id]);
      audit.log(q, null, 'verify_vouched', { id: t.id, username: t.username }, { detail: all.map((x) => x.username).join(', ') });
      await notify(t.id, 'vouch_done', { by: all.map((x) => x.display_name) });
      for (const v of all) if (v.id !== req.user.id) await notify(v.id, 'vouch_used', { name: t.display_name });
      return res.json({ ok: true, verified: true, count: all.length });
    }
    await notify(t.id, 'vouch_got', { from: req.user.display_name, count: all.length, need: NEED });
    res.json({ ok: true, verified: false, count: all.length });
  }));

  app.delete('/api/vouch/:username', auth, byUser('vouch-del', 20, 3_600_000), wrap(async (req, res) => {
    const t = await byName(req.params.username);
    if (!t) return bad(res, 'no one by that name', 404);
    if (safety.verifiedOn(t)) return bad(res, 'they are verified already, ask an admin if there is a problem');
    await q('delete from vouches where voucher=$1 and vouchee=$2', [req.user.id, t.id]);
    res.json({ ok: true });
  }));

  app.get('/api/admin/users/:id/vouches', auth, adminOnly, byUser('vouch-admin', 60, 60_000), wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return bad(res, 'bad id');
    const u = (await q('select id,username,display_name,verified,verified_via,vouch_strikes,banned from users where id=$1', [req.params.id])).rows[0];
    if (!u) return bad(res, 'not found', 404);
    const from = (await q('select x.id,x.username,x.display_name,x.banned,(x.verified or x.is_admin) verified,v.created_at from vouches v join users x on x.id=v.voucher where v.vouchee=$1 order by v.created_at', [u.id])).rows;
    const to = (await q('select x.id,x.username,x.display_name,x.banned,(x.verified or x.is_admin) verified,v.created_at from vouches v join users x on x.id=v.vouchee where v.voucher=$1 order by v.created_at desc', [u.id])).rows;
    const map = (x) => ({ id: x.id, username: x.username, displayName: x.display_name, banned: x.banned, verified: !!x.verified, at: x.created_at });
    res.json({ user: { id: u.id, username: u.username, displayName: u.display_name, verified: !!u.verified, via: u.verified_via || null, strikes: u.vouch_strikes || 0, banned: u.banned }, vouchedBy: from.map(map), vouchedFor: to.map(map) });
  }));

  app.post('/api/admin/users/:id/vouch-reset', auth, adminOnly, byUser('vouch-reset', 20, 60_000), wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return bad(res, 'bad id');
    await q('update users set vouch_strikes=0 where id=$1', [req.params.id]);
    res.json({ ok: true });
  }));
}

async function onBan(q, target) {
  try {
    if (!target || target.verified_via !== 'vouch') return;
    const v = (await q('select voucher from vouches where vouchee=$1', [target.id])).rows;
    for (const x of v) {
      const r = (await q('update users set vouch_strikes=vouch_strikes+1 where id=$1 returning vouch_strikes', [x.voucher])).rows[0];
      await q('insert into notifications(user_id,type,data) values($1,$2,$3)', [x.voucher, 'vouch_strike', { name: target.display_name, strikes: r ? r.vouch_strikes : 1, max: MAX_STRIKES }]);
    }
  } catch (e) { console.error('vouch onBan', e.message); }
}

module.exports = { mount, onBan, NEED };

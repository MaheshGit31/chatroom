/* ===== Chatroom client: mod tools, admin panes (appeals, audit log, stats), appeal screen, and app start ===== */
(() => {
'use strict';
const C = window.__core, U = window.__ui;
const { S, el, ic, avatar, api, toast, fmtTime, fmtDay, ago } = C;
const { modal, confirmModal } = U;
const X = window.__ext;

const when = (t) => `${fmtDay(t).toLowerCase()} ${fmtTime(t)}`;

// ---------- group mod tools ----------
function memberTools(c, u, redraw) {
  if (c.type !== 'group' || u.id === S.me.id || U.myRank(c) < 1 || U.myRank(c) <= U.rankR(u.isAdmin, u.role)) return [];
  return [el('button', { class: 'icon-btn', title: 'mod tools', onclick: () => modToolsModal(c, u, redraw) }, ic('hammer', 16))];
}
function modToolsModal(c, u, redraw) {
  const run = async (fn, msg) => { try { await fn(); toast(msg, 'success'); mm.close(); redraw && redraw(); } catch (e) { toast(e.message, 'error'); } };
  const mute = (mins, label) => el('button', { class: 'btn small', onclick: () => run(() => api('POST', `/api/conversations/${c.id}/mutes/${u.id}`, { minutes: mins }), `${u.displayName} muted for ${label}`) }, label);
  const isHost = c.role === 'admin' || S.me.isAdmin;
  const mm = modal('@' + u.username, el('div', null,
    el('h4', { style: 'margin-top:0' }, ic('mute', 14), 'mute in this group'),
    el('div', { class: 'row gap wraprow' }, mute(5, '5 min'), mute(60, '1 hour'), mute(1440, '1 day'), mute(10080, '1 week')),
    el('button', { class: 'btn small wide', style: 'margin-top:8px', onclick: () => run(() => api('DELETE', `/api/conversations/${c.id}/mutes/${u.id}`), 'unmuted') }, 'unmute'),
    isHost && u.role !== 'admin' ? el('div', null, el('h4', null, ic('shield', 14), 'moderator'),
      el('button', { class: 'btn wide', onclick: () => run(() => api('POST', `/api/conversations/${c.id}/mods/${u.id}`, { on: u.role !== 'mod' }), u.role === 'mod' ? 'mod removed' : 'now a mod') }, u.role === 'mod' ? 'remove mod' : 'make mod')) : null));
}
function staffSection(c, redraw) {
  if (c.type !== 'group' || U.myRank(c) < 1) return null;
  const sel = el('select', null, [[0, 'off'], [5, '5 seconds'], [10, '10 seconds'], [30, '30 seconds'], [60, '1 minute'], [300, '5 minutes'], [900, '15 minutes']].map(([v, l]) => el('option', { value: v, selected: (c.slowSeconds || 0) === v }, l)));
  sel.addEventListener('change', async () => { try { await api('PUT', `/api/conversations/${c.id}/slow`, { seconds: +sel.value }); c.slowSeconds = +sel.value || null; toast(+sel.value ? 'slow mode on' : 'slow mode off', 'success'); U.renderHeader(); X.drawModbar(c); } catch (e) { toast(e.message, 'error'); sel.value = c.slowSeconds || 0; } });
  return el('div', null, el('h4', null, ic('timer', 14), 'slow mode'), el('div', { class: 'row gap' }, sel, el('button', { class: 'btn', onclick: () => modlogModal(c) }, ic('list', 16), 'mod log')),
    el('p', { class: 'muted small' }, 'mods and hosts are not slowed down. type /help in the chat for mod commands.'));
}
async function modlogModal(c) {
  const body = el('div', null, el('div', { class: 'muted pad' }, '...'));
  modal('mod log', body, { wide: true });
  try {
    const d = await api('GET', `/api/conversations/${c.id}/modlog`, null, { quiet: true });
    body.replaceChildren(...(d.log.length ? d.log.map(logRow) : [el('div', { class: 'muted pad' }, 'nothing yet')]));
  } catch (e) { body.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
}
const ACTION_LABEL = (a) => String(a).replace(/_/g, ' ');
function logRow(r) {
  return el('div', { class: 'logrow' }, el('span', { class: 'logwhen' }, when(r.at)), el('span', { class: 'logact' }, ACTION_LABEL(r.action)),
    el('span', { class: 'grow' }, el('b', null, r.actor || 'system'), r.target ? ' → ' + r.target : '', r.conv ? el('i', null, ' in ' + r.conv) : null, r.detail ? el('span', { class: 'muted' }, ' · ' + r.detail) : null));
}

// ---------- admin: appeals ----------
async function adminAppeals(box, reload) {
  box.replaceChildren(el('div', { class: 'muted pad' }, '...'));
  try {
    const d = await api('GET', '/api/admin/appeals?status=all', null, { quiet: true });
    if (!d.appeals.length) return box.replaceChildren(el('div', { class: 'empty-s' }, el('div', null, 'no appeals')));
    box.replaceChildren(...d.appeals.map((a, i) => el('div', { class: 'arow appeal', style: `--i:${Math.min(i, 12)}` },
      avatar(a.displayName, 40),
      el('div', { class: 'grow' },
        el('div', { class: 'ctitle' }, a.displayName, el('span', { class: 'tag ' + (a.status === 'pending' ? 'gold' : '') }, a.status)),
        el('div', { class: 'muted small' }, `@${a.username} · ${a.messages} msgs · ${ago(a.createdAt)}${a.banned ? '' : ' · not suspended now'}`),
        a.banReason ? el('div', { class: 'small' }, el('b', null, 'suspended for: '), a.banReason) : null,
        el('div', { class: 'appealmsg' }, a.message),
        a.status !== 'pending' && a.response ? el('div', { class: 'small muted' }, `answer${a.decidedBy ? ' by ' + a.decidedBy : ''}: ${a.response}`) : null),
      a.status === 'pending' ? el('button', { class: 'btn small primary', onclick: () => decideModal(a, () => { adminAppeals(box, reload); reload && reload(); }) }, 'answer') : null)));
  } catch (e) { box.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
}
function decideModal(a, done) {
  const resp = el('textarea', { rows: 3, maxLength: 300, placeholder: 'reply to them (optional)' });
  const go = async (approve) => {
    try { await api('POST', `/api/admin/appeals/${a.id}`, { approve, response: resp.value.trim() }, { quiet: true }); toast(approve ? `@${a.username} is unsuspended` : 'appeal denied', 'success'); mm.close(); done && done(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const mm = modal('appeal from @' + a.username, el('div', null, a.banReason ? el('p', { class: 'small', style: 'margin-top:0' }, el('b', null, 'suspended for: '), a.banReason) : null, el('div', { class: 'appealmsg' }, a.message), resp,
    el('div', { class: 'row gap', style: 'margin-top:10px' }, el('button', { class: 'btn danger grow', onclick: () => go(false) }, 'deny'), el('button', { class: 'btn primary grow', onclick: () => go(true) }, 'approve + unsuspend'))));
}

// ---------- admin: audit log ----------
async function adminAudit(box) {
  const who = el('input', { placeholder: 'filter by username', maxLength: 20 });
  const act = el('select', null, el('option', { value: '' }, 'every action'), ...['ban', 'unban', 'gmute', 'ungmute', 'warn', 'verify', 'unverify', 'beta_grant', 'beta_clear', 'delete_msg', 'kick', 'group_mute', 'announce', 'appeal_approve', 'appeal_deny'].map((a) => el('option', { value: a }, ACTION_LABEL(a))));
  const list = el('div', { class: 'loglist' });
  const more = el('button', { class: 'btn wide', style: 'display:none', onclick: () => load(true) }, 'older');
  let last = 0;
  const load = async (append) => {
    if (!append) { last = 0; list.replaceChildren(el('div', { class: 'muted pad' }, '...')); }
    try {
      const qs = new URLSearchParams({ q: who.value.trim().replace(/^@/, ''), action: act.value }); if (append && last) qs.set('before', last);
      const d = await api('GET', '/api/admin/audit?' + qs, null, { quiet: true });
      if (!append) list.replaceChildren();
      if (!d.log.length && !append) list.replaceChildren(el('div', { class: 'muted pad' }, 'nothing found'));
      d.log.forEach((r) => list.append(logRow(r)));
      if (d.log.length) last = d.log[d.log.length - 1].id;
      more.style.display = d.more ? '' : 'none';
    } catch (e) { list.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
  };
  who.addEventListener('input', C.debounce(() => load(false), 300)); act.addEventListener('change', () => load(false));
  box.replaceChildren(el('div', { class: 'row gap' }, who, act), el('p', { class: 'muted small' }, 'every admin and mod action is kept for 90 days.'), list, more);
  load(false);
}

// ---------- admin: stats ----------
function barChart(days, key, label) {
  const W = 320, H = 110, pad = 18, n = days.length, bw = (W - pad) / n;
  const max = Math.max(1, ...days.map((d) => +d[key] || 0));
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H + 18}`); svg.setAttribute('class', 'barchart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label);
  days.forEach((d, i) => {
    const v = +d[key] || 0, h = Math.max(v ? 2 : 0, (v / max) * H);
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', pad + i * bw + 1.5); r.setAttribute('y', H - h); r.setAttribute('width', Math.max(2, bw - 3)); r.setAttribute('height', h); r.setAttribute('rx', 2);
    const t = document.createElementNS(NS, 'title'); t.textContent = `${d.day}: ${v}`; r.append(t); svg.append(r);
    if (i % 3 === 0 || i === n - 1) { const tx = document.createElementNS(NS, 'text'); tx.setAttribute('x', pad + i * bw + bw / 2); tx.setAttribute('y', H + 13); tx.setAttribute('text-anchor', 'middle'); tx.textContent = d.day.slice(8); svg.append(tx); }
  });
  const top = document.createElementNS(NS, 'text'); top.setAttribute('x', 0); top.setAttribute('y', 9); top.textContent = max; svg.append(top);
  return el('div', { class: 'chartcard' }, el('div', { class: 'ctitle' }, label), el('div', { class: 'muted small' }, `last 14 days · ${days.reduce((a, d) => a + (+d[key] || 0), 0)} total`), svg);
}
const fmtBytes = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB');
async function adminStats(box) {
  box.replaceChildren(el('div', { class: 'muted pad' }, '...'));
  try {
    const { totals: t, days } = await api('GET', '/api/admin/analytics', null, { quiet: true });
    const tile = (n, l) => el('div', { class: 'stile' }, el('b', null, n), el('span', null, l));
    box.replaceChildren(
      el('div', { class: 'stiles' }, tile(t.users, 'people'), tile(t.online, 'online now'), tile(t.dau, 'active today'), tile(t.wau, 'active 7 days'), tile(t.mau, 'active 30 days'), tile(t.newWeek, 'new this week'), tile(t.verified, 'verified'), tile(t.beta, 'on beta'), tile(t.groups, 'groups'), tile(t.dms, 'dms'), tile(t.banned, 'suspended'), tile(t.openReports + t.pendingVerify + t.pendingAppeals, 'waiting on you')),
      el('div', { class: 'charts' }, barChart(days, 'messages', 'messages sent'), barChart(days, 'active', 'people active'), barChart(days, 'signups', 'new signups'), barChart(days, 'beta', 'beta grants')),
      el('p', { class: 'muted small' }, `${t.images} photos stored (${fmtBytes(t.imageBytes)}) · ${t.reminders} reminders waiting · database ${fmtBytes(t.dbBytes)}`));
  } catch (e) { box.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
}

// ---------- suspended account: the appeal screen ----------
function appealModal(data, username) {
  const ap = data.appeal || {};
  const msg = el('textarea', { rows: 4, maxLength: 600, placeholder: 'tell us what happened and why it should be lifted' });
  const err = el('div', { class: 'form-err' });
  const send = el('button', { class: 'btn primary wide', onclick: async () => {
    send.disabled = true; err.textContent = '';
    try { await api('POST', '/api/appeals', { token: ap.token, message: msg.value.trim() }, { quiet: true }); toast('appeal sent', 'success'); mm.close(); }
    catch (e) { err.textContent = e.message; send.disabled = false; }
  } }, 'send appeal');
  const status = ap.status === 'pending' ? 'your appeal is waiting for an admin.' : ap.status === 'denied' ? `your last appeal was denied${ap.response ? ': ' + ap.response : ''}.` : '';
  const can = ap.canAppeal && ap.token;
  const mm = modal('account suspended', el('div', null,
    el('p', { style: 'margin-top:0' }, `@${username} is suspended.`), data.reason ? el('p', null, el('b', null, 'reason: '), data.reason) : null,
    status ? el('p', { class: 'muted' }, status) : null,
    can ? el('div', null, msg, err, send) : ap.status !== 'pending' && ap.waitMinutes ? el('p', { class: 'muted small' }, `you can appeal again in ${X.niceSecs(ap.waitMinutes * 60)}.`) : null));
}

Object.assign(window.__ext, { memberTools, staffSection, modlogModal, adminAppeals, adminAudit, adminStats, appealModal });

try { const r = new URLSearchParams(location.search).get('ref'); if (r) { C.lsSet('chatroom.ref', r.slice(0, 16)); history.replaceState(null, '', location.pathname); } } catch {}
U.boot();                                                    // everything is defined, start the app
})();

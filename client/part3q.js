// ---------- admin applications ----------
{
const C = window.__core, S = C.S, el = C.el, ic = C.ic, api = C.api, toast = C.toast, ago = C.ago, avatar = C.avatar;
const modal = (...a) => window.__ui.modal(...a);

async function applyModal() {
  let st;
  try { st = await api('GET', '/api/admin-apps/mine', null, { quiet: true }); } catch (e) { return toast(e.message, 'error'); }
  const body = el('div', null);
  const m = modal('apply to be an admin', body);
  const status = st.last ? el('div', { class: 'appealmsg', style: 'margin-bottom:10px' }, `last application: ${st.last.status}${st.last.response ? ' - ' + st.last.response : ''}`) : null;
  if (!st.canApply) { body.replaceChildren(...[status, el('p', { class: 'muted' }, st.why)].filter(Boolean)); return; }
  const why = el('textarea', { rows: 4, maxLength: 600, placeholder: 'why do you want to be an admin? (40+ characters)' });
  const exp = el('textarea', { rows: 2, maxLength: 400, placeholder: 'any moderating experience? (optional)' });
  const hours = el('input', { maxLength: 40, placeholder: 'hours a week you could help, e.g. 5' });
  const scen = el('textarea', { rows: 3, maxLength: 400, placeholder: 'someone is spamming a public room and arguing with you when you warn them. what do you do?' });
  const err = el('div', { class: 'form-err' });
  const send = el('button', { class: 'btn primary wide', onclick: async () => {
    err.textContent = ''; send.disabled = true;
    try { await api('POST', '/api/admin-apps', { why: why.value, experience: exp.value, hours: hours.value, scenario: scen.value }, { quiet: true }); toast('application sent', 'success'); m.close(); }
    catch (e) { err.textContent = e.message; send.disabled = false; }
  } }, ic('shield', 16), 'send application');
  body.replaceChildren(...[status,
    el('p', { class: 'muted small', style: 'margin-top:0' }, 'the owner reads every application. you need a verified account that is 3+ days old. you can apply again 14 days after a decision.'),
    why, exp, hours, el('p', { class: 'small', style: 'margin:10px 0 4px' }, 'scenario'), scen, err, send].filter(Boolean));
}

async function adminApps(box, reload) {
  box.replaceChildren(el('div', { class: 'muted pad' }, '...'));
  try {
    const d = await api('GET', '/api/admin/admin-apps?status=all', null, { quiet: true });
    const head = d.canDecide ? el('div', { class: 'row gap', style: 'margin-bottom:10px' },
      el('div', { class: 'grow small' }, d.open ? 'applications are open' : 'applications are closed'),
      el('button', { class: 'btn small', onclick: async () => { try { await api('PUT', '/api/owner/admin-apps/open', { open: !d.open }, { quiet: true }); adminApps(box, reload); } catch (e) { toast(e.message, 'error'); } } }, d.open ? 'close applications' : 'open applications')) : null;
    if (!d.apps.length) return box.replaceChildren(...[head, el('div', { class: 'empty-s' }, el('div', null, 'no applications'))].filter(Boolean));
    box.replaceChildren(...[head].filter(Boolean), ...d.apps.map((a, i) => el('div', { class: 'arow appeal', style: `--i:${Math.min(i, 12)}` },
      avatar(a.displayName, 40),
      el('div', { class: 'grow' },
        el('div', { class: 'ctitle' }, a.displayName, el('span', { class: 'tag ' + (a.status === 'pending' ? 'gold' : '') }, a.status)),
        el('div', { class: 'muted small' }, `@${a.username} - ${a.messages} msgs - joined ${ago(a.joined)} - ${a.hours} h/week - ${ago(a.createdAt)}`),
        el('div', { class: 'small' }, el('b', null, 'why: '), a.why),
        a.experience ? el('div', { class: 'small' }, el('b', null, 'experience: '), a.experience) : null,
        el('div', { class: 'small' }, el('b', null, 'scenario: '), a.scenario),
        a.status !== 'pending' && a.response ? el('div', { class: 'small muted' }, `answer${a.decidedBy ? ' by ' + a.decidedBy : ''}: ${a.response}`) : null),
      a.status === 'pending' && d.canDecide ? el('button', { class: 'btn small primary', onclick: () => decideModal(a, () => { adminApps(box, reload); reload && reload(); }) }, 'decide') : null)));
  } catch (e) { box.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
}

function decideModal(a, done) {
  const resp = el('textarea', { rows: 3, maxLength: 300, placeholder: 'reply to them (optional)' });
  const go = async (approve) => {
    try { await api('POST', `/api/admin/admin-apps/${a.id}`, { approve, response: resp.value.trim() }, { quiet: true }); toast(approve ? `@${a.username} is now an admin` : 'application denied', 'success'); mm.close(); done && done(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const mm = modal('application from @' + a.username, el('div', null, el('div', { class: 'appealmsg' }, a.why), resp,
    el('div', { class: 'row gap', style: 'margin-top:10px' }, el('button', { class: 'btn danger grow', onclick: () => go(false) }, 'deny'), el('button', { class: 'btn primary grow', onclick: () => go(true) }, 'make admin'))));
}

Object.assign(window.__ext, { applyModal, adminApps });
}

(() => {
'use strict';
const C = window.__core, U = window.__ui, X = window.__ext;
const { S, el, ic, toast, api } = C;

async function vouchSection(verified) {
  const box = el('div', { class: 'vouchbox' });
  let st;
  try { st = await api('GET', '/api/vouch/status', null, { quiet: true }); } catch { return box; }
  const name = el('input', { placeholder: 'their username', maxLength: 32 });
  const err = el('div', { class: 'form-err' });
  if (!verified) {
    const have = st.vouchers.length;
    const go = el('button', { class: 'btn', onclick: async () => {
      err.textContent = ''; go.disabled = true;
      try { await api('POST', '/api/vouch/ask', { username: name.value }, { quiet: true }); toast('asked them to vouch for you', 'success'); name.value = ''; } catch (e) { err.textContent = e.message; }
      go.disabled = false;
    } }, ic('send', 14), 'ask');
    box.append(
      el('div', { class: 'or' }, 'or get vouched'),
      el('p', { class: 'muted small', style: 'margin:0 0 8px' }, `get ${st.need} verified friends to vouch for you and you are verified, no id needed. they have to know you, and they answer for you if you get banned.`),
      el('div', { class: 'vdots' }, Array.from({ length: st.need }, (_, i) => el('span', { class: 'vdot' + (i < have ? ' on' : '') }, i < have ? ic('check', 12) : null)), el('span', { class: 'muted small' }, `${have} of ${st.need}${have ? ': ' + st.vouchers.map((v) => v.displayName).join(', ') : ''}`)),
      el('div', { class: 'row gap' }, name, go), err);
    return box;
  }
  const go = el('button', { class: 'btn primary', disabled: !st.canVouch, onclick: async () => {
    err.textContent = ''; go.disabled = true;
    try {
      const r = await api('POST', '/api/vouch', { username: name.value }, { quiet: true });
      toast(r.verified ? 'vouched, and that made them verified' : `vouched (${r.count}/${st.need})`, 'success'); name.value = '';
      const nb = await vouchSection(true); box.replaceWith(nb);
    } catch (e) { err.textContent = e.message; go.disabled = false; }
  } }, ic('verified', 14), 'vouch');
  box.append(
    el('div', { class: 'or' }, 'vouch for a friend'),
    el('p', { class: 'muted small', style: 'margin:0 0 8px' }, st.canVouch ? `only vouch for people you actually know. if they get banned it counts against you, and ${2} strikes ends your vouching. ${st.left} of ${st.weekly} left this week.` : st.whyNot),
    el('div', { class: 'row gap' }, name, go), err,
    st.given.length ? el('div', { class: 'muted small', style: 'margin-top:8px' }, 'you vouched for: ' + st.given.map((g) => g.displayName + (g.verified ? ' (verified)' : ' (waiting)')).join(', ')) : null);
  return box;
}

async function adminVouches(userId) {
  const { modal } = U;
  const body = el('div', null, el('div', { class: 'muted pad' }, '...'));
  modal('vouches', body);
  try {
    const d = await api('GET', `/api/admin/users/${userId}/vouches`, null, { quiet: true });
    const row = (x) => el('div', { class: 'urow' }, el('div', { class: 'grow' }, `${x.displayName} (@${x.username})`), el('span', { class: 'muted small' }, (x.banned ? 'banned' : x.verified ? 'verified' : 'unverified'))); 
    body.replaceChildren(
      el('p', { style: 'margin-top:0' }, `${d.user.displayName}: ${d.user.verified ? 'verified via ' + (d.user.via || 'unknown') : 'not verified'}. vouch strikes: ${d.user.strikes}.`),
      el('h4', null, 'vouched for them'), d.vouchedBy.length ? d.vouchedBy.map(row) : el('div', { class: 'muted small' }, 'nobody'),
      el('h4', null, 'they vouched for'), d.vouchedFor.length ? d.vouchedFor.map(row) : el('div', { class: 'muted small' }, 'nobody'),
      d.user.strikes ? el('button', { class: 'btn small', style: 'margin-top:10px', onclick: async () => { await api('POST', `/api/admin/users/${userId}/vouch-reset`, {}, { quiet: true }); toast('strikes cleared', 'success'); } }, 'clear strikes') : null);
  } catch (e) { body.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
}

Object.assign(window.__ext, { vouchSection, adminVouches });
})();

(() => {
'use strict';
const C = window.__core, U = window.__ui, X = window.__ext;
const { S, el, ic, toast, api, loadConvs } = C;
const { modal } = U;

const PALETTE = ['#e0674f', '#e0a526', '#6bb26b', '#4f9fd8', '#8b6bd8', '#d86bb0', '#8a8f98', '#c9a227'];

const rolesOf = (c, uid) => {
  const m = c.members.find((x) => x.id === uid);
  if (!m || !m.roleIds || !m.roleIds.length) return [];
  return (c.roles || []).filter((r) => m.roleIds.includes(r.id));
};

const roleChips = (c, uid) => {
  const rs = rolesOf(c, uid);
  if (!rs.length) return null;
  return el('span', { class: 'rolechips' }, rs.map((r) => el('span', { class: 'rolechip', style: `--rc:${r.color}` }, r.name)));
};

function rolesSection(c, redraw) {
  if (c.type !== 'group' || c.systemKind || U.myRank(c) < 2) return null;
  const name = el('input', { placeholder: 'new role name', maxLength: 20 });
  let color = PALETTE[0];
  const swatches = el('div', { class: 'row gap-s wraprow' });
  const drawSw = () => swatches.replaceChildren(...PALETTE.map((p) => el('button', { class: 'swatch' + (p === color ? ' on' : ''), style: `background:${p}`, onclick: () => { color = p; drawSw(); } })));
  drawSw();
  const done = async () => { await loadConvs(); redraw && redraw(); };
  const list = (c.roles || []).map((r) => el('div', { class: 'urow' },
    el('span', { class: 'rolechip', style: `--rc:${r.color}` }, r.name),
    el('div', { class: 'grow' }),
    el('button', { class: 'btn small', onclick: () => assignModal(c, r, done) }, 'people'),
    el('button', { class: 'icon-btn', title: 'delete role', onclick: async () => { try { await api('DELETE', `/api/conversations/${c.id}/roles/${r.id}`); await done(); } catch (e) { toast(e.message, 'error'); } } }, ic('trash', 16))));
  const add = el('button', { class: 'btn primary', onclick: async () => {
    try { await api('POST', `/api/conversations/${c.id}/roles`, { name: name.value, color }); name.value = ''; await done(); } catch (e) { toast(e.message, 'error'); }
  } }, ic('plus', 16), 'add role');
  return el('div', { class: 'col gap-s', style: 'margin-top:14px' },
    el('h4', { style: 'margin:0' }, ic('users', 14), 'roles'),
    el('div', { class: 'muted small' }, 'named colored tags you give to people. they show next to the name in chat.'),
    ...list, name, swatches, add);
}

function assignModal(c, role, after) {
  const body = el('div', { class: 'col gap-s' });
  const m = modal('who is ' + role.name, body);
  m.box.style.zIndex = 420;
  const draw = () => body.replaceChildren(...c.members.filter((u) => !u.isBot).map((u) => {
    const has = (u.roleIds || []).includes(role.id);
    return el('div', { class: 'urow' }, C.avatar(u.displayName, 30, '', u.avatar), el('div', { class: 'grow' }, u.displayName),
      el('button', { class: 'btn small' + (has ? '' : ' primary'), onclick: async () => {
        try {
          await api('PUT', `/api/conversations/${c.id}/roles/${role.id}/members/${u.id}`, { on: !has });
          u.roleIds = has ? u.roleIds.filter((x) => x !== role.id) : [...(u.roleIds || []), role.id];
          draw(); after && after();
        } catch (e) { toast(e.message, 'error'); }
      } }, has ? 'remove' : 'give'));
  }));
  draw();
}

function rulesSection(c, redraw) {
  if (c.type !== 'group' || c.systemKind || U.myRank(c) < 2) return null;
  const ta = el('textarea', { rows: 5, maxLength: 1200, placeholder: 'be kind. no spam. keep it on topic.' });
  ta.value = c.rules || '';
  let on = !!c.rulesOn;
  const tog = el('button', { class: 'btn' + (on ? ' primary' : '') }, on ? 'gate is on' : 'gate is off');
  tog.onclick = () => { on = !on; tog.className = 'btn' + (on ? ' primary' : ''); tog.textContent = on ? 'gate is on' : 'gate is off'; };
  const save = el('button', { class: 'btn primary', onclick: async () => {
    try { await api('PUT', `/api/conversations/${c.id}/rules`, { text: ta.value, on }); await loadConvs(); toast('rules saved', 'success'); redraw && redraw(); } catch (e) { toast(e.message, 'error'); }
  } }, 'save rules');
  return el('div', { class: 'col gap-s', style: 'margin-top:14px' },
    el('h4', { style: 'margin:0' }, ic('shield', 14), 'rules'),
    el('div', { class: 'muted small' }, 'with the gate on, new members and everyone after you edit the rules have to accept before they can post.'),
    ta, el('div', { class: 'row gap-s' }, tog, save));
}

function rulesBar(c, composer) {
  const bar = el('div', { class: 'rulesbar' });
  const gated = () => c.type === 'group' && c.rulesOn && !c.rulesOk && U.myRank(c) < 1;
  const draw = () => {
    const g = gated();
    composer.style.display = g ? 'none' : '';
    bar.style.display = g ? '' : 'none';
    if (!g) return;
    bar.replaceChildren(
      el('div', { class: 'ctitle' }, ic('shield', 16), 'group rules'),
      el('div', { class: 'rulestext' }, c.rules),
      el('button', { class: 'btn primary wide', onclick: async () => {
        try { await api('POST', `/api/conversations/${c.id}/rules/accept`); c.rulesOk = true; draw(); } catch (e) { toast(e.message, 'error'); }
      } }, ic('check', 16), 'i accept'));
  };
  draw();
  return bar;
}

Object.assign(window.__ext, { rolesSection, rulesSection, rulesBar, roleChips, rolesOf });
})();

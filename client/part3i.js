(() => {
'use strict';
const C = window.__core, U = window.__ui, X = window.__ext;
const { S, el, ic, toast, convOf, api, avatar, sendPayload, keyFor, wrapGroupKey, loadConvs } = C;
const { modal, confirmModal } = U;

const STARTER_JS = `function onMessage(msg) {
  var t = msg.text.toLowerCase();
  if (t.indexOf("hello") >= 0) {
    reply("hey " + msg.user + "!");
  }
}`;
const STATUS = { draft: ['draft', 'not sent for approval yet'], pending: ['waiting', 'waiting for approval'], approved: ['live', 'approved'], rejected: ['rejected', 'rejected'], disabled: ['disabled', 'switched off'] };
const WHEN = [['contains', 'message contains'], ['starts', 'message starts with'], ['equals', 'message is exactly'], ['command', 'someone runs /bot'], ['any', 'any message']];
const DO = [['reply', 'say'], ['pick', 'say one of'], ['dice', 'roll a die'], ['coin', 'flip a coin'], ['count', 'count and say']];

const chip = (b) => el('span', { class: 'tag' + (b.status === 'approved' ? ' gold' : '') }, (STATUS[b.status] || [b.status])[0]);

function blocksEditor(state) {
  const box = el('div', { class: 'bkbox' });
  const draw = () => {
    const rules = state.blocks.rules;
    box.replaceChildren(...rules.map((r, ri) => {
      const whenSel = el('select', { onchange: () => { r.when.kind = whenSel.value; draw(); } }, WHEN.map(([k, l]) => el('option', { value: k, selected: r.when.kind === k }, l)));
      const whenTxt = ['contains', 'starts', 'equals'].includes(r.when.kind) ? el('input', { placeholder: 'text', value: r.when.text || '', maxLength: 120, oninput: (e) => { r.when.text = e.target.value; } }) : null;
      return el('div', { class: 'bkrule' },
        el('div', { class: 'bkwhen row gap-s' }, el('b', null, 'when'), whenSel, whenTxt, el('button', { class: 'icon-btn', title: 'remove rule', onclick: () => { rules.splice(ri, 1); draw(); } }, ic('x', 16))),
        ...r.do.map((a, ai) => {
          const sel = el('select', { onchange: () => { a.kind = sel.value; draw(); } }, DO.map(([k, l]) => el('option', { value: k, selected: a.kind === k }, l)));
          let field = null;
          if (a.kind === 'reply' || a.kind === 'count') field = el('input', { placeholder: a.kind === 'count' ? 'text, use {count}' : 'text, you can use {user} and {args}', value: a.text || '', maxLength: 300, oninput: (e) => { a.text = e.target.value; } });
          else if (a.kind === 'pick') field = el('textarea', { rows: 3, placeholder: 'one reply per line', oninput: (e) => { a.list = e.target.value.split('\n').slice(0, 30); } }, (a.list || []).join('\n'));
          else if (a.kind === 'dice') field = el('input', { type: 'number', min: 2, max: 1000, value: a.sides || 6, oninput: (e) => { a.sides = parseInt(e.target.value, 10) || 6; } });
          return el('div', { class: 'bkdo row gap-s' }, el('b', null, 'then'), sel, field, el('button', { class: 'icon-btn', title: 'remove', onclick: () => { r.do.splice(ai, 1); draw(); } }, ic('x', 16)));
        }),
        el('button', { class: 'btn small', onclick: () => { if (r.do.length < 8) { r.do.push({ kind: 'reply', text: '' }); draw(); } } }, ic('plus', 14), 'add action'));
    }),
      el('button', { class: 'btn', onclick: () => { if (rules.length < 30) { rules.push({ when: { kind: 'contains', text: '' }, do: [{ kind: 'reply', text: '' }] }); draw(); } } }, ic('plus', 16), 'add rule'),
      el('div', { class: 'muted small' }, 'rules run top to bottom and the first one that matches wins.'));
  };
  draw();
  return box;
}

async function editBot(bot, done) {
  const isNew = !bot;
  const st = bot ? JSON.parse(JSON.stringify(bot)) : { name: '', kind: 'blocks', description: '', code: STARTER_JS, context: '', allowPublic: true, allowDm: false, allowGroups: false, blocks: { rules: [{ when: { kind: 'contains', text: 'hello' }, do: [{ kind: 'reply', text: 'hey {user}!' }] }] }, status: 'draft' };
  if (!st.blocks || !Array.isArray(st.blocks.rules)) st.blocks = { rules: [] };
  const body = el('div', { class: 'col gap-s' });
  const m = modal(isNew ? 'new bot' : st.name, body, { wide: true });
  const out = el('div', { class: 'bktest' });
  let busy = false;

  const toggle = (label, hint, key) => {
    const b = el('button', { class: 'switch' + (st[key] ? ' on' : ''), role: 'switch', onclick: () => { st[key] = !st[key]; b.classList.toggle('on', st[key]); draw(); } });
    return el('div', { class: 'row gap-s', style: 'align-items:center' }, b, el('div', { class: 'grow' }, el('div', null, label), el('div', { class: 'muted small' }, hint)));
  };

  const payload = () => ({ kind: st.kind, description: st.description, code: st.code, blocks: st.blocks, context: st.context, allow_public: st.allowPublic, allow_dm: st.allowDm, allow_groups: st.allowGroups });

  async function save() {
    if (busy) return null;
    busy = true;
    try {
      let d;
      if (isNew && !st.id) d = await api('POST', '/api/bots', { name: st.name, ...payload() });
      else d = await api('PUT', '/api/bots/' + st.id, payload());
      const wasNew = !st.id;
      Object.assign(st, d.bot);
      if (wasNew) draw();
      return d.bot;
    } catch (e) { toast(e.message, 'error'); return null; } finally { busy = false; }
  }

  async function runTest(text, asCommand) {
    const b = await save(); if (!b) return;
    out.replaceChildren(el('div', { class: 'muted small' }, 'running...'));
    try {
      const r = await api('POST', `/api/bots/${st.id}/test`, { text, command: asCommand }, { quiet: true });
      out.replaceChildren(
        ...r.replies.map((t) => el('div', { class: 'bkreply' }, el('b', null, st.name), el('span', null, t))),
        r.replies.length || r.error ? null : el('div', { class: 'muted small' }, 'the bot did not say anything'),
        r.error ? el('div', { class: 'form-err' }, r.error) : null,
        r.logs && r.logs.length ? el('pre', { class: 'bklog' }, r.logs.join('\n')) : null);
    } catch (e) { out.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
  }

  function draw() {
    const nameIn = el('input', { placeholder: 'bot name, like dicebot', maxLength: 20, value: st.name, disabled: !!st.id, oninput: (e) => { st.name = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''); e.target.value = st.name; } });
    const desc = el('input', { placeholder: 'what does it do?', maxLength: 140, value: st.description, oninput: (e) => { st.description = e.target.value; } });
    const kindSeg = el('div', { class: 'seg small' }, [['blocks', 'blocks'], ['js', 'javascript'], ['ai', 'ai']].map(([k, l]) => el('button', { class: st.kind === k ? 'on' : '', onclick: () => { st.kind = k; draw(); } }, l)));
    let editor;
    if (st.kind === 'blocks') editor = blocksEditor(st);
    else if (st.kind === 'js') editor = el('div', { class: 'col gap-s' },
      el('textarea', { class: 'bkcode', rows: 12, spellcheck: false, autocapitalize: 'off', maxLength: 20000, oninput: (e) => { st.code = e.target.value; } }, st.code),
      el('div', { class: 'muted small' }, 'write function onMessage(msg). msg has text, user, room, args. call reply("text") to talk, random(n) for a number, store.get(key) and store.set(key, value) to remember things. it runs in a locked box: no internet, no files, 60ms limit.'));
    else editor = el('div', { class: 'col gap-s' },
      el('textarea', { rows: 8, maxLength: 1500, placeholder: 'who is this bot? how does it talk? what does it know? e.g. "you are a pirate who answers questions about school lunch. keep it funny."', oninput: (e) => { st.context = e.target.value; } }, st.context),
      el('div', { class: 'muted small' }, 'powered by the hack club ai (gemini). in rooms and groups it answers when someone @mentions it, in dms it answers everything. each bot gets 40 ai replies an hour.'));
    const testIn = el('input', { placeholder: 'type a message to try it', onkeydown: (e) => { if (e.key === 'Enter') runTest(testIn.value, false); } });
    const warn = (st.allowDm || st.allowGroups) ? el('div', { class: 'form-err' }, 'a bot in a dm or private group can read that chat. people will see a warning before adding it. ' + (st.kind === 'ai' ? 'ai bots also send those messages to the ai service.' : '')) : null;
    body.replaceChildren(
      el('div', { class: 'row gap-s' }, nameIn, st.id ? chip(st) : null),
      desc,
      kindSeg,
      st.rejectReason ? el('div', { class: 'form-err' }, 'not approved: ' + st.rejectReason) : null,
      editor,
      el('h4', null, 'where can it be used'),
      toggle('public rooms', 'you add it to a public group you are in', 'allowPublic'),
      toggle('direct messages', 'people can dm it', 'allowDm'),
      toggle('private groups', 'group admins can add it', 'allowGroups'),
      warn,
      el('h4', null, 'try it'),
      el('div', { class: 'row gap-s' }, testIn, el('button', { class: 'btn', onclick: () => runTest(testIn.value, false) }, 'send'), el('button', { class: 'btn', title: 'like someone typing /bot name text', onclick: () => runTest(testIn.value, true) }, 'as /bot')),
      out,
      el('div', { class: 'row gap-s', style: 'margin-top:10px;flex-wrap:wrap' },
        el('button', { class: 'btn primary', onclick: async () => { const b = await save(); if (b) { toast('saved' + (b.status === 'pending' ? ', waiting for approval again' : ''), 'success'); draw(); done && done(); } } }, 'save'),
        ['draft', 'rejected'].includes(st.status) && st.id ? el('button', { class: 'btn', onclick: async () => { const b = await save(); if (!b) return; try { await api('POST', `/api/bots/${st.id}/submit`); st.status = 'pending'; toast('sent for approval', 'success'); draw(); done && done(); } catch (e) { toast(e.message, 'error'); } } }, ic('send', 14), 'send for approval') : null,
        st.status === 'approved' && st.allowPublic ? el('button', { class: 'btn', onclick: () => addToRoom(st) }, ic('users', 14), 'add to a public group') : null,
        st.id ? el('button', { class: 'btn danger', onclick: async () => { if (await confirmModal('delete ' + st.name + '?', 'this removes the bot everywhere.', 'delete')) { try { await api('DELETE', '/api/bots/' + st.id); m.close(); toast('deleted', 'success'); done && done(); } catch (e) { toast(e.message, 'error'); } } } }, 'delete') : null));
  }
  draw();
}

function addToRoom(bot) {
  const rooms = S.convs.filter((c) => c.isPublic && !c.systemKind);
  const m = modal('add to a public group', el('div', { class: 'ulist tall' }, rooms.length ? rooms.map((c) => el('div', { class: 'urow click', onclick: async () => { try { await api('POST', `/api/bots/${bot.id}/rooms`, { convId: c.id }); toast('added to ' + c.name, 'success'); m.close(); } catch (e) { toast(e.message, 'error'); } } }, ic('globe', 16), el('div', { class: 'grow' }, c.name))) : [el('div', { class: 'muted pad' }, 'join or make a public group first')]));
  m.box.style.zIndex = 400;
}

async function myBots() {
  const body = el('div', { class: 'col gap-s' });
  const m = modal('my bots', body, { wide: true });
  async function load() {
    try {
      const d = await api('GET', '/api/bots/mine');
      body.replaceChildren(
        el('p', { class: 'muted small', style: 'margin-top:0' }, 'make a bot with blocks, javascript or ai. every new bot is checked by the owner before it goes live. you can have ' + d.max + '.'),
        ...d.bots.map((b) => el('div', { class: 'urow click', onclick: () => editBot(b, load) }, ic('sparkle', 18), el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, b.name), el('div', { class: 'muted small' }, b.kind + (b.description ? ' - ' + b.description : '') + (b.runs ? ' - ' + b.runs + ' runs' : ''))), chip(b))),
        d.bots.length < d.max ? el('button', { class: 'btn primary', onclick: () => editBot(null, load) }, ic('plus', 16), 'new bot') : null,
        el('button', { class: 'btn', onclick: () => { m.close(); directory(); } }, ic('compass', 16), 'browse bots'));
    } catch (e) { body.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
  }
  load();
}

async function directory() {
  const body = el('div', { class: 'col gap-s' });
  const m = modal('bots', body, { wide: true });
  try {
    const d = await api('GET', '/api/bots/directory');
    body.replaceChildren(
      el('p', { class: 'muted small', style: 'margin-top:0' }, 'type /bot name your message in any chat to use one. the bot only sees what you type after its name.'),
      ...(d.bots.length ? d.bots.map((b) => el('div', { class: 'urow' }, avatar(b.name, 36), el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, b.name, el('span', { class: 'muted small' }, '  by ' + (b.owner || 'someone'))), el('div', { class: 'muted small' }, b.description || b.kind), el('div', { class: 'row gap-s', style: 'margin-top:4px' }, b.allowPublic ? el('span', { class: 'tag' }, 'rooms') : null, b.allowDm ? el('span', { class: 'tag' }, 'dms') : null, b.allowGroups ? el('span', { class: 'tag' }, 'groups') : null)),
        b.allowDm ? el('button', { class: 'btn small', onclick: () => { m.close(); U.startDM(b.name); } }, 'message') : null)) : [el('div', { class: 'muted pad' }, 'no bots yet, be the first')]),
      el('button', { class: 'btn', onclick: () => { m.close(); myBots(); } }, ic('plus', 16), 'make your own'));
  } catch (e) { body.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
}

async function groupBotPicker(c, after) {
  const body = el('div', { class: 'col gap-s' });
  const m = modal('add a bot', body);
  m.box.style.zIndex = 400;
  try {
    const d = await api('GET', '/api/bots/directory');
    const list = d.bots.filter((b) => b.allowGroups && !c.members.some((x) => x.id === b.id));
    body.replaceChildren(el('div', { class: 'form-err' }, 'a bot you add can read everything in this group, and its owner controls how it works. only add bots you trust.'),
      ...(list.length ? list.map((b) => el('div', { class: 'urow click', onclick: async () => {
        if (!(await confirmModal('add ' + b.name + ' to ' + c.name + '?', 'it will be able to read every message in this group from now on.', 'add'))) return;
        try {
          const { raw } = await keyFor(c, c.keyVersion);
          const w = await wrapGroupKey(raw, b.publicKey, b.id);
          await api('POST', `/api/conversations/${c.id}/members`, { userId: b.id, ...w });
          await loadConvs(); toast(b.name + ' is in', 'success'); m.close(); after && after();
        } catch (e) { toast(e.message, 'error'); }
      } }, avatar(b.name, 34), el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, b.name), el('div', { class: 'muted small' }, b.description || b.kind)))) : [el('div', { class: 'muted pad' }, 'no bots allow groups yet')]));
  } catch (e) { body.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
}

async function runBotCommand(c, arg) {
  const mm = String(arg || '').trim().match(/^@?([a-z0-9_]{3,20})\s*([\s\S]*)$/i);
  if (!mm) { directory(); return; }
  try {
    const r = await api('POST', `/api/bots/${mm[1].toLowerCase()}/run`, { text: mm[2] || '' });
    for (const text of r.replies.slice(0, 3)) await sendPayload(c, { t: 'botreply', bot: r.bot.displayName, botUsername: r.bot.name, text, asked: (mm[2] || '').slice(0, 200) });
    if (!r.replies.length) toast(r.bot.displayName + ' had nothing to say', 'info');
  } catch (e) { toast(e.message, 'error'); }
}

function botBody(c, m, p) {
  return el('div', { class: 'botreply' }, el('div', { class: 'botreply-h' }, ic('sparkle', 13), el('b', null, String(p.bot || 'bot')), el('span', { class: 'tag' }, 'bot')), p.asked ? el('div', { class: 'muted small' }, '/bot ' + (p.botUsername || '') + ' ' + p.asked) : null, el('div', { class: 'mtext' }, String(p.text || '')));
}

async function ownerBots(box) {
  const list = el('div', { class: 'col gap-s' });
  box.replaceChildren(el('h4', null, 'bots'), list);
  async function load() {
    try {
      const d = await api('GET', '/api/owner/bots', null, { quiet: true });
      list.replaceChildren(...(d.bots.length ? d.bots.map((b) => el('div', { class: 'card', style: 'padding:10px' },
        el('div', { class: 'row gap-s' }, el('b', { class: 'grow' }, b.name + '  '), el('span', { class: 'muted small' }, 'by ' + b.owner + ' - ' + b.kind), chip(b)),
        b.description ? el('div', { class: 'muted small' }, b.description) : null,
        el('div', { class: 'muted small' }, 'rooms: ' + (b.allowPublic ? 'yes' : 'no') + '  dms: ' + (b.allowDm ? 'yes' : 'no') + '  groups: ' + (b.allowGroups ? 'yes' : 'no') + '  runs: ' + b.runs + (b.lastError ? '  last error: ' + b.lastError : '')),
        el('details', null, el('summary', { class: 'small' }, 'see what it does'), el('pre', { class: 'bklog' }, b.kind === 'ai' ? b.context : b.kind === 'js' ? b.code : JSON.stringify(b.blocks, null, 1))),
        el('div', { class: 'row gap-s', style: 'margin-top:6px;flex-wrap:wrap' },
          b.status !== 'approved' ? el('button', { class: 'btn small primary', onclick: () => act(b, 'approved') }, 'approve') : null,
          b.status !== 'rejected' ? el('button', { class: 'btn small', onclick: () => act(b, 'rejected', true) }, 'reject') : null,
          b.status === 'approved' ? el('button', { class: 'btn small danger', onclick: () => act(b, 'disabled', true) }, 'switch off') : null))) : [el('div', { class: 'muted pad' }, 'nobody has made a bot yet')]));
    } catch (e) { list.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
  }
  async function act(b, status, ask) {
    let reason = '';
    if (ask) { reason = window.prompt('reason (the bot owner sees this)', '') || ''; }
    try { await api('POST', '/api/owner/bots/' + b.id, { status, reason }); toast(b.name + ' is ' + status, 'success'); load(); } catch (e) { toast(e.message, 'error'); }
  }
  load();
}

Object.assign(window.__ext, { myBots, botDirectory: directory, groupBotPicker, runBotCommand, botBody, ownerBots });
})();

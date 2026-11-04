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
const WHEN = [['contains', 'message contains'], ['anyof', 'message has any of'], ['starts', 'message starts with'], ['equals', 'message is exactly'], ['link', 'message has a link'], ['caps', 'message is mostly caps'], ['command', 'someone runs /bot'], ['join', 'someone joins'], ['tick', 'on the timer'], ['any', 'any message']];
const DO = [['reply', 'say'], ['quote', 'reply to the message'], ['pick', 'say one of'], ['dice', 'roll a die'], ['coin', 'flip a coin'], ['count', 'count and say'], ['react', 'react to the message'], ['poll', 'post a poll'], ['dm', 'dm the person'], ['delete', 'delete the message'], ['pin', 'pin the message'], ['mute', 'mute the person'], ['slow', 'set slow mode'], ['kick', 'remove the person'], ['promote', 'make the person a mod'], ['topic', 'change the group description']];
const ACTION_POWER = { react: 'react', quote: 'quote', delete: 'delete', pin: 'pin', mute: 'mute', kick: 'kick', dm: 'dm', poll: 'poll', topic: 'topic', slow: 'slow', promote: 'roles' };
const WHEN_POWER = { join: 'welcome', tick: 'schedule' };
const NEEDS = { delete: 'mod', pin: 'mod', mute: 'mod', slow: 'mod', kick: 'host', topic: 'host', promote: 'host' };
const POWER_GROUPS = [
  ['in chat', [['react', 'react to messages', 'adds emoji reactions'], ['quote', 'reply to messages', 'quotes the message it is answering'], ['poll', 'post polls', 'up to 6 options'], ['dm', 'dm people', 'messages the person who triggered it, needs direct messages turned on'], ['welcome', 'greet new members', 'runs when someone joins a group'], ['schedule', 'post on a timer', 'runs every so often in rooms that are active']]],
  ['moderation', [['delete', 'delete messages', 'only where the host gave it the mod role'], ['pin', 'pin messages', 'needs the mod role'], ['mute', 'mute people', 'up to 60 minutes, needs the mod role'], ['slow', 'set slow mode', 'needs the mod role']]],
  ['host powers', [['kick', 'remove people', 'public groups only, needs the host role'], ['topic', 'change the group description', 'public groups, needs the host role'], ['roles', 'make people mods', 'needs the host role']]],
];
const POWER_NAME = {}; POWER_GROUPS.forEach(([, l]) => l.forEach(([k, n]) => { POWER_NAME[k] = n; }));
const SLOWS = [5, 10, 30, 60, 300, 900];
const ROLE_LABEL = { member: 'member', mod: 'mod', admin: 'host' };
const JS_DOCS = `onMessage(msg)  runs on every message in the room
onJoin(msg)     someone joined (greet power)
onTick(msg)     the timer fired (timer power)

msg: text, user, userId, userRole (member, mod, admin),
     id, room, event, dm, mention, command, args

reply("text")             say something
quote("text")             reply that quotes the message
react("emoji", id?)       react, id defaults to the message
del(id?)                  delete the message
pin(id?, on?)             pin or unpin
mute(userId, minutes)     mute up to 60 min      unmute(userId)
kick(userId)              remove from a public group
promote(userId, on?)      make a mod or remove mod
slow(seconds)             0, 5, 10, 30, 60, 300 or 900
topic("text")             group description
dm("text")                dm the person who sent the message
poll("question", ["a", "b"])
random(n)                 number from 0 to n-1
store.get(key)  store.set(key, value)   memory for the bot
console.log(x)            shows in the test box

a power only works if the bot has it, the owner approved it, and
for delete, pin, mute, slow, kick, topic and promote the host gave
the bot the mod or host role in that group.`;

const inferred = (st) => {
  const out = new Set();
  if (st.kind !== 'blocks') return out;
  for (const r of st.blocks.rules) {
    if (r.when && WHEN_POWER[r.when.kind]) out.add(WHEN_POWER[r.when.kind]);
    for (const a of r.do) if (ACTION_POWER[a.kind]) out.add(ACTION_POWER[a.kind]);
  }
  return out;
};
const powerTags = (list) => (list || []).map((p) => el('span', { class: 'tag' + (['delete', 'pin', 'mute', 'slow', 'kick', 'topic', 'roles'].includes(p) ? ' gold' : '') }, POWER_NAME[p] || p));

const chip = (b) => el('span', { class: 'tag' + (b.status === 'approved' ? ' gold' : '') }, (STATUS[b.status] || [b.status])[0]);

function blocksEditor(state) {
  const box = el('div', { class: 'bkbox' });
  const draw = () => {
    const rules = state.blocks.rules;
    box.replaceChildren(...rules.map((r, ri) => {
      const whenSel = el('select', { onchange: () => { r.when.kind = whenSel.value; draw(); } }, WHEN.map(([k, l]) => el('option', { value: k, selected: r.when.kind === k }, l)));
      const whenTxt = ['contains', 'starts', 'equals', 'anyof'].includes(r.when.kind) ? el('input', { placeholder: r.when.kind === 'anyof' ? 'word, word, word' : 'text', value: r.when.text || '', maxLength: r.when.kind === 'anyof' ? 300 : 120, oninput: (e) => { r.when.text = e.target.value; } }) : null;
      return el('div', { class: 'bkrule' },
        el('div', { class: 'bkwhen row gap-s' }, el('b', null, 'when'), whenSel, whenTxt, el('button', { class: 'icon-btn', title: 'remove rule', onclick: () => { rules.splice(ri, 1); draw(); } }, ic('x', 16))),
        ...r.do.map((a, ai) => {
          const sel = el('select', { onchange: () => { a.kind = sel.value; draw(); } }, DO.map(([k, l]) => el('option', { value: k, selected: a.kind === k }, l)));
          let field = null;
          if (['reply', 'count', 'quote', 'dm', 'topic'].includes(a.kind)) field = el('input', { placeholder: a.kind === 'count' ? 'text, use {count}' : 'text, you can use {user} and {args}', value: a.text || '', maxLength: a.kind === 'topic' ? 160 : 300, oninput: (e) => { a.text = e.target.value; } });
          else if (a.kind === 'pick') field = el('textarea', { rows: 3, placeholder: 'one reply per line', oninput: (e) => { a.list = e.target.value.split('\n').slice(0, 30); } }, (a.list || []).join('\n'));
          else if (a.kind === 'dice') field = el('input', { type: 'number', min: 2, max: 1000, value: a.sides || 6, oninput: (e) => { a.sides = parseInt(e.target.value, 10) || 6; } });
          else if (a.kind === 'mute') field = el('input', { type: 'number', min: 1, max: 60, value: a.minutes || 5, title: 'minutes', oninput: (e) => { a.minutes = parseInt(e.target.value, 10) || 5; } });
          else if (a.kind === 'slow') field = el('select', { onchange: (e) => { a.seconds = parseInt(e.target.value, 10); } }, SLOWS.map((v) => el('option', { value: v, selected: (a.seconds || 10) === v }, v + 's')));
          else if (a.kind === 'react') field = el('div', { class: 'row gap-s wraprow' }, C.QUICK_REACTS.map((ch) => el('button', { class: 'btn small' + ((a.text || C.QUICK_REACTS[0]) === ch ? ' primary' : ''), onclick: () => { a.text = ch; draw(); } }, C.emojiEl(ch))));
          else if (a.kind === 'poll') field = el('div', { class: 'col gap-s grow' }, el('input', { placeholder: 'question', value: a.text || '', maxLength: 120, oninput: (e) => { a.text = e.target.value; } }), el('textarea', { rows: 3, placeholder: 'one option per line, 2 to 6', oninput: (e) => { a.list = e.target.value.split('\n').slice(0, 6); } }, (a.list || []).join('\n')));
          return el('div', { class: 'bkdo row gap-s' }, el('b', null, 'then'), sel, field, NEEDS[a.kind] ? el('span', { class: 'tag' }, 'needs ' + NEEDS[a.kind]) : null, el('button', { class: 'icon-btn', title: 'remove', onclick: () => { r.do.splice(ai, 1); draw(); } }, ic('x', 16)));
        }),
        el('button', { class: 'btn small', onclick: () => { if (r.do.length < 8) { r.do.push({ kind: 'reply', text: '' }); draw(); } } }, ic('plus', 14), 'add action'));
    }),
      el('button', { class: 'btn', onclick: () => { if (rules.length < 30) { rules.push({ when: { kind: 'contains', text: '' }, do: [{ kind: 'reply', text: '' }] }); draw(); } } }, ic('plus', 16), 'add rule'),
      el('div', { class: 'muted small' }, 'rules run top to bottom and the first one that matches wins. blocks that need a role only work in groups where the host gave the bot that role.'));
  };
  draw();
  return box;
}

async function editBot(bot, done) {
  const isNew = !bot;
  const st = bot ? JSON.parse(JSON.stringify(bot)) : { name: '', kind: 'blocks', description: '', code: STARTER_JS, context: '', allowPublic: true, allowDm: false, allowGroups: false, powers: [], tickMin: null, blocks: { rules: [{ when: { kind: 'contains', text: 'hello' }, do: [{ kind: 'reply', text: 'hey {user}!' }] }] }, status: 'draft' };
  if (!st.blocks || !Array.isArray(st.blocks.rules)) st.blocks = { rules: [] };
  if (!Array.isArray(st.powers)) st.powers = [];
  const body = el('div', { class: 'col gap-s' });
  const m = modal(isNew ? 'new bot' : st.name, body, { wide: true });
  const out = el('div', { class: 'bktest' });
  let busy = false;

  const toggle = (label, hint, key) => {
    const b = el('button', { class: 'switch' + (st[key] ? ' on' : ''), role: 'switch', onclick: () => { st[key] = !st[key]; b.classList.toggle('on', st[key]); draw(); } });
    return el('div', { class: 'row gap-s', style: 'align-items:center' }, b, el('div', { class: 'grow' }, el('div', null, label), el('div', { class: 'muted small' }, hint)));
  };

  const payload = () => ({ kind: st.kind, description: st.description, code: st.code, blocks: st.blocks, context: st.context, allow_public: st.allowPublic, allow_dm: st.allowDm, allow_groups: st.allowGroups, powers: [...new Set([...st.powers, ...inferred(st)])], tickMin: (st.powers.includes('schedule') || inferred(st).has('schedule')) ? (st.tickMin || 60) : null });

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

  const powerToggle = (key, label, hint) => {
    const forced = inferred(st).has(key);
    const on = forced || st.powers.includes(key);
    const b = el('button', { class: 'switch' + (on ? ' on' : ''), role: 'switch', disabled: forced, title: forced ? 'a block uses this' : '', onclick: () => { if (forced) return; st.powers = st.powers.includes(key) ? st.powers.filter((x) => x !== key) : st.powers.concat(key); draw(); } });
    return el('div', { class: 'row gap-s', style: 'align-items:center' }, b, el('div', { class: 'grow' }, el('div', null, label), el('div', { class: 'muted small' }, hint)));
  };

  async function runTest(text, asCommand, event) {
    const b = await save(); if (!b) return;
    out.replaceChildren(el('div', { class: 'muted small' }, 'running...'));
    try {
      const r = await api('POST', `/api/bots/${st.id}/test`, { text, command: asCommand, event: event || 'message' }, { quiet: true });
      out.replaceChildren(
        ...r.replies.map((t) => el('div', { class: 'bkreply' }, el('b', null, st.name), el('span', null, t))),
        ...(r.actions || []).map((a) => el('div', { class: 'bkreply' }, el('b', null, a.type), el('span', null, (a.text ? a.text + ' - ' : '') + a.note))),
        r.replies.length || (r.actions && r.actions.length) || r.error ? null : el('div', { class: 'muted small' }, 'the bot did not do anything'),
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
      el('div', { class: 'muted small' }, 'write function onMessage(msg) and call reply("text") to talk. it runs in a locked box: no internet, no files, 60ms limit. turn on powers below to let it react, delete, mute and more.'),
      el('details', null, el('summary', { class: 'small' }, 'everything your bot can do'), el('pre', { class: 'bklog' }, JS_DOCS)));
    else editor = el('div', { class: 'col gap-s' },
      el('textarea', { rows: 8, maxLength: 1500, placeholder: 'who is this bot? how does it talk? what does it know? e.g. "you are a pirate who answers questions about school lunch. keep it funny."', oninput: (e) => { st.context = e.target.value; } }, st.context),
      el('div', { class: 'muted small' }, 'powered by the hack club ai (gemini). in rooms and groups it answers when someone @mentions it, in dms it answers everything. each bot gets 40 ai replies an hour. ai bots can use the quote, greet and timer powers.'));
    const testIn = el('input', { placeholder: 'type a message to try it', onkeydown: (e) => { if (e.key === 'Enter') runTest(testIn.value, false); } });
    const anyMod = [...new Set([...st.powers, ...inferred(st)])].some((p) => ['delete', 'pin', 'mute', 'slow', 'kick', 'topic', 'roles'].includes(p));
    const powerBox = el('div', { class: 'col gap-s' },
      el('h4', null, 'powers'),
      el('div', { class: 'muted small' }, 'what this bot is allowed to do. the owner checks them when you send the bot for approval. moderation powers only work in groups where the host gave the bot the mod or host role.'),
      ...POWER_GROUPS.map(([title, all]) => ({ title, list: all.filter(([k]) => st.kind !== 'ai' || ['quote', 'welcome', 'schedule'].includes(k)) })).filter((g) => g.list.length).map(({ title, list }) => el('div', { class: 'col gap-s' }, el('div', { class: 'muted small', style: 'margin-top:6px' }, title), ...list.map(([k, l, h]) => powerToggle(k, l, h)))),
      (st.powers.includes('schedule') || inferred(st).has('schedule')) ? el('div', { class: 'row gap-s', style: 'align-items:center' }, el('span', null, 'run every'), el('input', { type: 'number', min: 15, max: 1440, style: 'width:90px', value: st.tickMin || 60, oninput: (e) => { st.tickMin = Math.max(15, Math.min(1440, parseInt(e.target.value, 10) || 60)); } }), el('span', { class: 'muted small' }, 'minutes (15 to 1440). it only posts in rooms where someone talked today.')) : null,
      anyMod ? el('div', { class: 'form-err' }, 'moderation powers get a closer look from the owner, and a group host has to give the bot a mod or host role before they do anything.') : null);
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
      powerBox,
      el('h4', null, 'try it'),
      el('div', { class: 'row gap-s', style: 'flex-wrap:wrap' }, testIn, el('button', { class: 'btn', style: 'white-space:nowrap', onclick: () => runTest(testIn.value, false) }, 'send'), el('button', { class: 'btn', style: 'white-space:nowrap', title: 'like someone typing /bot name text', onclick: () => runTest(testIn.value, true) }, 'as /bot'), el('button', { class: 'btn', style: 'white-space:nowrap', title: 'pretend someone just joined', onclick: () => runTest('', false, 'join') }, 'as join'), el('button', { class: 'btn', style: 'white-space:nowrap', title: 'pretend the timer fired', onclick: () => runTest('', false, 'tick') }, 'as timer')),
      el('div', { class: 'muted small' }, 'the test only shows what it would do. nothing is deleted, muted or sent for real.'),
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
      ...(d.bots.length ? d.bots.map((b) => el('div', { class: 'urow' }, avatar(b.name, 36), el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, b.name, el('span', { class: 'muted small' }, '  by ' + (b.owner || 'someone'))), el('div', { class: 'muted small' }, b.description || b.kind), el('div', { class: 'row gap-s wraprow', style: 'margin-top:4px' }, b.allowPublic ? el('span', { class: 'tag' }, 'rooms') : null, b.allowDm ? el('span', { class: 'tag' }, 'dms') : null, b.allowGroups ? el('span', { class: 'tag' }, 'groups') : null, ...powerTags(b.powers))),
        el('div', { class: 'col gap-s' },
          hostedFor(b).length ? el('button', { class: 'btn small primary', onclick: () => pickGroupFor(b) }, ic('plus', 14), 'add to my group') : null,
          b.allowDm ? el('button', { class: 'btn small', onclick: () => { m.close(); U.startDM(b.name); } }, 'message') : null))) : [el('div', { class: 'muted pad' }, 'no bots yet, be the first')]),
      el('button', { class: 'btn', onclick: () => { m.close(); myBots(); } }, ic('plus', 16), 'make your own'));
  } catch (e) { body.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
}

const hostedFor = (b) => S.convs.filter((c) => c.type === 'group' && c.role === 'admin' && !c.systemKind && (c.isPublic ? b.allowPublic : b.allowGroups) && !c.members.some((x) => x.id === b.id));

function botAddModal(c, b, after) {
  const state = { role: 'member' };
  const hasMod = (b.powers || []).some((p) => ['delete', 'pin', 'mute', 'slow', 'kick', 'topic', 'roles'].includes(p));
  const body = el('div', { class: 'col gap-s' });
  const m = modal('add ' + b.name + ' to ' + c.name, body);
  m.box.style.zIndex = 420;
  const draw = () => {
    body.replaceChildren(
      el('div', { class: 'muted small' }, b.description || b.kind),
      (b.powers || []).length ? el('div', { class: 'col gap-s' }, el('div', { class: 'muted small' }, 'this bot can'), el('div', { class: 'row gap-s wraprow' }, ...powerTags(b.powers))) : el('div', { class: 'muted small' }, 'this bot only chats, it has no special powers.'),
      hasMod ? el('div', { class: 'col gap-s' },
        el('div', { class: 'muted small' }, 'role in this group'),
        el('div', { class: 'seg small' }, ['member', 'mod', 'admin'].map((r) => el('button', { class: state.role === r ? 'on' : '', onclick: () => { state.role = r; draw(); } }, ROLE_LABEL[r]))),
        el('div', { class: 'muted small' }, state.role === 'member' ? 'as a member its moderation powers do nothing, only chat powers work.' : state.role === 'mod' ? 'a mod bot can delete, pin and mute like a human mod.' : 'a host bot can also remove people, change the description and make mods. you can still take the role back any time.')) : null,
      c.isPublic ? null : el('div', { class: 'form-err' }, 'a bot in a private group can read every message in it, and its owner controls how it works. only add bots you trust.'),
      el('button', { class: 'btn primary', onclick: async () => {
        try {
          if (c.isPublic) await api('POST', `/api/conversations/${c.id}/bots`, { botId: b.id, role: state.role });
          else {
            const { raw } = await keyFor(c, c.keyVersion);
            const w = await wrapGroupKey(raw, b.publicKey, b.id);
            await api('POST', `/api/conversations/${c.id}/members`, { userId: b.id, ...w });
            if (state.role !== 'member') await api('PATCH', `/api/conversations/${c.id}/bots/${b.id}`, { role: state.role });
          }
          await loadConvs(); toast(b.name + ' is in', 'success'); m.close(); after && after();
        } catch (e) { toast(e.message, 'error'); }
      } }, ic('plus', 16), 'add to group'));
  };
  draw();
}

function pickGroupFor(b) {
  const list = hostedFor(b);
  const m = modal('add ' + b.name + ' to', el('div', { class: 'ulist tall' }, list.length ? list.map((c) => el('div', { class: 'urow click', onclick: () => { m.close(); botAddModal(c, b); } }, ic(c.isPublic ? 'globe' : 'users', 16), el('div', { class: 'grow' }, c.name), el('span', { class: 'tag' }, c.isPublic ? 'public' : 'private'))) : [el('div', { class: 'muted pad' }, 'you are not the host of a group this bot can join')]));
  m.box.style.zIndex = 410;
}

async function groupBotPicker(c, after) {
  const body = el('div', { class: 'col gap-s' });
  const m = modal('add a bot', body, { wide: true });
  m.box.style.zIndex = 400;
  try {
    const d = await api('GET', '/api/bots/directory');
    const list = d.bots.filter((b) => (c.isPublic ? b.allowPublic : b.allowGroups) && !c.members.some((x) => x.id === b.id));
    body.replaceChildren(
      el('div', { class: 'muted small' }, 'pick a bot, then choose what role it gets here. a bot can only moderate if you make it a mod or host.'),
      ...(list.length ? list.map((b) => el('div', { class: 'urow click', onclick: () => botAddModal(c, b, () => { m.close(); after && after(); }) }, avatar(b.name, 34), el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, b.name, el('span', { class: 'muted small' }, '  by ' + (b.owner || 'someone'))), el('div', { class: 'muted small' }, b.description || b.kind), el('div', { class: 'row gap-s wraprow', style: 'margin-top:4px' }, ...powerTags(b.powers))))) : [el('div', { class: 'muted pad' }, c.isPublic ? 'no bots are made for public groups yet' : 'no bots allow private groups yet')]));
  } catch (e) { body.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
}

function botsSection(c, redraw) {
  const bots = c.members.filter((x) => x.isBot && x.username !== 'gng');
  if (c.role !== 'admin' && !S.me.isAdmin) return null;
  if (c.systemKind) return null;
  return el('div', null,
    el('h4', null, ic('sparkle', 14), 'bots'),
    ...(bots.length ? bots.map((u) => {
      const sel = el('select', { onchange: async () => { try { await api('PATCH', `/api/conversations/${c.id}/bots/${u.id}`, { role: sel.value }); await loadConvs(); toast(u.displayName + ' is now ' + ROLE_LABEL[sel.value], 'success'); redraw(); } catch (e) { toast(e.message, 'error'); sel.value = u.role || 'member'; } } }, ['member', 'mod', 'admin'].map((r) => el('option', { value: r, selected: (u.role || 'member') === r }, ROLE_LABEL[r])));
      return el('div', { class: 'urow' }, avatar(u.displayName, 30), el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, u.displayName), el('div', { class: 'muted small' }, '@' + u.username)), sel,
        el('button', { class: 'icon-btn', title: 'remove bot', onclick: async () => {
          if (!(await confirmModal('remove ' + u.displayName + '?', c.isPublic ? 'it leaves the group right away.' : 'the group key changes so it cannot read anything new.', 'remove'))) return;
          try {
            if (c.isPublic) await api('DELETE', `/api/conversations/${c.id}/bots/${u.id}`);
            else { if ((u.role || 'member') !== 'member') await api('PATCH', `/api/conversations/${c.id}/bots/${u.id}`, { role: 'member' }); await U.removeMember(c, u.id); }
            await loadConvs(); redraw();
          } catch (e) { toast(e.message, 'error'); }
        } }, ic('x', 16)));
    }) : [el('div', { class: 'muted small' }, 'no bots here yet.')]),
    el('button', { class: 'btn small', style: 'margin-top:8px', onclick: () => groupBotPicker(c, redraw) }, ic('plus', 14), 'add a bot'));
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
        (b.powers || []).length ? el('div', { class: 'row gap-s wraprow' }, el('span', { class: 'muted small' }, 'powers:'), ...powerTags(b.powers), b.tickMin ? el('span', { class: 'muted small' }, 'every ' + b.tickMin + ' min') : null) : el('div', { class: 'muted small' }, 'powers: none, chat only'),
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

Object.assign(window.__ext, { myBots, botDirectory: directory, groupBotPicker, botsSection, runBotCommand, botBody, ownerBots });
})();

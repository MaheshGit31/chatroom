/* ===== Chatroom client: chat extras (replies, mentions, search, do not disturb, view once, photos, forwards, reminders, wallpapers, slash commands) ===== */
(() => {
'use strict';
const C = window.__core, U = window.__ui;
const { S, el, $, ic, avatar, api, toast, convOf, sendPayload, convTitle, memberOf, fmtTime, fmtDay, rid } = C;
const { modal, confirmModal } = U;
const X0 = window.__ext;                                     // older extras, some are wrapped below
const oldSuggest = X0.suggest, oldSuggestKey = X0.suggestKey;

// ---------- small shared bits ----------
const betaGate = (what) => {                                 // true when beta is on, otherwise points to the beta tab
  if (C.betaActive()) return true;
  toast(`${what} is a beta feature`, 'error', () => { S.view = 'beta'; U.renderAll(); });
  return false;
};
const niceSecs = (s) => (s < 90 ? Math.round(s) + 's' : s < 5400 ? Math.round(s / 60) + ' min' : s < 172800 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' days');
const parseSecs = (txt, dflt = 'm') => {                      // 30s, 10m, 2h, 1d, 1w -> seconds (0 when it does not parse)
  const m = String(txt || '').trim().toLowerCase().match(/^(\d{1,5})\s*(s|sec|m|min|h|hr|d|w)?$/);
  if (!m) return 0;
  const n = parseInt(m[1], 10), u = m[2] || dflt;
  return n * (u.startsWith('s') ? 1 : u.startsWith('m') ? 60 : u.startsWith('h') ? 3600 : u === 'd' ? 86400 : 604800);
};
const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const chat = () => U.chatRef();
const staffOf = (c) => c && c.type === 'group' && U.myRank(c) >= 1;

// ---------- do not disturb ----------
function dndActive() {
  const m = S.me; if (!m) return false;
  const now = new Date();
  if (m.dndUntil && new Date(m.dndUntil) > now) return true;
  const z = m.quiet;
  if (z && /^\d\d:\d\d$/.test(z.from || '') && /^\d\d:\d\d$/.test(z.to || '')) {
    const local = new Date(now.getTime() - (Number(z.tz) || 0) * 60000);
    const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
    const t = (s) => { const [h, mm] = s.split(':').map(Number); return h * 60 + mm; };
    const f = t(z.from), to = t(z.to);
    if (f === to) return false;
    return f < to ? mins >= f && mins < to : mins >= f || mins < to;
  }
  return false;
}
async function setDnd(body) {
  const d = await api('PUT', '/api/me/dnd', body);
  S.me.dndUntil = d.dndUntil; S.me.quiet = d.quiet;
  U.renderAll();
  return d;
}
function dndModal() {
  const body = el('div');
  const m = modal('do not disturb', body);
  const draw = () => {
    const until = S.me.dndUntil && new Date(S.me.dndUntil) > new Date() ? new Date(S.me.dndUntil) : null;
    const z = S.me.quiet;
    const from = el('input', { type: 'time', value: z ? z.from : '22:00' }), to = el('input', { type: 'time', value: z ? z.to : '07:00' });
    const go = async (mins) => { try { await setDnd({ minutes: mins }); draw(); } catch (e) { toast(e.message, 'error'); } };
    const tomorrow = () => { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(8, 0, 0, 0); return Math.round((t - Date.now()) / 60000); };
    body.replaceChildren(
      el('p', { class: 'muted small', style: 'margin-top:0' }, 'no sounds, popups or pushes. you still get your messages, and reminders still show up in the app.'),
      until ? el('div', { class: 'card-s' }, ic('moon', 16), el('span', { class: 'grow' }, `on until ${fmtTime(until)}${until.toDateString() !== new Date().toDateString() ? ' tomorrow' : ''}`), el('button', { class: 'btn small', onclick: () => go(null) }, 'turn off')) : null,
      el('div', { class: 'row gap wraprow' }, [['30 min', 30], ['1 hour', 60], ['4 hours', 240], ['until tomorrow', tomorrow()]].map(([l, v]) => el('button', { class: 'btn small', onclick: () => go(v) }, l))),
      el('h4', null, ic('clock', 14), 'quiet hours'),
      el('p', { class: 'muted small', style: 'margin-top:0' }, 'repeats every day, in your timezone.'),
      el('div', { class: 'row gap' }, el('label', { class: 'grow', style: 'margin:0' }, 'from', from), el('label', { class: 'grow', style: 'margin:0' }, 'to', to)),
      el('div', { class: 'row gap', style: 'margin-top:10px' },
        el('button', { class: 'btn primary grow', onclick: async () => { try { await setDnd({ quiet: { from: from.value, to: to.value, tz: new Date().getTimezoneOffset() } }); toast('quiet hours saved', 'success'); draw(); } catch (e) { toast(e.message, 'error'); } } }, 'save quiet hours'),
        z ? el('button', { class: 'btn', onclick: async () => { try { await setDnd({ quiet: null }); draw(); } catch (e) { toast(e.message, 'error'); } } }, 'remove') : null));
  };
  draw();
}

// ---------- slow mode, mutes: what blocks sending right now ----------
const slowLabel = (s) => (s % 60 === 0 ? s / 60 + 'm' : s + 's');
function sendBlock(c) {
  if (!c) return null;
  const now = Date.now();
  const gm = S.me.mutedUntil ? new Date(S.me.mutedUntil) - now : 0;
  if (gm > 0) return { secs: Math.ceil(gm / 1000), text: `an admin muted you for another ${niceSecs(gm / 1000)}`, kind: 'mute' };
  const cm = c.mutedUntil ? new Date(c.mutedUntil) - now : 0;
  if (cm > 0) return { secs: Math.ceil(cm / 1000), text: `you are muted in this group for another ${niceSecs(cm / 1000)}`, kind: 'mute' };
  if (c.slowUntil && c.slowUntil > now && !(S.me.isAdmin || c.role === 'admin' || c.role === 'mod')) { const s = Math.ceil((c.slowUntil - now) / 1000); return { secs: s, text: `slow mode, wait ${s}s`, kind: 'slow' }; }
  return null;
}
function drawModbar(c) {
  const b = chat().modbar; if (!b || !c || chat().convId !== c.id) return;
  const blk = sendBlock(c);
  if (blk) b.replaceChildren(ic(blk.kind === 'mute' ? 'mute' : 'timer', 14), blk.text);
  else if (c.slowSeconds) b.replaceChildren(ic('timer', 14), `slow mode: one message every ${niceSecs(c.slowSeconds)}`);
  else b.replaceChildren();
  b.classList.toggle('on', !!blk || !!c.slowSeconds);
  b.classList.toggle('hot', !!blk);
}

// ---------- replies ----------
const snipOf = (p) => String(C.previewText(p, false) || '').replace(/\s+/g, ' ').slice(0, 90);
function setReply(c, m) {
  const p = m._p || {};
  const s = memberOf(c, m.senderId);
  c._reply = { id: m.id, uid: m.senderId, name: m.senderId === S.me.id ? S.me.displayName : s ? s.displayName : 'someone', snip: snipOf(p.t === 'once' ? { t: 'once' } : p) };
  drawReply(c);
  const r = chat(); if (r.input) r.input.focus();
}
function drawReply(c) {
  const b = chat().replybar; if (!b || !c || chat().convId !== c.id) return;
  if (!c._reply) { b.classList.remove('on'); b.replaceChildren(); return; }
  b.classList.add('on');
  b.replaceChildren(ic('reply', 15), el('div', { class: 'grow' }, el('b', null, 'replying to ' + (c._reply.uid === S.me.id ? 'yourself' : c._reply.name)), el('span', null, c._reply.snip)),
    el('button', { class: 'icon-btn tiny', title: 'cancel', onclick: () => { c._reply = null; drawReply(c); } }, ic('x', 14)));
}
function quoteEl(c, r) {
  return el('div', { class: 'rquote click', onclick: (e) => { e.stopPropagation(); jumpTo(c, r.id); } }, el('b', null, r.uid === S.me.id ? 'you' : String(r.name || 'someone').slice(0, 32)), el('span', null, String(r.snip || '').slice(0, 120)));
}
async function jumpTo(c, id) {
  if (!c) return;
  if (S.active !== c.id || S.view !== 'chats') { await U.openConv(c.id); }
  const find = () => document.querySelector(`.msgs [data-mid="${id}"]`);
  let n = find(), pages = 0;
  while (!n && c.hasMore && pages < 20) { await C.loadMessages(c, true); c._shown = null; U.renderMessages(c); n = find(); pages++; }
  if (!n) return toast('that message is gone or too far back', 'error');
  n.scrollIntoView({ block: 'center', behavior: 'smooth' });
  n.classList.add('flash'); setTimeout(() => n.classList.remove('flash'), 1800);
}

// ---------- mentions ----------
const mentionRe = /(^|[^a-z0-9_])@([a-z0-9_]{3,20})/gi;
function mentionIds(c, text) {
  const ids = new Set();
  for (const m of String(text).matchAll(mentionRe)) { const u = c.members.find((x) => x.username === m[2].toLowerCase()); if (u && u.id !== S.me.id) ids.add(u.id); }
  return [...ids].slice(0, 5);
}
const mentionsMe = (text) => new RegExp('(^|[^a-z0-9_])@' + S.me.username + '(?![a-z0-9_])', 'i').test(String(text));

// ---------- slash commands ----------
const CMDS = [
  { n: 'help', d: 'every command you can use', who: 'all' },
  { n: 'dnd', a: '30m | 2h | off', d: 'do not disturb', who: 'all' },
  { n: 'search', a: 'words', d: 'search this chat', who: 'all' },
  { n: 'remind', a: '10m note', d: 'remind me later (beta)', who: 'all' },
  { n: 'block', a: '@user', d: 'block someone', who: 'all' },
  { n: 'unblock', a: '@user', d: 'unblock someone', who: 'all' },
  { n: 'shrug', a: 'text', d: 'add a shrug', who: 'all' },
  { n: 'mute', a: '@user 10m', d: 'mute someone in this group', who: 'mod' },
  { n: 'unmute', a: '@user', d: 'let them talk again', who: 'mod' },
  { n: 'kick', a: '@user', d: 'remove someone from this group', who: 'mod' },
  { n: 'slow', a: '10s | 1m | off', d: 'slow mode for this group', who: 'mod' },
  { n: 'modlog', d: 'what the mods did here', who: 'mod' },
  { n: 'gng', a: 'on | off', d: 'invite or dismiss the gng bot (public rooms)', who: 'mod' },
  { n: 'mod', a: '@user', d: 'make someone a mod', who: 'host' },
  { n: 'unmod', a: '@user', d: 'take mod away', who: 'host' },
  { n: 'ban', a: '@user reason', d: 'suspend an account', who: 'admin' },
  { n: 'unban', a: '@user', d: 'restore an account', who: 'admin' },
  { n: 'gmute', a: '@user 1h', d: 'mute someone everywhere', who: 'admin' },
  { n: 'ungmute', a: '@user', d: 'lift a global mute', who: 'admin' },
  { n: 'warn', a: '@user reason', d: 'send a warning', who: 'admin' },
  { n: 'verify', a: '@user', d: 'verify someone', who: 'admin' },
  { n: 'unverify', a: '@user', d: 'remove verification', who: 'admin' },
  { n: 'beta', a: '@user 1w | clear', d: 'give or remove beta', who: 'admin' },
  { n: 'whois', a: '@user', d: 'look someone up', who: 'admin' },
  { n: 'announce', a: 'title | message', d: 'announce to everyone online', who: 'admin' },
  { n: 'audit', d: 'open the audit log', who: 'admin' },
  { n: 'stats', d: 'open the stats page', who: 'admin' },
  { n: 'appeals', d: 'open the appeals', who: 'admin' },
];
function allowed(cmd, c) {
  if (cmd.who === 'all') return true;
  if (cmd.who === 'admin') return !!S.me.isAdmin;
  if (cmd.who === 'mod') return staffOf(c);
  if (cmd.who === 'host') return !!c && c.type === 'group' && (c.role === 'admin' || S.me.isAdmin);
  return false;
}
const availableCmds = (c) => CMDS.filter((x) => allowed(x, c));
function helpModal(c, input) {
  const m = modal('commands', el('div', null, el('p', { class: 'muted small', style: 'margin-top:0' }, 'type these in any chat. tap one to put it in the box.'),
    ...['all', 'mod', 'host', 'admin'].map((w) => { const list = availableCmds(c).filter((x) => x.who === w); return list.length ? el('div', null, el('h4', null, { all: 'everyone', mod: 'mods and hosts (groups)', host: 'group hosts', admin: 'admins' }[w]),
      list.map((x) => el('button', { class: 'cmdrow', onclick: () => { m.close(); const i = chat().input; if (i) { i.value = '/' + x.n + ' '; i.focus(); i.dispatchEvent(new Event('input')); } } }, el('b', null, '/' + x.n), x.a ? el('i', null, x.a) : null, el('span', { class: 'muted' }, x.d)))) : null; })));
}
const firstWord = (s) => { const m = String(s).trim().match(/^@?([a-z0-9_]{1,20})\s*(.*)$/is); return m ? { user: m[1].toLowerCase(), rest: m[2].trim() } : { user: '', rest: '' }; };

async function slash(c, raw) {
  const m = raw.match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i);
  if (!m) return false;
  const cmd = CMDS.find((x) => x.n === m[1].toLowerCase());
  if (!cmd) return false;                                    // not one of ours, so it is just a message
  const arg = (m[2] || '').trim();
  if (!allowed(cmd, c)) { toast(`you cannot use /${cmd.n} here`, 'error'); return true; }
  const ok = (t) => toast(t, 'success');
  const fail = (e) => toast(e.message || String(e), 'error');
  const target = () => { const w = firstWord(arg); if (!w.user) { toast(`use /${cmd.n} ${cmd.a || '@user'}`, 'error'); return null; } return w; };
  const member = (w) => { const u = c.members.find((x) => x.username === w.user); if (!u) toast(`@${w.user} is not in this group`, 'error'); return u; };
  try {
    switch (cmd.n) {
      case 'help': helpModal(c); break;
      case 'dnd': {
        if (/^(off|stop|0)$/i.test(arg)) { await setDnd({ minutes: null }); ok('do not disturb is off'); break; }
        const s = parseSecs(arg || '1h');
        if (!s) { dndModal(); break; }
        await setDnd({ minutes: Math.max(1, Math.round(s / 60)) }); ok(`do not disturb for ${niceSecs(s)}`); break;
      }
      case 'search': searchModal(c, arg); break;
      case 'remind': {
        if (!betaGate('reminders')) break;
        const w = String(arg).match(/^(\S+)\s*([\s\S]*)$/);
        const s = w ? parseSecs(w[1]) : 0;
        if (!s || s < 60) { toast('use /remind 10m call mum  (minutes, h, d)', 'error'); break; }
        if (!w[2].trim()) { toast('say what to remind you about', 'error'); break; }
        await api('POST', '/api/reminders', { minutes: Math.round(s / 60), note: w[2].trim(), convId: c.id }); ok(`i will remind you in ${niceSecs(s)}`); break;
      }
      case 'block': case 'unblock': { const w = target(); if (!w) break; await api(cmd.n === 'block' ? 'POST' : 'DELETE', '/api/blocks/' + encodeURIComponent(w.user)); ok(`@${w.user} ${cmd.n}ed`); break; }
      case 'shrug': { const text = ((arg ? arg + ' ' : '') + '¯\\_(ツ)_/¯'); await sendPayload(c, { t: 'text', text }); break; }
      case 'mute': {
        if (c.type !== 'group') { toast(S.me.isAdmin ? 'mutes work inside groups, use /gmute @user to mute someone everywhere' : 'mutes only work in groups', 'error'); break; }
        const w = target(); if (!w) break; const u = member(w); if (!u) break;
        const s = parseSecs(w.rest || '10m') || 600;
        await api('POST', `/api/conversations/${c.id}/mutes/${u.id}`, { minutes: Math.max(1, Math.round(s / 60)) }); ok(`@${u.username} is muted for ${niceSecs(s)}`); break;
      }
      case 'unmute': { const w = target(); if (!w) break; const u = member(w); if (!u) break; await api('DELETE', `/api/conversations/${c.id}/mutes/${u.id}`); ok(`@${u.username} can talk again`); break; }
      case 'kick': {
        const w = target(); if (!w) break; const u = member(w); if (!u) break;
        if (u.id === S.me.id) { toast('use the leave button for that', 'error'); break; }
        if (!(U.myRank(c) > U.rankR(u.isAdmin, u.role))) { toast('you cannot remove them', 'error'); break; }
        if (await confirmModal(`remove @${u.username}?`, c.isPublic ? 'they cannot rejoin.' : 'the group key changes, so they cannot read anything new.', 'remove')) { await U.removeMember(c, u.id); ok(`@${u.username} was removed`); }
        break;
      }
      case 'slow': {
        if (c.type !== 'group') { toast('slow mode is for groups', 'error'); break; }
        const s = /^(off|0|none)$/i.test(arg) ? 0 : parseSecs(arg, 's');
        if (![0, 5, 10, 30, 60, 300, 900].includes(s)) { toast('slow mode can be 5s, 10s, 30s, 1m, 5m, 15m or off', 'error'); break; }
        await api('PUT', `/api/conversations/${c.id}/slow`, { seconds: s }); ok(s ? `slow mode on: one message every ${niceSecs(s)}` : 'slow mode is off'); break;
      }
      case 'modlog': X0.modlogModal(c); break;
      case 'gng': {
        if (!c.isPublic) { toast('gng only joins public rooms, private chats are encrypted so he cannot read them', 'error'); break; }
        const on = !/^(off|leave|stop|0)$/i.test(arg);
        await api('PUT', `/api/conversations/${c.id}/gng`, { on }); ok(on ? 'gng joined, say hi' : 'gng left'); break;
      }
      case 'mod': case 'unmod': {
        const w = target(); if (!w) break; const u = member(w); if (!u) break;
        await api('POST', `/api/conversations/${c.id}/mods/${u.id}`, { on: cmd.n === 'mod' }); ok(cmd.n === 'mod' ? `@${u.username} is a mod now` : `@${u.username} is not a mod anymore`); break;
      }
      case 'audit': case 'stats': case 'appeals': U.goAdminTab(cmd.n === 'audit' ? 'audit' : cmd.n); break;
      case 'announce': { const r = await api('POST', '/api/cmd', { cmd: 'announce', arg }); ok(r.message); break; }
      default: {                                             // ban unban gmute ungmute warn verify unverify beta whois
        const w = target(); if (!w) break;
        if (cmd.n === 'ban' && !(await confirmModal(`suspend @${w.user}?`, 'they are signed out right away and can appeal.', 'suspend'))) break;
        const r = await api('POST', '/api/cmd', { cmd: cmd.n, target: w.user, arg: w.rest });
        if (cmd.n === 'whois') whoisModal(r.info); else ok(r.message);
      }
    }
  } catch (e) { fail(e); }
  return true;
}
function whoisModal(i) {
  const row = (k, v) => el('div', { class: 'urow' }, el('div', { class: 'grow muted' }, k), el('b', null, v));
  modal('@' + i.username, el('div', null, row('name', i.displayName), row('joined', fmtDay(i.joined)), row('messages', i.messages), row('verified', i.verified ? 'yes' : 'no'), row('beta', i.beta ? 'until ' + fmtDay(i.betaUntil) : 'no'), row('online', i.online ? 'yes' : 'no'),
    i.isAdmin ? row('role', 'admin') : null, i.banned ? row('suspended', i.banReason || 'yes') : null, i.mutedUntil && new Date(i.mutedUntil) > new Date() ? row('muted until', fmtTime(i.mutedUntil)) : null));
}

// ---------- suggestions: / commands, @ people, then the old :emoji: ones ----------
function drawM(input, box) {
  const s = box._m; if (!s) return;
  box.classList.add('on');
  box.replaceChildren(...s.list.map((x, i) => (s.kind === 'cmd'
    ? el('button', { class: 'cmdsug' + (i === s.idx ? ' on' : ''), onmousedown: (e) => { e.preventDefault(); s.idx = i; pickM(input, box); } }, el('b', null, '/' + x.n), x.a ? el('i', null, x.a) : null, el('span', { class: 'muted' }, x.d))
    : el('button', { class: i === s.idx ? 'on' : '', onmousedown: (e) => { e.preventDefault(); s.idx = i; pickM(input, box); } }, avatar(x.displayName, 24, '', x.avatar), el('span', null, x.displayName), el('span', { class: 'muted' }, '@' + x.username)))));
}
function pickM(input, box) {
  const s = box._m; if (!s) return;
  const x = s.list[s.idx];
  input.setRangeText(s.kind === 'cmd' ? '/' + x.n + ' ' : '@' + x.username + ' ', s.start, s.end, 'end');
  box.classList.remove('on'); box._m = null;
  input.dispatchEvent(new Event('input')); input.focus();
}
function suggest(input, box) {
  const c = convOf(S.active);
  const pos = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, pos);
  box._m = null;
  let m = c && before.match(/^\/([a-z]*)$/i);
  if (m) {
    const list = availableCmds(c).filter((x) => x.n.startsWith(m[1].toLowerCase())).slice(0, 8);
    if (list.length) { box._s = null; box._m = { kind: 'cmd', list, idx: 0, start: 0, end: pos }; return drawM(input, box); }
  }
  m = c && before.match(/(^|\s)@([a-z0-9_]{0,20})$/i);
  if (m) {
    const q = m[2].toLowerCase();
    const list = c.members.filter((x) => x.id !== S.me.id && (x.username.startsWith(q) || x.displayName.toLowerCase().startsWith(q))).slice(0, 6);
    if (list.length) { box._s = null; box._m = { kind: 'mention', list, idx: 0, start: pos - q.length - 1, end: pos }; return drawM(input, box); }
  }
  oldSuggest(input, box);                                    // the :emoji: suggestions
}
function suggestKey(e, input, box) {
  const s = box._m;
  if (s && box.classList.contains('on')) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); s.idx = (s.idx + (e.key === 'ArrowDown' ? 1 : s.list.length - 1)) % s.list.length; drawM(input, box); return true; }
    if (e.key === 'Tab' || e.key === 'Enter') {
      if (e.key === 'Enter' && s.kind === 'cmd' && !s.list[s.idx].a && input.value.trim() === '/' + s.list[s.idx].n) return false;   // a finished no-argument command just sends
      if (e.key === 'Enter' && s.kind === 'mention' && input.value.startsWith('/') && input.value.slice(s.start + 1, s.end).toLowerCase() === s.list[s.idx].username) { box.classList.remove('on'); box._m = null; return false; }   // a finished /command @name just sends
      e.preventDefault(); pickM(input, box); return true;
    }
    if (e.key === 'Escape') { box.classList.remove('on'); box._m = null; return true; }
  }
  return oldSuggestKey(e, input, box);
}

// ---------- forwarding ----------
function forwardModal(c, m) {
  const p = m._p || {};
  const list = el('div', { class: 'ulist' });
  const q = el('input', { placeholder: 'find a chat' });
  const mm = modal('forward to...', el('div', null, el('div', { class: 'searchbox' }, ic('search', 16), q), list));
  const draw = () => {
    const needle = q.value.trim().toLowerCase();
    const rows = S.convs.filter((x) => !(x.systemKind === 'beta' && !C.betaActive()) && (!needle || convTitle(x).toLowerCase().includes(needle)));
    list.replaceChildren(...(rows.length ? rows.map((x) => { const o = x.type === 'dm' ? C.other(x) : null; return el('div', { class: 'urow click', onclick: () => doForward(c, m, x, mm) }, o ? avatar(convTitle(x), 36, '', o.avatar) : el('div', { class: 'avatar', style: `width:36px;height:36px;background:${C.tone(x.name || '')}` }, ic(x.isPublic ? 'globe' : 'users', 16)), el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, convTitle(x)), el('div', { class: 'muted small' }, x.type === 'dm' ? 'direct message' : x.isPublic ? 'public group' : 'group')), ic('forward', 16)); }) : [el('div', { class: 'muted pad' }, 'no chats match')]));
  };
  q.addEventListener('input', draw); draw(); q.focus();
  if (!['text', 'gif', 'game', 'image', 'sticker', 'voice'].includes(p.t)) { toast('that kind of message cannot be forwarded', 'error'); mm.close(); }
}
async function doForward(src, m, dst, mm) {
  const p = m._p || {};
  const from = memberOf(src, m.senderId);
  const payload = { ...p }; delete payload.reply; delete payload.fwd;
  payload.fwd = { name: m.senderId === S.me.id ? S.me.displayName : from ? from.displayName : '' };
  let extra;
  try {
    if (['sticker', 'voice', 'image'].includes(p.t) && !betaGate(p.t === 'image' ? 'sending photos' : p.t === 'voice' ? 'voice notes' : 'stickers')) return;
    if (p.t === 'image') {
      if (dst.isPublic || dst.systemKind) return toast('photos are not allowed in public rooms', 'error');
      toast('copying the photo...', 'info');
      const id = await uploadBlob(dst, await fetchBlobBytes(p.blob));   // same encrypted bytes, same key, new home
      payload.blob = id; extra = { blob: id };
    }
    if (await sendPayload(dst, payload, false, extra)) { toast('forwarded to ' + convTitle(dst), 'success'); mm.close(); }
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- search inside a chat ----------
const textOfPayload = (p) => [p.text, p.caption, p.title, p.q, p.name, p.inner && p.inner.caption].filter((x) => typeof x === 'string').join(' ');
async function searchModal(c, preset) {
  const q = el('input', { placeholder: 'search ' + convTitle(c), value: preset || '' });
  const status = el('div', { class: 'muted small', style: 'margin:6px 2px' });
  const list = el('div', { class: 'sres' });
  const mm = modal('search', el('div', null, el('div', { class: 'searchbox' }, ic('search', 16), q), status, list), { wide: true });
  let loaded = false;
  const draw = () => {
    const needle = q.value.trim().toLowerCase();
    if (needle.length < 2) { list.replaceChildren(el('div', { class: 'muted pad' }, 'type 2 or more letters')); return; }
    const hits = c.msgs.filter((x) => !x.deleted && x._p && textOfPayload(x._p).toLowerCase().includes(needle)).reverse().slice(0, 80);
    status.textContent = loaded ? `${hits.length}${hits.length === 80 ? '+' : ''} match${hits.length === 1 ? '' : 'es'} in ${c.msgs.length} messages` : 'still loading older messages...';
    list.replaceChildren(...(hits.length ? hits.map((x) => {
      const s = memberOf(c, x.senderId);
      const t = textOfPayload(x._p), at = t.toLowerCase().indexOf(needle), a = Math.max(0, at - 30);
      return el('div', { class: 'urow click', onclick: () => { mm.close(); jumpTo(c, x.id); } }, avatar(s ? s.displayName : x.senderId === S.me.id ? S.me.displayName : '?', 32, '', s && s.avatar),
        el('div', { class: 'grow' }, el('div', { class: 'small muted' }, (x.senderId === S.me.id ? 'you' : s ? s.displayName : 'someone') + ' · ' + fmtDay(x.createdAt).toLowerCase() + ' ' + fmtTime(x.createdAt)),
          el('div', { class: 'snip' }, (a ? '...' : '') + t.slice(a, at), el('mark', null, t.slice(at, at + needle.length)), t.slice(at + needle.length, at + needle.length + 70))));
    }) : [el('div', { class: 'muted pad' }, 'nothing found')]));
  };
  q.addEventListener('input', C.debounce(draw, 150));
  draw(); q.focus();
  let pages = 0;                                             // pull in the older history so the search sees it all (messages only live a couple of days anyway)
  while (c.hasMore && pages < 20 && mm.box.isConnected) { try { await C.loadMessages(c, true); } catch { break; } pages++; draw(); }
  loaded = true; draw(); c._shown = null;
}

// ---------- encrypted images + view once ----------
const IMG_MAX = 5 * 1024 * 1024;
const blobUrls = new Map();                                  // blob id -> object url, kept for this session
const authHdr = () => ({ Authorization: 'Bearer ' + S.token });
async function fetchBlobBytes(id) {
  const r = await fetch(C.API + '/api/blobs/' + id, { headers: authHdr() }).catch(() => null);
  if (!r) throw new Error('cannot reach the server');
  if (!r.ok) throw new Error(r.status === 404 ? 'that photo is gone' : 'could not load the photo');
  return new Uint8Array(await r.arrayBuffer());
}
async function uploadBlob(c, bytes) {
  const r = await fetch(`${C.API}/api/blobs?conv=${c.id}`, { method: 'POST', headers: { ...authHdr(), 'Content-Type': 'application/octet-stream' }, body: bytes }).catch(() => null);
  if (!r) throw new Error('cannot reach the server');
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.message || d.error || 'upload failed'); e.status = r.status; e.data = d; throw e; }
  return d.id;
}
const imgOk = (p) => p && /^[0-9a-f-]{36}$/i.test(p.blob || '') && /^[A-Za-z0-9+/=_-]{20,60}$/.test(p.key || '') && /^[A-Za-z0-9+/=_-]{10,30}$/.test(p.iv || '') && /^image\/(png|jpeg|gif|webp)$/.test(p.mime || '');
async function decryptBlob(p, bytes) {
  const key = await C.subtle.importKey('raw', C.unb64(p.key), 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await C.subtle.decrypt({ name: 'AES-GCM', iv: C.unb64(p.iv) }, key, bytes));
}
const canvasOf = (bmp, max) => { const k = Math.min(1, max / Math.max(bmp.width, bmp.height)); const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(bmp.width * k)); cv.height = Math.max(1, Math.round(bmp.height * k)); const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(bmp, 0, 0, cv.width, cv.height); return cv; };
const toBlob = (cv, q) => new Promise((ok) => cv.toBlob(ok, 'image/jpeg', q));
async function prepareImage(file) {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('pick a png, jpg, gif or webp picture');
  let blob = file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('could not read that picture');
  if (file.size > IMG_MAX) {                                  // too big: squeeze it as a jpg
    if (file.type === 'image/gif') throw new Error('gifs have to be under 5 MB');
    blob = await toBlob(canvasOf(bmp, 2600), 0.85);
    if (!blob || blob.size > IMG_MAX) throw new Error('that picture is over 5 MB even after shrinking');
  }
  let thumb = '', q = 0.65;
  const tc = canvasOf(bmp, 220);
  do { thumb = tc.toDataURL('image/jpeg', q); q -= 0.1; } while (thumb.length > 22000 && q > 0.2);
  return { blob, w: bmp.width, h: bmp.height, thumb, mime: blob.type };
}
async function sendImage(c, file, opts = {}) {
  const prep = await prepareImage(file);
  const raw = C.rand(32), iv = C.rand(12);
  const key = await C.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await C.subtle.encrypt({ name: 'AES-GCM', iv }, key, await prep.blob.arrayBuffer()));
  const id = await uploadBlob(c, ct);
  const inner = { t: 'image', blob: id, key: C.b64(raw), iv: C.b64(iv), mime: prep.mime, w: prep.w, h: prep.h, size: prep.blob.size };
  if (!opts.once) inner.thumb = prep.thumb;                   // a view once photo carries no preview
  if (opts.caption) inner.caption = opts.caption;
  if (c._reply && !opts.once) inner.reply = c._reply;
  const ok = await sendPayload(c, opts.once ? { t: 'once', inner } : inner, false, { blob: id, ...(opts.once ? { once: true } : {}) });
  if (ok && c._reply) { c._reply = null; drawReply(c); }
  return ok;
}
function pickPhoto(c) {
  if (!betaGate('sending photos')) return;
  if (c.isPublic || c.systemKind) return toast('photos are not allowed in public rooms', 'error');
  const f = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', style: 'display:none' });
  f.addEventListener('change', () => { const file = f.files[0]; f.remove(); if (file) photoModal(c, file); });
  document.body.append(f); f.click();
}
function photoModal(c, file) {
  const url = URL.createObjectURL(file);
  const cap = el('input', { placeholder: 'add a caption (optional)', maxLength: 300 });
  const once = el('input', { type: 'checkbox' });
  const err = el('div', { class: 'form-err' });
  const send = el('button', { class: 'btn primary wide', onclick: async () => {
    const caption = cap.value.trim();
    if (caption && C.F.check(caption)) { err.textContent = 'keep the caption clean'; return; }
    send.disabled = true; send.textContent = 'encrypting and sending...'; err.textContent = '';
    try { if (await sendImage(c, file, { caption, once: once.checked })) { mm.close(); } else { send.disabled = false; send.textContent = 'send'; } }
    catch (e) { err.textContent = e.message; send.disabled = false; send.textContent = 'send'; }
  } }, 'send');
  const mm = modal('send a photo', el('div', null, el('img', { src: url, class: 'photoprev' }), el('div', { class: 'muted small', style: 'margin:6px 0' }, `${fmtSize(file.size)}${file.size > IMG_MAX ? ' - will be shrunk to fit 5 MB' : ''} · encrypted before it leaves your device`),
    cap, c.type === 'dm' ? el('label', { class: 'checkrow' }, once, 'view once (it disappears after they open it)') : null, err, send), { onClose: () => URL.revokeObjectURL(url) });
}
function imageBody(c, m, p) {
  if (!imgOk(p)) return el('div', { class: 'mtext muted-i' }, 'could not show this photo');
  const w = clampN(p.w, 1, 20000, 200), h = clampN(p.h, 1, 20000, 200);
  const k = Math.min(1, 260 / w, 320 / h);
  const thumb = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p.thumb || '') ? p.thumb : '';
  return el('div', { class: 'imgwrap' },
    el('div', { class: 'imgmsg click', onclick: () => openImage(c, m, p) }, thumb ? el('img', { src: thumb, width: Math.round(w * k), height: Math.round(h * k), alt: 'photo', draggable: false }) : el('div', { class: 'imgph', style: `width:${Math.round(w * k)}px;height:${Math.round(h * k)}px` }, ic('image', 28)),
      el('span', { class: 'imgsize' }, ic('expand', 12), fmtSize(clampN(p.size, 1, IMG_MAX * 2, 0)))),
    typeof p.caption === 'string' && p.caption ? el('div', { class: 'mtext' }, U.linkify(p.caption, c)) : null);
}
const clampN = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
async function openImage(c, m, p) {
  try {
    let url = blobUrls.get(p.blob);
    if (!url) { toast('loading the photo...', 'info'); const plain = await decryptBlob(p, await fetchBlobBytes(p.blob)); url = URL.createObjectURL(new Blob([plain], { type: p.mime })); blobUrls.set(p.blob, url); }
    lightbox(url, { download: true });
  } catch (e) { toast(e.message || 'could not open the photo', 'error'); }
}
function lightbox(url, opts = {}) {
  const box = el('div', { class: 'lightbox', onclick: (e) => { if (e.target === box) close(); } },
    el('img', { src: url, alt: 'photo' }),
    el('div', { class: 'lbbar' }, opts.note ? el('span', { class: 'lbnote' }, ic('eye', 14), opts.note) : null, opts.download ? el('a', { class: 'btn small', href: url, download: 'photo' }, 'save') : null, el('button', { class: 'btn small', onclick: () => close() }, 'close')));
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { document.removeEventListener('keydown', onKey); box.remove(); opts.onClose && opts.onClose(); };
  document.addEventListener('keydown', onKey);
  document.body.append(box);
}
function onceBody(c, m, p) {
  const mine = m.senderId === S.me.id;
  const inner = p && p.inner ? p.inner : {};
  const kind = inner.t === 'image' ? 'photo' : 'message';
  if (m.deleted) return el('div', { class: 'oncecard gone' }, ic('eye', 16), 'view once · opened');
  if (mine) return el('div', { class: 'oncecard gone' }, ic('eye', 16), `view once ${kind} · not opened yet`);
  return el('button', { class: 'oncecard', onclick: () => openOnce(c, m, p) }, ic('eye', 18), el('span', { class: 'grow' }, `view once ${kind}`), el('span', { class: 'muted small' }, 'tap to open'));
}
async function openOnce(c, m, p) {
  const inner = p.inner || {};
  try {
    let plain = null;
    if (inner.t === 'image') {
      if (!imgOk(inner)) return toast('could not open that', 'error');
      toast('opening...', 'info');
      plain = await decryptBlob(inner, await fetchBlobBytes(inner.blob));   // fetched first, because opening wipes it on the server
    }
    await api('POST', `/api/messages/${m.id}/viewed`, null, { quiet: true });
    if (inner.t === 'image') { const url = URL.createObjectURL(new Blob([plain], { type: inner.mime })); lightbox(url, { note: 'view once: it is gone after this', onClose: () => URL.revokeObjectURL(url) }); if (inner.caption) toast(inner.caption, 'info'); }
    else modal('view once', el('div', null, el('div', { class: 'mtext oncetext' }, U.linkify(String(inner.text || ''), c)), el('p', { class: 'muted small', style: 'margin-bottom:0' }, 'this message is gone now.')));
  } catch (e) { toast(e.status === 404 ? 'that was already opened' : e.message, 'error'); }
}
function onceModal(c) {
  if (c.type !== 'dm') return toast('view once works in direct messages', 'error');
  const ta = el('textarea', { rows: 4, maxLength: 1500, placeholder: 'this disappears after they open it' });
  const send = el('button', { class: 'btn primary', onclick: async () => {
    const text = C.expandShortcodes(ta.value.trim());
    if (!text) return;
    if (C.F.check(text)) return toast('keep it clean, that was not sent', 'error');
    send.disabled = true;
    if (await sendPayload(c, { t: 'once', inner: { t: 'text', text } }, false, { once: true })) mm.close(); else send.disabled = false;
  } }, 'send');
  const mm = modal('view once message', el('div', null, el('p', { class: 'muted small', style: 'margin-top:0' }, 'they open it once, then it is deleted for both of you. they could still screenshot it, so only send it to people you trust.'), ta,
    el('div', { class: 'row gap', style: 'margin-top:10px' }, el('button', { class: 'btn grow', onclick: () => { mm.close(); pickPhoto(c); } }, ic('image', 16), 'send a photo instead'), send)));
  ta.focus();
}

// ---------- reminders (beta) ----------
function remindModal(c, m) {
  if (!betaGate('reminders')) return;
  const note = el('input', { placeholder: 'note (optional)', maxLength: 120 });
  const custom = el('input', { placeholder: 'or type: 45m, 5h, 2d' });
  const go = async (mins) => {
    if (!mins || mins < 1) return toast('pick a time', 'error');
    try { await api('POST', '/api/reminders', { msgId: m.id, minutes: mins, note: note.value.trim() }); toast(`ok, i will remind you in ${niceSecs(mins * 60)}`, 'success'); mm.close(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const tomorrow = () => { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); return Math.round((t - Date.now()) / 60000); };
  const mm = modal('remind me', el('div', null, el('p', { class: 'muted small', style: 'margin-top:0' }, 'you get a notification. messages vanish after a couple of days, so add a note if it matters. the note is not end-to-end encrypted.'), note,
    el('div', { class: 'row gap wraprow', style: 'margin-top:10px' }, [['10 min', 10], ['1 hour', 60], ['3 hours', 180], ['tomorrow 9am', tomorrow()]].map(([l, v]) => el('button', { class: 'btn small', onclick: () => go(v) }, l))),
    el('div', { class: 'row gap', style: 'margin-top:10px' }, custom, el('button', { class: 'btn', onclick: () => go(Math.round(parseSecs(custom.value) / 60)) }, 'set'))));
}
async function remindersModal() {
  if (!betaGate('reminders')) return;
  const body = el('div', null, el('div', { class: 'muted pad' }, '...'));
  const mm = modal('reminders', body);
  const draw = async () => {
    try {
      const d = await api('GET', '/api/reminders', null, { quiet: true });
      body.replaceChildren(...(d.reminders.length ? d.reminders.map((r) => { const cv = r.convId && convOf(r.convId); return el('div', { class: 'urow' }, ic('bell', 18), el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, r.note || (r.msgId ? 'a message you saved' : 'reminder')), el('div', { class: 'muted small' }, `${fmtDay(r.at).toLowerCase()} ${fmtTime(r.at)}${cv ? ' · ' + convTitle(cv) : ''}`)), el('button', { class: 'icon-btn', title: 'delete', onclick: async () => { await api('DELETE', '/api/reminders/' + r.id).catch(() => {}); draw(); } }, ic('trash', 16))); }) : [el('div', { class: 'muted pad' }, 'nothing waiting. long press a message and tap the bell, or type /remind 1h call mum')]));
    } catch (e) { body.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
  };
  draw();
}

// ---------- wallpapers (beta) ----------
const WP = {
  dusk: 'linear-gradient(160deg,#3a2740,#1e2a4a)', ember: 'linear-gradient(160deg,#4a2418,#2a1410)', moss: 'linear-gradient(160deg,#243a2a,#14241a)', ocean: 'linear-gradient(160deg,#173a4a,#0f2230)',
  plum: 'linear-gradient(160deg,#4a2446,#2a1430)', slate: 'linear-gradient(160deg,#3a4250,#232a34)', night: '#0f0d0b', dots: 'radial-gradient(circle at 1px 1px,rgba(255,255,255,.12) 1px,transparent 0) 0 0/18px 18px,#1c1612',
  sand: 'linear-gradient(160deg,#e8d6b4,#d9bf94)', rose: 'linear-gradient(160deg,#f0c8c4,#e2a6a8)', mint: 'linear-gradient(160deg,#c9e6d2,#a4d1b8)', paper: '#f4ead9',
};
const wpCss = (w) => {
  if (!w) return '';
  if (w.k === 'preset' && WP[w.id]) return WP[w.id];
  if (w.k === 'grad' && /^#[0-9a-f]{6}$/i.test(w.a) && /^#[0-9a-f]{6}$/i.test(w.b)) return `linear-gradient(160deg,${w.a},${w.b})`;
  if (w.k === 'img' && /^https:\/\/[^\s"'()<>\\]+$/.test(w.url || '')) return `center/cover no-repeat url("${w.url}")`;
  return '';
};
const wpOf = (id) => (C.betaActive() ? (S.me.wallpapers || {})[id] || (S.me.wallpapers || {}).default : null);
function applyWallpaper(c) {
  const r = chat(); if (!r.msgs || !c || r.convId !== c.id) return;
  const css = wpCss(wpOf(c.id));
  r.msgs.classList.toggle('haswp', !!css);
  r.msgs.style.background = css;
}
function wallpaperModal(c) {
  if (!betaGate('wallpapers')) return;
  let scope = c ? c.id : 'default';
  const body = el('div');
  const mm = modal('chat wallpaper', body);
  const save = async (wp) => {
    try { const d = await api('PUT', '/api/me/wallpapers', { convId: scope, wp }); S.me.wallpapers = d.wallpapers; applyWallpaper(convOf(S.active)); draw(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const draw = () => {
    const cur = (S.me.wallpapers || {})[scope];
    const a = el('input', { type: 'color', value: cur && cur.k === 'grad' ? cur.a : '#3a2740' }), b = el('input', { type: 'color', value: cur && cur.k === 'grad' ? cur.b : '#1e2a4a' });
    const url = el('input', { placeholder: 'https:// image link', value: cur && cur.k === 'img' ? cur.url : '' });
    body.replaceChildren(
      c ? el('div', { class: 'seg small' }, el('button', { class: scope === c.id ? 'on' : '', onclick: () => { scope = c.id; draw(); } }, 'this chat'), el('button', { class: scope === 'default' ? 'on' : '', onclick: () => { scope = 'default'; draw(); } }, 'every chat')) : el('p', { class: 'muted small', style: 'margin-top:0' }, 'this is the background for every chat. you can still pick a different one inside a chat.'),
      el('p', { class: 'muted small' }, 'only you see your wallpapers.'),
      el('div', { class: 'wpgrid' }, Object.keys(WP).map((id) => el('button', { class: 'wpopt' + (cur && cur.k === 'preset' && cur.id === id ? ' on' : ''), title: id, style: `background:${WP[id]}`, onclick: () => save({ k: 'preset', id }) }))),
      el('h4', null, 'your own colors'),
      el('div', { class: 'row gap' }, a, b, el('button', { class: 'btn grow', onclick: () => save({ k: 'grad', a: a.value, b: b.value }) }, 'use gradient')),
      el('h4', null, 'a picture'),
      el('div', { class: 'row gap' }, url, el('button', { class: 'btn', onclick: () => save({ k: 'img', url: url.value.trim() }) }, 'use')),
      el('p', { class: 'muted small' }, 'a picture is loaded from its website, so that site can see your address.'),
      cur ? el('button', { class: 'btn wide', onclick: () => save(null) }, 'remove wallpaper') : null);
  };
  draw();
}
const wrapBetaChanged = X0.betaChanged;

Object.assign(window.__ext, {
  dndActive, dndModal, sendBlock, drawModbar, slowLabel, setReply, drawReply, quoteEl, jumpTo, mentionIds, mentionsMe, slash, suggest, suggestKey, forwardModal, searchModal,
  imageBody, onceBody, onceModal, pickPhoto, remindModal, remindersModal, wallpaperModal, applyWallpaper, lightbox, whoisModal, niceSecs, parseSecs, betaGate,
  betaChanged: () => { if (wrapBetaChanged) wrapBetaChanged(); applyWallpaper(convOf(S.active)); U.renderHeader(); },
});
})();

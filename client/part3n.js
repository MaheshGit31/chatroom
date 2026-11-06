(() => {
'use strict';
const C = window.__core, U = window.__ui, X = window.__ext;
const { S, el, ic, toast, api, convOf, loadMessages } = C;
const { modal, confirmModal } = U;

const KIND_IC = { text: 'hash', voice: 'volume', video: 'video', stage: 'stage' };
const KIND_HINT = { text: 'type and send, like the main chat', voice: 'hop in and talk', video: 'talk with cameras on', stage: 'mods and invited speakers talk, everyone else listens' };

const pub = (c) => !!c && c.type === 'group' && c.isPublic;
const data = (c) => c._ch || (c._ch = { loaded: false, channels: [], threads: [], staff: false });

async function loadChans(c) {
  const d = data(c);
  if (d.busy) return d.busy;
  d.busy = api('GET', `/api/conversations/${c.id}/channels`, null, { quiet: true }).then((r) => {
    d.channels = r.channels; d.threads = r.threads; d.staff = r.staff; d.max = r.max; d.loaded = true;
  }).catch(() => { d.loaded = true; }).finally(() => { d.busy = null; });
  return d.busy;
}

function unreadOf(c, id) { return (c._subUnread && c._subUnread[id]) || 0; }
function mainUnread(c) { return c._mainPending || 0; }

function drawChanbar(c) {
  const ref = U.chatRef(); if (!ref || !ref.chanbar || ref.convId !== c.id) return;
  const bar = ref.chanbar;
  if (!pub(c)) { bar.replaceChildren(); bar.classList.remove('on'); return; }
  bar.classList.add('on');
  const d = data(c);
  if (!d.loaded) { loadChans(c).then(() => drawChanbar(c)); }
  const inRoom = X.callRoom ? X.callRoom() : null;
  const chip = (cls, icon, label, onclick, extra) => el('button', { class: 'chip ' + cls, onclick }, ic(icon, 14), el('span', null, label), extra);
  const sub = c._sub;
  const chips = [chip(!sub ? 'on' : '', 'chat', 'main', () => openSub(c, null))];
  for (const ch of d.channels) {
    const mine = ch.mine || d.staff;
    const live = ch.live > 0 ? el('b', { class: 'live' }, String(ch.live)) : null;
    const dot = unreadOf(c, ch.id) ? el('i', { class: 'newdot inline' }) : null;
    const del = mine ? el('span', { class: 'chipx', title: 'delete channel', onclick: async (e) => { e.stopPropagation(); if (await confirmModal('delete #' + ch.name + '?', ch.kind === 'text' ? 'its messages go too' : 'anyone inside gets dropped', 'delete')) { try { await api('DELETE', `/api/channels/${ch.id}`, null, { quiet: true }); } catch (er) { toast(er.message, 'error'); } } } }, ic('x', 12)) : null;
    const isOn = ch.kind === 'text' ? (sub && sub.kind === 'channel' && sub.id === ch.id) : inRoom === 'ch:' + ch.id;
    chips.push(chip((isOn ? 'on ' : '') + ch.kind, KIND_IC[ch.kind] || 'hash', ch.name, () => (ch.kind === 'text' ? openSub(c, { kind: 'channel', id: ch.id, name: ch.name }) : X.joinChannel(c, ch)), [live, dot, del]));
  }
  const open = d.threads.slice(0, 40);
  if (open.length) {
    const tu = open.reduce((n, t) => n + unreadOf(c, t.id), 0);
    chips.push(chip(sub && sub.kind === 'thread' ? 'on' : '', 'thread', 'threads', () => threadsModal(c), [el('b', { class: 'count' }, String(open.length)), tu ? el('i', { class: 'newdot inline' }) : null]));
  }
  chips.push(el('button', { class: 'chip add', title: 'new channel or thread', onclick: () => createModal(c) }, ic('plus', 14)));
  const rows = [el('div', { class: 'chips' }, chips)];
  if (sub) {
    rows.push(el('div', { class: 'subline' },
      el('button', { class: 'btn small ghost', onclick: () => openSub(c, sub.kind === 'thread' && sub.channelId ? { kind: 'channel', id: sub.channelId, name: (d.channels.find((x) => x.id === sub.channelId) || {}).name || 'channel' } : null) }, ic('back', 14), 'back'),
      el('span', { class: 'grow' }, sub.kind === 'thread' ? 'thread: ' + sub.name : '#' + sub.name),
      sub.kind === 'thread' ? el('span', { class: 'muted small' }, 'replies stay in here') : null));
  }
  bar.replaceChildren(rows);
}

async function openSub(c, sub) {
  if ((c._sub ? c._sub.id : null) === (sub ? sub.id : null)) return;
  if (sub && sub.kind === 'thread' && !sub.channelId) { const t = data(c).threads.find((x) => x.id === sub.id); if (t) sub.channelId = t.channelId; }
  c._sub = sub || null; c.msgs = []; c.loaded = false; c.hasMore = false; c._shown = null; c._reply = null;
  if (sub && c._subUnread) delete c._subUnread[sub.id];
  drawChanbar(c);
  try { X.drawReply(c); } catch { /* none */ }
  U.renderMessages(c, true);
  try { await loadMessages(c); } catch (e) { toast(e.message, 'error'); }
  const ref = U.chatRef();
  if (ref && ref.input) ref.input.placeholder = sub ? (sub.kind === 'thread' ? 'reply in thread' : 'message #' + sub.name) : 'say something';
  if (S.active === c.id) { U.renderMessages(c, true); if (!sub) C.markRead(c); }
  drawChanbar(c);
}

function threadsModal(c) {
  const d = data(c);
  const list = el('div', { class: 'list' });
  const m = modal('threads', list);
  const paint = () => {
    list.replaceChildren(d.threads.length ? d.threads.map((t) => {
      const chan = t.channelId ? (d.channels.find((x) => x.id === t.channelId) || {}).name : null;
      return el('div', { class: 'urow click', onclick: () => { m.close(); openSub(c, { kind: 'thread', id: t.id, name: t.title, channelId: t.channelId }); } },
        el('div', { class: 'gshare-ic sm', style: `background:${C.tone(t.title)}` }, ic('thread', 16)),
        el('div', { class: 'grow' }, el('div', null, t.title, unreadOf(c, t.id) ? el('i', { class: 'newdot inline' }) : null), el('div', { class: 'muted small' }, `${chan ? '#' + chan + ' · ' : ''}by ${t.creator} · ${C.ago(t.lastAt)}`)),
        (t.mine || d.staff) ? el('button', { class: 'icon-btn tiny', title: 'delete', onclick: async (e) => { e.stopPropagation(); if (await confirmModal('delete this thread?', 'its messages go too', 'delete')) { try { await api('DELETE', `/api/threads/${t.id}`, null, { quiet: true }); } catch (er) { toast(er.message, 'error'); } } } }, ic('trash', 14)) : null);
    }) : el('div', { class: 'muted pad' }, 'no threads yet. hover a message and hit the thread button'));
  };
  paint();
}

function createModal(c) {
  const d = data(c);
  let kind = 'text', what = 'channel';
  const name = el('input', { placeholder: 'name', maxLength: 24 });
  const hint = el('p', { class: 'muted small' });
  const kinds = el('div', { class: 'seg small' });
  const whatRow = el('div', { class: 'seg small' });
  const err = el('div', { class: 'form-err' });
  const paint = () => {
    hint.textContent = what === 'thread' ? 'a side conversation. stays out of the main chat' : KIND_HINT[kind];
    kinds.replaceChildren(['text', 'voice', 'video', ...(d.staff ? ['stage'] : [])].map((k) => el('button', { class: k === kind ? 'on' : '', onclick: () => { kind = k; paint(); } }, ic(KIND_IC[k], 14), k)));
    whatRow.replaceChildren(['channel', 'thread'].map((k) => el('button', { class: k === what ? 'on' : '', onclick: () => { what = k; paint(); } }, k)));
    kinds.style.display = what === 'channel' ? '' : 'none';
    name.placeholder = what === 'thread' ? 'thread title' : 'channel name';
    name.maxLength = what === 'thread' ? 50 : 24;
  };
  const go = el('button', { class: 'btn primary wide', onclick: async () => {
    err.textContent = '';
    go.disabled = true;
    try {
      if (what === 'channel') {
        const r = await api('POST', `/api/conversations/${c.id}/channels`, { name: name.value, kind }, { quiet: true });
        m.close();
        if (!d.channels.some((x) => x.id === r.channel.id)) d.channels.push(r.channel);
        drawChanbar(c);
        if (r.channel.kind === 'text') openSub(c, { kind: 'channel', id: r.channel.id, name: r.channel.name });
      } else {
        const body = { title: name.value };
        if (c._sub && c._sub.kind === 'channel') body.channelId = c._sub.id;
        const r = await api('POST', `/api/conversations/${c.id}/threads`, body, { quiet: true });
        m.close();
        if (!d.threads.some((x) => x.id === r.thread.id)) d.threads.unshift(r.thread);
        openSub(c, { kind: 'thread', id: r.thread.id, name: r.thread.title, channelId: r.thread.channelId });
      }
    } catch (e) { err.textContent = e.message; go.disabled = false; }
  } }, ic('plus', 16), 'create');
  const m = modal('new in ' + c.name, el('div', null, whatRow, kinds, name, hint, err, go));
  paint();
  setTimeout(() => name.focus(), 50);
}

function canThread(c, msg) {
  if (!pub(c) || msg.deleted || msg.threadId) return false;
  const d = data(c);
  if (d.threads.some((t) => t.rootMsgId === msg.id)) return false;
  return !!(S.me.verified || S.me.isAdmin);
}
function threadFromMsg(c, msg) {
  const p = msg._p || {};
  const first = p.t === 'text' ? String(p.text || '').replace(/\s+/g, ' ').slice(0, 40) : '';
  const name = el('input', { value: first, maxLength: 50, placeholder: 'thread title' });
  const err = el('div', { class: 'form-err' });
  const go = el('button', { class: 'btn primary wide', onclick: async () => {
    go.disabled = true; err.textContent = '';
    try {
      const body = { title: name.value, rootMsgId: msg.id };
      if (c._sub && c._sub.kind === 'channel') body.channelId = c._sub.id;
      const r = await api('POST', `/api/conversations/${c.id}/threads`, body, { quiet: true });
      m.close();
      const d = data(c);
      if (!d.threads.some((x) => x.id === r.thread.id)) d.threads.unshift(r.thread);
      openSub(c, { kind: 'thread', id: r.thread.id, name: r.thread.title, channelId: r.thread.channelId });
    } catch (e) { err.textContent = e.message; go.disabled = false; }
  } }, ic('thread', 16), 'start thread');
  const m = modal('start a thread', el('div', null, name, err, go));
  setTimeout(() => { name.focus(); name.select(); }, 50);
}

function onChan(m) {
  const c = convOf(m.convId); if (!c) return;
  const d = data(c);
  if (m.t === 'channel_new') { if (!d.channels.some((x) => x.id === m.channel.id)) d.channels.push({ ...m.channel, mine: m.by === S.me.id }); }
  else if (m.t === 'channel_update') { const x = d.channels.find((y) => y.id === m.id); if (x) x.name = m.name; if (c._sub && c._sub.id === m.id) c._sub.name = m.name; }
  else if (m.t === 'channel_gone') {
    d.channels = d.channels.filter((x) => x.id !== m.id);
    d.threads = d.threads.filter((t) => t.channelId !== m.id);
    if (c._sub && (c._sub.id === m.id || c._sub.channelId === m.id)) { toast('that channel was deleted', 'info'); openSub(c, null); }
  } else if (m.t === 'thread_new') { if (!d.threads.some((x) => x.id === m.thread.id)) d.threads.unshift({ ...m.thread, mine: m.by === S.me.id }); }
  else if (m.t === 'thread_gone') {
    d.threads = d.threads.filter((x) => x.id !== m.id);
    if (c._sub && c._sub.id === m.id) { toast('that thread was deleted', 'info'); openSub(c, c._sub.channelId ? { kind: 'channel', id: c._sub.channelId, name: (d.channels.find((x) => x.id === c._sub.channelId) || {}).name || 'channel' } : null); }
  }
  if (S.active === c.id) drawChanbar(c);
}

function setLive(m) {
  const c = convOf(m.convId); if (!c) return;
  const x = data(c).channels.find((y) => y.id === m.channelId);
  if (x) x.live = m.n;
  if (S.active === c.id) drawChanbar(c);
}

function noteSubActivity(c, msg) {
  if (msg.threadId) { const t = data(c).threads.find((x) => x.id === msg.threadId); if (t) t.lastAt = msg.createdAt; }
}

Object.assign(window.__ext, { drawChanbar, openSub, canThread, threadFromMsg, onChan, setLive, noteSubActivity, chanData: data, loadChans });
})();

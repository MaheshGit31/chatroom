/* ===== Chatroom client: ui (auth, shell, chats, modals, gamesplace, activity) ===== */
(() => {
'use strict';
const C = window.__core;
const { API, SAME_ORIGIN, S, el, $, ic, avatar, fmtTime, fmtDay, fmtDur, ago, debounce, lsGet, lsSet, lsDel, toast, beep, updateBadge, api, kdf, newIdentity, openIdentity, wrapGroupKey, safetyNumber, idbGet, idbSet, idbDel, convOf, other, convTitle, memberOf, sortConvs, mergeConvs, loadConvs, loadMessages, sendPayload, markRead, connectWS, sendWS, rand, b64, unb64, skCache, convKeys, keyFor, hue } = C;
const isMobile = () => matchMedia('(max-width: 760px)').matches;
const app = () => $('#app');

// ---------- generic widgets ----------
function modal(title, content, opts = {}) {
  const back = el('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } });
  const box = el('div', { class: 'modal' + (opts.wide ? ' wide' : '') },
    el('div', { class: 'modal-head' }, el('h3', null, title), el('button', { class: 'icon-btn', title: 'Close', onclick: () => close() }, ic('x'))),
    el('div', { class: 'modal-body' }, content));
  back.append(box);
  document.body.append(back);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  function close() { back.remove(); document.removeEventListener('keydown', onKey); opts.onClose && opts.onClose(); }
  return { close, box };
}
function confirmModal(title, text, okLabel = 'Confirm', danger = true) {
  return new Promise((ok) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; m.close(); ok(v); } };
    const m = modal(title, el('div', null, el('p', { class: 'muted' }, text),
      el('div', { class: 'row end gap' }, el('button', { class: 'btn', onclick: () => finish(false) }, 'Cancel'), el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => finish(true) }, okLabel))), { onClose: () => { if (!done) { done = true; ok(false); } } });
  });
}
function userSearch(onPick, exclude = new Set()) {
  const list = el('div', { class: 'ulist' });
  const input = el('input', { placeholder: 'Search by username', autocomplete: 'off', autocapitalize: 'none', spellcheck: false });
  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { list.replaceChildren(el('div', { class: 'muted pad' }, 'Type at least 2 characters')); return; }
    try {
      const d = await api('GET', '/api/users/search?q=' + encodeURIComponent(q), null, { quiet: true });
      const users = d.users.filter((u) => !exclude.has(u.id));
      list.replaceChildren(...(users.length ? users.map((u) => el('div', { class: 'urow click', onclick: () => onPick(u) }, avatar(u.displayName, 34), el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, u.displayName), el('div', { class: 'muted small' }, '@' + u.username)), ic('plus', 16))) : [el('div', { class: 'muted pad' }, 'No users found')]));
    } catch (e) { list.replaceChildren(el('div', { class: 'muted pad' }, e.status === 429 ? `slow down, retry in ${e.data.retryAfter}s` : e.message)); }
  }, 250);
  input.addEventListener('input', run);
  list.append(el('div', { class: 'muted pad' }, 'Type at least 2 characters'));
  const reset = () => { input.value = ''; list.replaceChildren(el('div', { class: 'muted pad' }, 'Type at least 2 characters')); input.focus(); };
  return { node: el('div', null, el('div', { class: 'searchbox' }, ic('search', 16), input), list), input, reset };
}
const linkify = (text) => {
  const out = [];
  String(text).split(/(https?:\/\/[^\s<>"]+)/g).forEach((part, i) => {
    if (i % 2) out.push(el('a', { href: part, target: '_blank', rel: 'noopener noreferrer nofollow' }, part)); else if (part) out.push(part);
  });
  return out;
};
const isOnline = (c, uid) => { const p = S.presence.get(uid); if (p) return p.online; const m = c && memberOf(c, uid); return !!(m && m.online); };
const activityOf = (uid) => { const p = S.presence.get(uid); return p && p.activity; };
const dot = (on) => el('span', { class: 'pdot ' + (on ? 'on' : '') });

// ---------- auth ----------
function fatal(msg, retry) {
  const a = app(); a.className = 'auth-wrap'; a.replaceChildren(el('div', { class: 'auth-card' }, el('h1', { class: 'logo' }, ic('lock', 26), 'Chatroom'), el('p', { class: 'form-err' }, msg), retry ? el('button', { class: 'btn primary wide', onclick: retry }, 'Try again') : null));
}
function showAuth(mode = 'login', note = '') {
  const a = app(); a.className = 'auth-wrap'; a.replaceChildren();
  const err = el('div', { class: 'form-err', role: 'alert' }, note);
  const user = el('input', { placeholder: 'username', autocomplete: 'username', maxLength: 20, autocapitalize: 'none', spellcheck: false });
  const disp = el('input', { placeholder: 'display name (optional)', maxLength: 32, autocomplete: 'nickname' });
  const pw = el('input', { type: 'password', placeholder: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password' });
  const pw2 = el('input', { type: 'password', placeholder: 'confirm password', autocomplete: 'new-password' });
  const label = mode === 'login' ? 'Sign in' : 'Create account';
  const btn = el('button', { class: 'btn primary wide', type: 'submit' }, label);
  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ''; btn.disabled = true; btn.textContent = 'Deriving keys...';
      try {
        const username = user.value.trim().toLowerCase();
        if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new Error('username: 3-20 chars, a-z 0-9 and _');
        if (mode === 'register') {
          if (pw.value.length < 8) throw new Error('password needs 8+ characters');
          if (pw.value !== pw2.value) throw new Error('passwords do not match');
          const kdfSalt = b64(rand(16));
          const { authSecret, wrapKey } = await kdf(pw.value, kdfSalt);
          const id = await newIdentity(wrapKey);
          const r = await api('POST', '/api/auth/register', { username, displayName: disp.value.trim() || username, kdfSalt, authSecret, publicKey: id.pub, wrappedPriv: id.wrappedPriv, wrappedPrivIv: id.wrappedPrivIv }, { quiet: true });
          await finishAuth(r.token, r.user, id.pub, id.priv);
        } else {
          const { kdfSalt } = await api('POST', '/api/auth/salt', { username }, { quiet: true });
          const { authSecret, wrapKey } = await kdf(pw.value, kdfSalt);
          const r = await api('POST', '/api/auth/login', { username, authSecret }, { quiet: true });
          let priv;
          try { priv = await openIdentity(r.wrappedPriv, r.wrappedPrivIv, wrapKey); } catch { throw new Error('could not unlock your keys'); }
          await finishAuth(r.token, r.user, r.publicKey, priv);
        }
      } catch (ex) {
        err.textContent = ex.status === 429 ? `too many attempts, try again in ${ex.data.retryAfter}s` : ex.message;
        btn.disabled = false; btn.textContent = label;
      }
    },
  },
  el('label', null, 'Username', user), mode === 'register' ? el('label', null, 'Display name', disp) : null,
  el('label', null, 'Password', pw), mode === 'register' ? el('label', null, 'Confirm password', pw2) : null,
  err, btn,
  mode === 'register' ? el('p', { class: 'muted small' }, ic('shield', 14), ' Your password encrypts your private key in this browser. It cannot be reset - if you forget it, your old messages are gone for good.') : null);
  a.append(el('div', { class: 'auth-card' },
    el('h1', { class: 'logo' }, ic('lock', 26), 'Chatroom'),
    el('p', { class: 'muted' }, 'End-to-end encrypted chats, groups, and a games place.'),
    el('div', { class: 'seg' }, el('button', { class: mode === 'login' ? 'on' : '', onclick: () => showAuth('login') }, 'Sign in'), el('button', { class: mode === 'register' ? 'on' : '', onclick: () => showAuth('register') }, 'Create account')),
    form));
  user.focus();
}
async function finishAuth(token, user, publicKey, priv) {
  S.token = token; S.me = { ...user, publicKey }; S.priv = priv;
  lsSet('chatroom.session', JSON.stringify({ token, userId: user.id }));
  await idbSet('priv:' + user.id, priv);
  await startApp();
}
async function logout(forced) {
  const t = S.token;
  if (!forced && t) await api('POST', '/api/auth/logout', null, { quiet: true }).catch(() => {});
  S.token = null;
  if (S.me) await idbDel('priv:' + S.me.id);
  lsDel('chatroom.session'); lsDel('chatroom.last');
  try { S.ws && S.ws.close(); } catch {}
  closePlayer(); clearInterval(actTimer); clearInterval(nowTimer);
  Object.assign(S, { me: null, priv: null, convs: [], keyUsers: {}, active: null, view: 'chats', notifs: [], notifUnread: 0, wsOk: false });
  S.presence.clear(); S.typing.clear(); skCache.clear(); convKeys.clear(); builtMain = '';
  document.title = 'Chatroom';
  showAuth('login', forced ? 'you were signed out' : '');
}
window.__chatroomLogout = logout;

// ---------- shell ----------
let builtMain = '', chatRef = {};
function buildShell() {
  const a = app(); a.className = 'app'; a.replaceChildren();
  const search = el('input', { placeholder: 'Filter chats', id: 'cfilter', oninput: () => renderSide() });
  a.append(
    el('nav', { class: 'rail', id: 'rail' }),
    el('aside', { class: 'side', id: 'side' },
      el('div', { class: 'side-head' }, el('h2', null, 'Chats'), el('div', { class: 'row gap-s' },
        el('button', { class: 'icon-btn', title: 'New chat', onclick: newChatModal }, ic('userplus')),
        el('button', { class: 'icon-btn', title: 'New group', onclick: newGroupModal }, ic('users')))),
      el('div', { class: 'searchbox side-search' }, ic('search', 16), search),
      el('div', { class: 'clist', id: 'clist' })),
    el('main', { class: 'main', id: 'main' }));
  builtMain = '';
}
async function startApp() {
  buildShell();
  connectWS();
  await Promise.all([
    loadConvs().catch((e) => toast(e.message, 'error')),
    api('GET', '/api/notifications', null, { quiet: true }).then((d) => { S.notifs = d.notifications; S.notifUnread = d.unread; }).catch(() => {}),
  ]);
  const want = new URLSearchParams(location.search).get('c') || lsGet('chatroom.last');
  if (want && convOf(want) && !isMobile()) { S.active = want; }
  renderAll();
  if (S.active) openConv(S.active);
  try { const p = JSON.parse(lsGet('chatroom.prefs') || '{}'); Object.assign(S.prefs, p); } catch {}
}
function renderAll() { if (!S.me) return; renderRail(); renderSide(); renderMain(); renderHeader(); }

function renderRail() {
  const r = $('#rail'); if (!r) return;
  const unread = updateBadge();
  const btn = (view, icon, label, badge) => el('button', { class: 'rbtn' + (S.view === view ? ' on' : ''), title: label, onclick: () => { S.view = view; renderAll(); } }, ic(icon, 22), el('span', { class: 'rlabel' }, label), badge ? el('span', { class: 'badge' }, badge > 99 ? '99+' : badge) : null);
  r.replaceChildren(
    el('div', { class: 'rlogo' }, ic('lock', 20)),
    btn('chats', 'chat', 'Chats', unread),
    btn('games', 'gamepad', 'Games', 0),
    btn('alerts', 'bell', 'Alerts', S.notifUnread),
    el('button', { class: 'rbtn', title: 'Settings', onclick: settingsModal }, ic('sliders', 22), el('span', { class: 'rlabel' }, 'Settings')),
    el('div', { class: 'grow' }),
    el('div', { class: 'conn ' + (S.wsOk ? 'ok' : 'bad'), title: S.wsOk ? 'connected' : 'reconnecting' }),
    el('button', { class: 'rme', title: 'My profile', onclick: () => openProfile(S.me.username) }, avatar(S.me.displayName, 34)));
}
function renderSide() {
  const list = $('#clist'); if (!list) return;
  const f = ($('#cfilter') || { value: '' }).value.trim().toLowerCase();
  const items = S.convs.filter((c) => !f || convTitle(c).toLowerCase().includes(f));
  if (!items.length) { list.replaceChildren(el('div', { class: 'empty-s' }, S.convs.length ? 'No chats match' : 'No chats yet. Start one with the buttons above.')); return; }
  list.replaceChildren(...items.map((c) => {
    const o = c.type === 'dm' ? other(c) : null;
    const av = c.type === 'dm' ? el('div', { class: 'avwrap' }, avatar(convTitle(c), 44), dot(isOnline(c, o.id))) : el('div', { class: 'avwrap' }, el('div', { class: 'avatar', style: `width:44px;height:44px;background:hsl(${hue(c.name)} 45% 38%)` }, ic('users', 20)));
    const act = o && activityOf(o.id);
    const typing = S.typing.get(c.id) && S.typing.get(c.id).size;
    return el('div', { class: 'citem' + (S.active === c.id ? ' active' : ''), onclick: () => openConv(c.id) }, av,
      el('div', { class: 'cmeta' },
        el('div', { class: 'crow' }, el('span', { class: 'ctitle' }, convTitle(c)), el('span', { class: 'ctime' }, c.lastMessage ? fmtTime(c.lastMessage.createdAt) : '')),
        el('div', { class: 'crow' },
          el('span', { class: 'cprev' + (typing ? ' accent' : '') }, typing ? 'typing...' : act ? 'Playing ' + act.title : c._preview || (c.type === 'group' ? c.members.length + ' members' : 'Say hi')),
          c.muted ? ic('mute', 14) : null,
          c.unread && !c.muted ? el('span', { class: 'badge' }, c.unread > 99 ? '99+' : c.unread) : c.unread ? el('span', { class: 'badge quiet' }, c.unread) : null)));
  }));
}
function renderMain() {
  const a = app();
  a.dataset.view = S.view;
  a.classList.toggle('open', S.view === 'chats' && !!S.active);
  const want = S.view === 'chats' ? (S.active && convOf(S.active) ? 'chat:' + S.active : 'empty') : S.view;
  if (want === builtMain) return;
  builtMain = want;
  clearInterval(actTimer); clearInterval(nowTimer);
  const m = $('#main'); m.replaceChildren(); chatRef = {};
  if (want === 'empty') m.append(emptyState());
  else if (want === 'games') buildGames(m);
  else if (want === 'alerts') buildAlerts(m);
  else buildChat(m, convOf(S.active));
}
function emptyState() {
  return el('div', { class: 'empty' }, ic('lock', 44), el('h2', null, 'Chatroom'),
    el('p', { class: 'muted' }, 'Messages are encrypted on your device before they leave it. The server only sees scrambled bytes.'),
    el('div', { class: 'row gap center' }, el('button', { class: 'btn primary', onclick: newChatModal }, ic('userplus', 16), 'New chat'), el('button', { class: 'btn', onclick: newGroupModal }, ic('users', 16), 'New group')));
}

// ---------- chat view ----------
async function openConv(id) {
  const c = convOf(id); if (!c) return;
  S.view = 'chats'; S.active = id; lsSet('chatroom.last', id);
  renderAll();
  if (!c.loaded) { try { await loadMessages(c); } catch (e) { toast(e.message, 'error'); } }
  if (S.active === id) { renderMessages(c, true); markRead(c); if (chatRef.input && !isMobile()) chatRef.input.focus(); }
}
function buildChat(m, c) {
  const head = el('div', { class: 'chat-head' });
  const msgs = el('div', { class: 'msgs' });
  const typing = el('div', { class: 'typing' });
  const cool = el('div', { class: 'cool' });
  let lastTyping = 0;
  const input = el('textarea', {
    rows: 1, maxLength: 2000, placeholder: 'Message (end-to-end encrypted)',
    oninput: () => {
      input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px';
      c.draft = input.value;
      if (input.value && Date.now() - lastTyping > 2500) { lastTyping = Date.now(); sendWS({ t: 'typing', convId: c.id }); }
    },
    onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); doSend(); } },
  });
  input.value = c.draft || '';
  const sendBtn = el('button', { class: 'btn primary send', title: 'Send', onclick: doSend }, ic('send', 18));
  let sending = false;
  async function doSend() {
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true; sendBtn.disabled = true;
    const ok = await sendPayload(c, { t: 'text', text });
    if (ok) { input.value = ''; c.draft = ''; input.style.height = 'auto'; }
    sending = false; tickCooldown(); input.focus();
  }
  m.append(el('div', { class: 'chat' }, head, msgs, typing,
    el('div', { class: 'composer-wrap' }, cool,
      el('div', { class: 'composer' },
        el('button', { class: 'icon-btn', title: 'Share a game', onclick: () => pickGameModal(c) }, ic('gamepad', 20)), input, sendBtn))));
  chatRef = { head, msgs, typing, input, sendBtn, cool, convId: c.id };
  msgs.addEventListener('scroll', () => { /* lazy load handled by the button */ });
  renderHeader(); renderTyping(); tickCooldown();
}
function renderHeader() {
  const h = chatRef.head; if (!h) return;
  const c = convOf(chatRef.convId); if (!c) return;
  const o = c.type === 'dm' ? other(c) : null;
  let sub;
  const t = S.typing.get(c.id);
  if (t && t.size) sub = el('span', { class: 'accent' }, c.type === 'dm' ? 'typing...' : [...t.keys()].map((id) => (memberOf(c, id) || {}).displayName || 'someone').join(', ') + ' typing...');
  else if (o) { const act = activityOf(o.id); sub = el('span', { class: isOnline(c, o.id) ? 'good' : 'muted' }, isOnline(c, o.id) ? (act ? 'Playing ' + act.title : 'online') : 'offline'); }
  else sub = el('span', { class: 'muted' }, `${c.members.length} members, ${c.members.filter((x) => isOnline(c, x.id)).length} online`);
  h.replaceChildren(
    el('button', { class: 'icon-btn back', title: 'Back', onclick: () => { S.active = null; renderAll(); } }, ic('back', 22)),
    o ? el('div', { class: 'avwrap' }, avatar(convTitle(c), 40), dot(isOnline(c, o.id))) : el('div', { class: 'avatar', style: `width:40px;height:40px;background:hsl(${hue(c.name)} 45% 38%)` }, ic('users', 18)),
    el('div', { class: 'grow click', onclick: () => (o ? openProfile(o.username) : groupModal(c)) }, el('div', { class: 'ctitle' }, convTitle(c)), el('div', { class: 'small' }, sub)),
    el('span', { class: 'enc', title: 'End-to-end encrypted' }, ic('lock', 14), 'Encrypted'),
    el('button', { class: 'icon-btn', title: c.muted ? 'Unmute' : 'Mute', onclick: async () => { c.muted = !c.muted; await api('PATCH', `/api/conversations/${c.id}/me`, { muted: c.muted }).catch(() => {}); renderHeader(); renderSide(); updateBadge(); } }, ic(c.muted ? 'mute' : 'volume', 20)),
    el('button', { class: 'icon-btn', title: 'Details', onclick: () => (o ? openProfile(o.username) : groupModal(c)) }, ic('info', 20)));
}
function renderTyping() {
  renderHeader(); renderSide();
  const b = chatRef.typing; if (!b) return;
  const c = convOf(chatRef.convId); const t = c && S.typing.get(c.id);
  b.textContent = t && t.size ? [...t.keys()].map((id) => (memberOf(c, id) || {}).displayName || 'Someone').join(', ') + ' is typing...' : '';
}
function tickCooldown() {
  const cool = chatRef.cool; if (!cool) return;
  clearInterval(tickCooldown.t);
  const upd = () => {
    const left = Math.ceil((S.cooldownUntil - Date.now()) / 1000);
    if (left > 0) { cool.textContent = `Slow down - you can send again in ${left}s`; cool.classList.add('on'); chatRef.sendBtn.disabled = true; }
    else { cool.textContent = ''; cool.classList.remove('on'); chatRef.sendBtn.disabled = false; clearInterval(tickCooldown.t); }
  };
  upd(); if (S.cooldownUntil > Date.now()) tickCooldown.t = setInterval(upd, 250);
}
function gameCard(p) {
  return el('div', { class: 'gshare' }, el('div', { class: 'gshare-ic', style: `background:hsl(${hue(p.title)} 55% 42%)` }, ic('gamepad', 22)),
    el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, p.title), el('div', { class: 'muted small' }, 'Game from GamesPlace')),
    el('button', { class: 'btn small primary', onclick: () => openGame(p.path, p.title) }, ic('play', 14), 'Play'));
}
function renderMessages(c, stick) {
  const box = chatRef.msgs; if (!box || chatRef.convId !== c.id) return;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  const frag = document.createDocumentFragment();
  if (c.hasMore) frag.append(el('button', { class: 'btn small more', onclick: async () => { const h = box.scrollHeight; await loadMessages(c, true); renderMessages(c); box.scrollTop = box.scrollHeight - h; } }, 'Load earlier messages'));
  if (c.loaded && !c.msgs.length) frag.append(el('div', { class: 'empty-s' }, ic('lock', 28), el('div', null, 'No messages yet. Everything you send here is end-to-end encrypted.')));
  let day = '', prev = null, prevT = 0;
  const lastMineId = [...c.msgs].reverse().find((x) => x.senderId === S.me.id && !x.deleted);
  const o = c.type === 'dm' ? other(c) : null;
  for (const m of c.msgs) {
    const d = fmtDay(m.createdAt);
    if (d !== day) { day = d; prev = null; frag.append(el('div', { class: 'daysep' }, el('span', null, d))); }
    const t = new Date(m.createdAt).getTime();
    const first = prev !== m.senderId || t - prevT > 300000;
    prev = m.senderId; prevT = t;
    const mine = m.senderId === S.me.id;
    const sender = memberOf(c, m.senderId);
    const p = m._p || { t: 'error' };
    const body = p.t === 'text' ? el('div', { class: 'mtext' }, linkify(p.text)) : p.t === 'game' ? gameCard(p) : el('div', { class: 'mtext muted-i' }, p.t === 'deleted' ? 'message deleted' : 'could not decrypt this message');
    const seen = lastMineId && lastMineId.id === m.id && o && o.lastReadAt && new Date(o.lastReadAt) >= new Date(m.createdAt);
    frag.append(el('div', { class: 'mrow' + (mine ? ' mine' : '') + (first ? ' first' : '') },
      !mine && c.type === 'group' ? (first ? el('div', { class: 'click', onclick: () => sender && openProfile(sender.username) }, avatar(sender ? sender.displayName : '?', 30)) : el('div', { style: 'width:30px' })) : null,
      el('div', { class: 'bubble' },
        first && !mine && c.type === 'group' ? el('div', { class: 'mname click', onclick: () => sender && openProfile(sender.username) }, sender ? sender.displayName : 'Former member') : null,
        body,
        el('div', { class: 'mmeta' }, fmtTime(m.createdAt), seen ? el('span', { class: 'seen' }, ic('check', 12), 'Seen') : null,
          mine && !m.deleted ? el('button', { class: 'icon-btn tiny', title: 'Delete message', onclick: async () => { if (await confirmModal('Delete message', 'This removes it for everyone.', 'Delete')) api('DELETE', '/api/messages/' + m.id).catch((e) => toast(e.message, 'error')); } }, ic('trash', 13)) : null))));
  }
  box.replaceChildren(frag);
  if (stick || near) box.scrollTop = box.scrollHeight;
}
function notifyMessage(c, msg, payload) {
  const sender = memberOf(c, msg.senderId);
  const who = sender ? sender.displayName : 'Someone';
  const text = C.previewText(payload, false);
  const title = c.type === 'group' ? `${who} in ${c.name}` : who;
  beep();
  if (document.hidden && S.prefs.desktop && 'Notification' in window && Notification.permission === 'granted') {
    try { const n = new Notification(title, { body: text, tag: c.id, silent: true }); n.onclick = () => { window.focus(); openConv(c.id); n.close(); }; } catch {}
  } else if (!document.hidden) toast(`${title}: ${text.slice(0, 80)}`, 'info', () => openConv(c.id));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.view === 'chats' && S.active) { const c = convOf(S.active); if (c && c.unread) markRead(c); } });

// ---------- modals ----------
async function startDM(username, m) {
  try {
    const d = await api('POST', '/api/conversations/dm', { username });
    Object.assign(S.keyUsers, d.keyUsers);
    const list = mergeConvs(d.conversations, false);
    await Promise.all(list.map(C.refreshPreview));
    if (m) m.close();
    openConv(d.convId);
  } catch (e) { toast(e.message, 'error'); }
}
function newChatModal() {
  const m = modal('New chat', null);
  const s = userSearch((u) => startDM(u.username, m));
  m.box.querySelector('.modal-body').replaceChildren(s.node);
  s.input.focus();
}
function newGroupModal() {
  const picked = new Map();
  const chips = el('div', { class: 'chips' });
  const name = el('input', { placeholder: 'Group name', maxLength: 40 });
  const err = el('div', { class: 'form-err' });
  const create = el('button', { class: 'btn primary wide', onclick: async () => {
    if (!name.value.trim()) { err.textContent = 'give the group a name'; return; }
    if (!picked.size) { err.textContent = 'pick at least one person'; return; }
    create.disabled = true; create.textContent = 'Creating...'; err.textContent = '';
    try {
      const profiles = [];
      for (const u of picked.values()) profiles.push(await api('GET', '/api/users/' + encodeURIComponent(u.username)));
      const raw = rand(32);                                  // fresh group key, wrapped separately for each member
      const members = [];
      for (const p of profiles) members.push({ userId: p.id, ...(await wrapGroupKey(raw, p.publicKey, p.id)) });
      const self = await wrapGroupKey(raw, S.me.publicKey, S.me.id);
      const d = await api('POST', '/api/conversations/group', { name: name.value.trim(), members, self });
      Object.assign(S.keyUsers, d.keyUsers);
      mergeConvs(d.conversations, false);
      m.close(); openConv(d.convId);
    } catch (e) { err.textContent = e.message; create.disabled = false; create.textContent = 'Create group'; }
  } }, 'Create group');
  const draw = () => chips.replaceChildren(...[...picked.values()].map((u) => el('span', { class: 'chip' }, u.displayName, el('button', { onclick: () => { picked.delete(u.id); draw(); } }, ic('x', 12)))));
  const s = userSearch((u) => { if (picked.size < 49) picked.set(u.id, u); draw(); s.reset(); }, new Set([S.me.id]));
  const m = modal('New group', el('div', null, el('label', null, 'Name', name), chips, s.node, err, create));
  name.focus();
}
async function groupModal(c) {
  const body = el('div');
  const m = modal(c.name, body, { wide: true });
  const isAdmin = () => c.role === 'admin';
  const draw = () => {
    const nameIn = el('input', { value: c.name, maxLength: 40, disabled: !isAdmin() });
    const addBox = el('div');
    if (isAdmin()) {
      const s = userSearch(async (u) => {
        try {
          const p = await api('GET', '/api/users/' + encodeURIComponent(u.username));
          const { raw } = await keyFor(c, c.keyVersion);
          const w = await wrapGroupKey(raw, p.publicKey, p.id);
          await api('POST', `/api/conversations/${c.id}/members`, { userId: p.id, ...w });
          await loadConvs(); toast(`${p.displayName} added`, 'success'); draw();
        } catch (e) { toast(e.message, 'error'); }
      }, new Set(c.members.map((x) => x.id)));
      addBox.append(el('h4', null, 'Add someone'), s.node);
    }
    body.replaceChildren(
      el('h4', null, 'Group name'),
      el('div', { class: 'row gap' }, nameIn, isAdmin() ? el('button', { class: 'btn', onclick: async () => { try { await api('PATCH', `/api/conversations/${c.id}`, { name: nameIn.value }); c.name = nameIn.value.trim(); renderAll(); toast('renamed', 'success'); } catch (e) { toast(e.message, 'error'); } } }, 'Save') : null),
      el('h4', null, `${c.members.length} members`),
      el('div', { class: 'ulist' }, c.members.map((u) => el('div', { class: 'urow' },
        el('div', { class: 'avwrap click', onclick: () => openProfile(u.username) }, avatar(u.displayName, 34), dot(isOnline(c, u.id))),
        el('div', { class: 'grow click', onclick: () => openProfile(u.username) }, el('div', { class: 'ctitle' }, u.displayName + (u.id === S.me.id ? ' (you)' : '')), el('div', { class: 'muted small' }, '@' + u.username)),
        u.role === 'admin' ? el('span', { class: 'tag' }, 'admin') : null,
        isAdmin() && u.id !== S.me.id ? el('button', { class: 'icon-btn', title: 'Remove', onclick: async () => { if (await confirmModal('Remove member', `Remove ${u.displayName}? The group key is rotated so they can't read new messages.`, 'Remove')) { await removeMember(c, u.id); draw(); } } }, ic('x', 16)) : null))),
      addBox,
      el('div', { class: 'row end' }, el('button', { class: 'btn danger', onclick: async () => { if (await confirmModal('Leave group', `Leave ${c.name}?`, 'Leave')) { await removeMember(c, S.me.id); m.close(); } } }, ic('logout', 16), 'Leave group')));
  };
  draw();
}
async function removeMember(c, userId) {
  try {
    const remaining = c.members.filter((x) => x.id !== userId);
    const raw = rand(32);                                    // rotate: new key only for people who stay
    const keys = [];
    for (const r of remaining) keys.push({ userId: r.id, ...(await wrapGroupKey(raw, r.publicKey, r.id)) });
    await api('DELETE', `/api/conversations/${c.id}/members/${userId}`, { keys });
    if (userId === S.me.id) { S.convs = S.convs.filter((x) => x.id !== c.id); if (S.active === c.id) S.active = null; renderAll(); }
    else await loadConvs();
  } catch (e) { toast(e.message, 'error'); }
}
async function openProfile(username) {
  const body = el('div', null, el('div', { class: 'muted pad' }, 'Loading...'));
  const m = modal('Profile', body);
  try {
    const p = await api('GET', '/api/users/' + encodeURIComponent(username));
    const me = p.id === S.me.id;
    const sn = me ? null : await safetyNumber(S.me.publicKey, p.publicKey);
    const fp = me ? (await safetyNumber(S.me.publicKey, S.me.publicKey)) : null;
    body.replaceChildren(
      el('div', { class: 'prof-head' }, avatar(p.displayName, 64), el('div', null, el('h3', null, p.displayName), el('div', { class: 'muted' }, '@' + p.username), el('div', { class: p.online ? 'good small' : 'muted small' }, p.activity ? 'Playing ' + p.activity.title : p.online ? 'online' : 'offline'))),
      p.stats ? el('div', { class: 'stats' }, el('div', null, el('b', null, fmtDur(p.stats.totalSeconds)), el('span', null, 'played')), el('div', null, el('b', null, p.stats.gamesPlayed), el('span', null, 'games'))) : el('p', { class: 'muted small' }, 'This person keeps their activity private.'),
      p.stats && p.stats.top.length ? el('div', null, el('h4', null, 'Most played'), p.stats.top.map((g) => el('div', { class: 'urow' }, el('div', { class: 'grow' }, g.title), el('span', { class: 'muted small' }, fmtDur(g.seconds))))) : null,
      el('h4', null, ic('shield', 14), me ? ' Your encryption fingerprint' : ' Safety number'),
      el('div', { class: 'sn' }, me ? fp : sn),
      el('p', { class: 'muted small' }, me ? 'Your public key is shared with people you chat with. Your private key never leaves this browser unencrypted.' : 'Compare this number with theirs (in person or on a call). If it matches, nobody is intercepting your chat.'),
      me ? null : el('div', { class: 'row gap' },
        el('button', { class: 'btn primary', onclick: () => startDM(p.username, m) }, ic('chat', 16), 'Message'),
        el('button', { class: 'btn ' + (p.blocked ? '' : 'danger'), onclick: async () => { try { await api(p.blocked ? 'DELETE' : 'POST', '/api/blocks/' + encodeURIComponent(p.username)); toast(p.blocked ? 'unblocked' : 'blocked', 'success'); m.close(); } catch (e) { toast(e.message, 'error'); } } }, ic('ban', 16), p.blocked ? 'Unblock' : 'Block')));
  } catch (e) { body.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
}
function settingsModal() {
  const dn = el('input', { value: S.me.displayName, maxLength: 32 });
  const savePrefs = () => lsSet('chatroom.prefs', JSON.stringify(S.prefs));
  const toggle = (label, sub, on, fn) => { const b = el('button', { class: 'switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on, onclick: async () => { const v = !b.classList.contains('on'); const ok = await fn(v); if (ok !== false) { b.classList.toggle('on', v); b.setAttribute('aria-checked', v); } } }, el('i')); return el('div', { class: 'setrow' }, el('div', { class: 'grow' }, el('div', null, label), el('div', { class: 'muted small' }, sub)), b); };
  const pushOK = SAME_ORIGIN && 'serviceWorker' in navigator && 'PushManager' in window;
  const m = modal('Settings', el('div', null,
    el('h4', null, 'Display name'),
    el('div', { class: 'row gap' }, dn, el('button', { class: 'btn', onclick: async () => { try { const d = await api('PATCH', '/api/me', { displayName: dn.value }); S.me.displayName = d.user.displayName; renderAll(); toast('saved', 'success'); } catch (e) { toast(e.message, 'error'); } } }, 'Save')),
    el('h4', null, 'Privacy'),
    toggle('Share my game activity', 'Show what I am playing and my play time to other people', S.me.shareActivity, async (v) => { try { const d = await api('PATCH', '/api/me', { shareActivity: v }); S.me.shareActivity = d.user.shareActivity; } catch (e) { toast(e.message, 'error'); return false; } }),
    el('h4', null, 'Notifications'),
    toggle('Sound', 'Play a sound for new messages', S.prefs.sound, (v) => { S.prefs.sound = v; savePrefs(); if (v) beep(); }),
    toggle('Desktop notifications', 'Show a popup when this tab is in the background', S.prefs.desktop && 'Notification' in window && Notification.permission === 'granted', async (v) => {
      if (!v) { S.prefs.desktop = false; savePrefs(); return; }
      if (!('Notification' in window)) { toast('this browser has no notifications', 'error'); return false; }
      const p = await Notification.requestPermission();
      if (p !== 'granted') { toast('notifications are blocked in your browser settings', 'error'); return false; }
      S.prefs.desktop = true; savePrefs();
    }),
    pushOK ? toggle('Background push', 'Get a generic alert even when the tab is closed (message text stays encrypted)', false, async (v) => (v ? enablePush() : disablePush()))
      : el('p', { class: 'muted small' }, 'Background push works when you open Chatroom directly from its own address. In-tab alerts, sounds and desktop popups work everywhere.'),
    el('h4', null, 'Account'),
    el('button', { class: 'btn danger', onclick: async () => { if (await confirmModal('Sign out', 'You will need your password to unlock your keys again.', 'Sign out')) { m.close(); logout(false); } } }, ic('logout', 16), 'Sign out')));
}
const urlB64ToU8 = (s) => unb64(s);
async function enablePush() {
  try {
    if ((await Notification.requestPermission()) !== 'granted') { toast('notifications are blocked', 'error'); return false; }
    const reg = await navigator.serviceWorker.register('/sw.js');
    const { key } = await api('GET', '/api/push/key');
    if (!key) { toast('push is not available on this server', 'error'); return false; }
    const sub = await (await navigator.serviceWorker.ready).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(key) });
    await api('POST', '/api/push/subscribe', sub.toJSON());
    toast('push enabled', 'success');
  } catch (e) { toast('push failed: ' + e.message, 'error'); return false; }
}
async function disablePush() {
  try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && (await reg.pushManager.getSubscription()); if (sub) await sub.unsubscribe(); await api('DELETE', '/api/push/subscribe'); } catch {}
}
function pickGameModal(c) {
  const list = el('div', { class: 'ulist tall' });
  const input = el('input', { placeholder: 'Search games to share' });
  const m = modal('Share a game', el('div', null, el('div', { class: 'searchbox' }, ic('search', 16), input), list));
  const run = debounce(async () => {
    try {
      const d = await api('GET', '/api/games?limit=30&q=' + encodeURIComponent(input.value), null, { quiet: true });
      list.replaceChildren(...(d.items.length ? d.items.map((g) => el('div', { class: 'urow click', onclick: async () => { m.close(); await sendPayload(c, { t: 'game', path: g.id, title: g.title }); } }, el('div', { class: 'gshare-ic sm', style: `background:hsl(${hue(g.title)} 55% 42%)` }, ic('gamepad', 16)), el('div', { class: 'grow' }, g.title), ic('send', 16))) : [el('div', { class: 'muted pad' }, d.indexed ? 'No games found' : 'The game list is still loading, try again in a moment')]));
    } catch (e) { list.replaceChildren(el('div', { class: 'muted pad' }, e.message)); }
  }, 250);
  input.addEventListener('input', run); run(); input.focus();
}

// ---------- alerts ----------
function buildAlerts(m) {
  const list = S.notifs.length ? S.notifs.map((n) => {
    const txt = n.type === 'group_added' ? `${n.data.by} added you to ${n.data.name}` : n.type === 'dm_new' ? `${n.data.from} started a chat with you` : 'Notification';
    return el('div', { class: 'urow click' + (n.read ? '' : ' unread'), onclick: () => n.data.convId && convOf(n.data.convId) && openConv(n.data.convId) }, el('div', { class: 'gshare-ic sm', style: 'background:hsl(220 50% 45%)' }, ic(n.type === 'group_added' ? 'users' : 'chat', 16)), el('div', { class: 'grow' }, el('div', null, txt), el('div', { class: 'muted small' }, ago(n.createdAt))));
  }) : [el('div', { class: 'empty-s' }, ic('bell', 28), el('div', null, 'Nothing here yet'))];
  m.append(el('div', { class: 'page' }, el('div', { class: 'page-head' }, el('h2', null, 'Alerts'), el('button', { class: 'btn small', onclick: async () => { await api('POST', '/api/notifications/read').catch(() => {}); S.notifs.forEach((n) => (n.read = true)); S.notifUnread = 0; renderAll(); builtMain = ''; renderMain(); } }, 'Mark all read')), el('div', { class: 'ulist' }, list)));
  if (S.notifUnread) { api('POST', '/api/notifications/read', null, { quiet: true }).catch(() => {}); S.notifUnread = 0; S.notifs.forEach((n) => (n.read = true)); setTimeout(renderRail, 50); }
}

// ---------- gamesplace ----------
const G = { q: '', cat: '', items: [], total: 0, cats: [], indexed: 0, loading: false, tab: 'library', range: 'week' };
let actTimer, nowTimer, gridRef = {};
async function loadGames(reset) {
  if (G.loading) return;
  G.loading = true;
  try {
    const off = reset ? 0 : G.items.length;
    const d = await api('GET', `/api/games?q=${encodeURIComponent(G.q)}&cat=${encodeURIComponent(G.cat)}&limit=60&offset=${off}`, null, { quiet: true });
    G.items = reset ? d.items : G.items.concat(d.items); G.total = d.total; G.cats = d.cats; G.indexed = d.indexed;
  } catch (e) { toast(e.status === 429 ? `slow down, retry in ${e.data.retryAfter}s` : e.message, 'error'); }
  G.loading = false; renderGameGrid();
}
async function loadNow() { try { const d = await api('GET', '/api/activity/now', null, { quiet: true }); S.nowPlaying = d.now; renderGameGrid(); } catch {} }
function buildGames(m) {
  const content = el('div', { class: 'gcontent' });
  const tabs = el('div', { class: 'seg' },
    el('button', { class: G.tab === 'library' ? 'on' : '', onclick: () => { G.tab = 'library'; builtMain = ''; renderMain(); } }, ic('gamepad', 16), 'Library'),
    el('button', { class: G.tab === 'activity' ? 'on' : '', onclick: () => { G.tab = 'activity'; builtMain = ''; renderMain(); } }, ic('activity', 16), 'Activity'));
  m.append(el('div', { class: 'page' }, el('div', { class: 'page-head' }, el('h2', null, 'GamesPlace'), tabs), content));
  if (G.tab === 'library') {
    const input = el('input', { placeholder: 'Search games', value: G.q, oninput: debounce(() => { G.q = input.value; loadGames(true); }, 300) });
    const chips = el('div', { class: 'cats' }), grid = el('div', { class: 'ggrid' }), more = el('div', { class: 'row center' });
    gridRef = { chips, grid, more };
    content.append(el('div', { class: 'searchbox' }, ic('search', 16), input), chips, grid, more);
    if (!G.items.length) loadGames(true); else renderGameGrid();
    loadNow(); nowTimer = setInterval(loadNow, 20000);
  } else {
    gridRef = {};
    loadActivity(content); actTimer = setInterval(() => loadActivity(content), 15000);
  }
}
function renderGameGrid() {
  const { chips, grid, more } = gridRef; if (!grid || !grid.isConnected) return;
  chips.replaceChildren(el('button', { class: 'chip-b' + (!G.cat ? ' on' : ''), onclick: () => { G.cat = ''; loadGames(true); renderGameGrid(); } }, 'All'), ...G.cats.map((c) => el('button', { class: 'chip-b' + (G.cat === c.cat ? ' on' : ''), onclick: () => { G.cat = c.cat; loadGames(true); renderGameGrid(); } }, c.cat.length === 1 ? c.cat.toUpperCase() : c.cat)));
  const counts = {}; for (const n of S.nowPlaying) counts[n.path] = (counts[n.path] || 0) + 1;
  if (!G.items.length) { grid.replaceChildren(el('div', { class: 'empty-s wide' }, G.loading ? 'Loading games...' : G.indexed ? 'No games match that search' : 'The game list is still loading from the stash, give it a few seconds and press retry.', !G.loading && !G.indexed ? el('button', { class: 'btn small', onclick: () => loadGames(true) }, 'Retry') : null)); more.replaceChildren(); return; }
  grid.replaceChildren(...G.items.map((g) => el('div', { class: 'gcard', onclick: () => openGame(g.id, g.title) },
    el('div', { class: 'gtile', style: `background:linear-gradient(135deg,hsl(${hue(g.title)} 60% 38%),hsl(${(hue(g.title) + 50) % 360} 60% 24%))` }, el('span', null, g.title.slice(0, 2)), counts[g.id] ? el('span', { class: 'live-tag' }, counts[g.id] + ' playing') : null),
    el('div', { class: 'ginfo' }, el('div', { class: 'gname', title: g.title }, g.title), el('div', { class: 'muted small' }, g.cat.length === 1 ? g.cat.toUpperCase() : g.cat)))));
  more.replaceChildren(...(G.items.length < G.total ? [el('button', { class: 'btn', onclick: () => loadGames(false) }, `Show more (${G.total - G.items.length} left)`)] : []));
}
async function loadActivity(box) {
  if (!box.isConnected) return;
  try {
    const [now, recent, board] = await Promise.all([
      api('GET', '/api/activity/now', null, { quiet: true }), api('GET', '/api/activity/recent', null, { quiet: true }), api('GET', '/api/activity/leaderboard?range=' + G.range, null, { quiet: true })]);
    S.nowPlaying = now.now;
    const who = (u, sub, right) => el('div', { class: 'urow click', onclick: () => openProfile(u.username) }, avatar(u.displayName, 34), el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, u.displayName), el('div', { class: 'muted small' }, sub)), right);
    box.replaceChildren(el('div', { class: 'act-grid' },
      el('section', { class: 'card' }, el('h3', null, ic('activity', 16), 'Playing now'), now.now.length ? now.now.map((n) => who(n, n.title, el('span', { class: 'good small' }, fmtDur((Date.now() - new Date(n.since)) / 1000)))) : el('div', { class: 'muted pad' }, 'Nobody is playing right now')),
      el('section', { class: 'card' }, el('h3', null, ic('clock', 16), 'Recent'), recent.recent.length ? recent.recent.slice(0, 12).map((r) => who(r, `${r.title}`, el('span', { class: 'muted small' }, r.live ? 'live' : fmtDur(r.seconds)))) : el('div', { class: 'muted pad' }, 'No activity yet. Play something!')),
      el('section', { class: 'card' }, el('div', { class: 'row between' }, el('h3', null, ic('trophy', 16), 'Top players'), el('div', { class: 'seg small' }, el('button', { class: G.range === 'week' ? 'on' : '', onclick: () => { G.range = 'week'; loadActivity(box); } }, 'Week'), el('button', { class: G.range === 'all' ? 'on' : '', onclick: () => { G.range = 'all'; loadActivity(box); } }, 'All time'))),
        board.players.length ? board.players.map((p, i) => who(p, `${p.games} games`, el('b', null, fmtDur(p.seconds)))) : el('div', { class: 'muted pad' }, 'No data yet')),
      el('section', { class: 'card' }, el('h3', null, ic('gamepad', 16), 'Most played games'),
        board.games.length ? board.games.map((g) => el('div', { class: 'urow click', onclick: () => openGame(g.path, g.title) }, el('div', { class: 'gshare-ic sm', style: `background:hsl(${hue(g.title)} 55% 42%)` }, ic('gamepad', 16)), el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, g.title), el('div', { class: 'muted small' }, `${g.players} player${g.players === 1 ? '' : 's'}`)), el('b', null, fmtDur(g.seconds)))) : el('div', { class: 'muted pad' }, 'No data yet'))));
  } catch (e) { box.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
}
function renderActivityLive() { if (S.view === 'games' && G.tab === 'activity') { clearTimeout(renderActivityLive.t); renderActivityLive.t = setTimeout(() => { const b = $('.gcontent'); if (b) loadActivity(b); }, 1200); } }

// ---------- game player ----------
let player = null;
function closePlayer() {
  if (!player) return;
  clearInterval(player.timer);
  player.node.remove();
  api('POST', '/api/activity/stop', null, { quiet: true, keepalive: true }).catch(() => {});
  player = null;
}
function openGame(path, title) {
  closePlayer();
  const url = API + '/g/' + path.split('/').map(encodeURIComponent).join('/');
  const frame = el('iframe', { class: 'gframe', src: url, allow: 'autoplay; fullscreen; gamepad; clipboard-write', referrerPolicy: 'no-referrer' });
  frame.setAttribute('sandbox', 'allow-scripts allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads allow-orientation-lock');
  const spin = el('div', { class: 'gload' }, el('div', { class: 'spinner' }), el('div', null, 'Loading ' + title + '...'));
  frame.addEventListener('load', () => spin.remove());
  const node = el('div', { class: 'player' },
    el('div', { class: 'player-bar' },
      el('button', { class: 'icon-btn', title: 'Close', onclick: closePlayer }, ic('back', 22)),
      el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, title), el('div', { class: 'muted small' }, S.me.shareActivity ? 'Your friends can see you are playing' : 'Your activity is private')),
      el('button', { class: 'icon-btn', title: 'Share to a chat', onclick: () => shareGameModal(path, title) }, ic('share', 20)),
      el('button', { class: 'icon-btn', title: 'Fullscreen', onclick: () => { (frame.requestFullscreen || frame.webkitRequestFullscreen || (() => {})).call(frame); } }, ic('expand', 20)),
      el('a', { class: 'icon-btn', title: 'Open in a new tab', href: url, target: '_blank', rel: 'noopener' }, ic('external', 20)),
      el('button', { class: 'icon-btn', title: 'Close', onclick: closePlayer }, ic('x', 22))),
    el('div', { class: 'player-body' }, frame, spin));
  document.body.append(node);
  player = { node, timer: null, playId: null };
  api('POST', '/api/activity/start', { path }, { quiet: true }).then((r) => {
    if (!player || player.node !== node) return api('POST', '/api/activity/stop', null, { quiet: true }).catch(() => {});
    player.playId = r.playId;
    player.timer = setInterval(() => api('POST', '/api/activity/ping', { playId: r.playId }, { quiet: true }).catch(() => {}), 25000);
  }).catch(() => {});
}
window.addEventListener('pagehide', () => { if (player && S.token) api('POST', '/api/activity/stop', null, { quiet: true, keepalive: true }).catch(() => {}); });
function shareGameModal(path, title) {
  const list = S.convs.map((c) => el('div', { class: 'urow click', onclick: async () => { m.close(); if (await sendPayload(c, { t: 'game', path, title })) toast('shared to ' + convTitle(c), 'success'); } }, avatar(convTitle(c), 34), el('div', { class: 'grow' }, convTitle(c)), ic('send', 16)));
  const m = modal('Share to chat', el('div', { class: 'ulist tall' }, list.length ? list : [el('div', { class: 'muted pad' }, 'No chats yet')]));
  m.box.style.zIndex = 400;
}

window.__ui = { renderAll, renderRail, renderSide, renderHeader, renderMessages, renderTyping, renderActivityLive, notifyMessage, openConv, tickCooldown };

// ---------- boot ----------
async function boot() {
  if (!window.crypto || !crypto.subtle) return fatal('This page needs a secure context (https) for encryption.');
  if (!/^https?:/i.test(API)) return fatal('Chatroom server address is not set. Open this through loader.html or the server address.');
  let sess = null; try { sess = JSON.parse(lsGet('chatroom.session') || 'null'); } catch {}
  if (!sess || !sess.token) return showAuth('login');
  S.token = sess.token;
  try { const p = JSON.parse(lsGet('chatroom.prefs') || '{}'); Object.assign(S.prefs, p); } catch {}
  try {
    const me = await api('GET', '/api/me', null, { quiet: true });
    const priv = await idbGet('priv:' + me.user.id);
    if (!priv) { S.token = null; lsDel('chatroom.session'); return showAuth('login', 'please sign in again to unlock your keys'); }
    S.me = { ...me.user, publicKey: me.publicKey }; S.priv = priv;
    await startApp();
  } catch (e) {
    if (e.network || (e.status && e.status >= 500)) return fatal('Cannot reach the Chatroom server right now.', boot);
    S.token = null; lsDel('chatroom.session'); showAuth('login', 'session expired, please sign in');
  }
}
boot();
})();

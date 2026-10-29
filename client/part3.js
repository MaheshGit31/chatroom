/* ===== Chatroom client: ui (auth, shell, chats, modals, gamesplace, activity) ===== */
(() => {
'use strict';
const C = window.__core;
const { API, SAME_ORIGIN, S, el, $, ic, avatar, fmtTime, fmtDay, fmtDur, ago, debounce, lsGet, lsSet, lsDel, toast, beep, updateBadge, api, kdf, newIdentity, openIdentity, wrapGroupKey, safetyNumber, idbGet, idbSet, idbDel, convOf, other, convTitle, memberOf, sortConvs, mergeConvs, loadConvs, loadMessages, sendPayload, markRead, connectWS, sendWS, rand, b64, unb64, skCache, convKeys, keyFor, hue, tone } = C;
const isMobile = () => matchMedia('(max-width: 760px)').matches;
const X = new Proxy({}, { get: (_, k) => (...a) => window.__ext[k](...a) });   // extras (discover, gifs, themes...) live in part3b and are looked up when called
const app = () => $('#app');
const vb = (u) => (u && u.verified ? el('span', { class: 'vbadge', title: 'verified' }, ic('verified', 16)) : null);   // blue tick next to a verified name

// ---------- generic widgets ----------
function modal(title, content, opts = {}) {
  const back = el('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } });
  const box = el('div', { class: 'modal' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-label': title },
    el('div', { class: 'modal-head' }, el('h3', null, title), el('button', { class: 'icon-btn', title: 'close', onclick: () => close() }, ic('x'))),
    el('div', { class: 'modal-body' }, content));
  back.append(box);
  document.body.append(back);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  let closed = false;
  function close() {                                         // fade out first, then remove
    if (closed) return; closed = true;
    document.removeEventListener('keydown', onKey);
    back.classList.add('out'); setTimeout(() => back.remove(), 200);
    opts.onClose && opts.onClose();
  }
  return { close, box };
}
function confirmModal(title, text, okLabel = 'confirm', danger = true) {
  return new Promise((ok) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; m.close(); ok(v); } };
    const m = modal(title, el('div', null, text ? el('p', { class: 'muted', style: 'margin-top:0' }, text) : null,
      el('div', { class: 'row end gap' }, el('button', { class: 'btn ghost', onclick: () => finish(false) }, 'cancel'), el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => finish(true) }, okLabel))), { onClose: () => { if (!done) { done = true; ok(false); } } });
  });
}
function userSearch(onPick, exclude = new Set()) {
  const list = el('div', { class: 'ulist' });
  const hint = () => el('div', { class: 'muted pad' }, 'type 2+ letters');
  const input = el('input', { placeholder: 'find by username', autocomplete: 'off', autocapitalize: 'none', spellcheck: false });
  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { list.replaceChildren(hint()); return; }
    try {
      const d = await api('GET', '/api/users/search?q=' + encodeURIComponent(q), null, { quiet: true });
      const users = d.users.filter((u) => !exclude.has(u.id));
      list.replaceChildren(...(users.length ? users.map((u) => el('div', { class: 'urow click', onclick: () => onPick(u) }, avatar(u.displayName, 36, '', u.avatar), el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, u.displayName, vb(u)), el('div', { class: 'muted small' }, '@' + u.username)), ic('plus', 16))) : [el('div', { class: 'muted pad' }, 'nobody found')]));
    } catch (e) { list.replaceChildren(el('div', { class: 'muted pad' }, e.status === 429 ? `slow down, retry in ${e.data.retryAfter}s` : e.message)); }
  }, 250);
  input.addEventListener('input', run);
  list.append(hint());
  const reset = () => { input.value = ''; list.replaceChildren(hint()); input.focus(); };
  return { node: el('div', null, el('div', { class: 'searchbox' }, ic('search', 16), input), list), input, reset };
}
const linkify = (text, c) => {                                 // links become anchors, @names become pills, emoji become images
  const out = [];
  String(text).split(/(https?:\/\/[^\s<>"]+)/g).forEach((part, i) => {
    if (i % 2) out.push(el('a', { href: part, target: '_blank', rel: 'noopener noreferrer nofollow' }, part));
    else if (part) part.split(/(@[a-z0-9_]{3,20})/gi).forEach((seg, j) => {
      const who = j % 2 ? seg.slice(1).toLowerCase() : '';
      if (who && c && c.members.some((m) => m.username === who)) out.push(el('span', { class: 'mention' + (who === S.me.username ? ' me' : ''), onclick: () => openProfile(who) }, seg));
      else if (seg) out.push(...C.emojify(C.F.clean(seg)));
    });
  });
  return out;
};
const isOnline = (c, uid) => { const p = S.presence.get(uid); if (p) return p.online; const m = c && memberOf(c, uid); return !!(m && m.online); };
const activityOf = (uid) => { const p = S.presence.get(uid); return p && p.activity; };
const dot = (on, mode) => el('span', { class: 'pdot ' + (on ? (mode === 'busy' ? 'busy' : 'on') : '') });
// status of anyone: mine comes from S.me, others from live presence, falling back to the member row
const statusFor = (uid, c) => {
  if (uid === S.me.id) return { status: S.me.status, mode: S.me.mode };
  const p = S.presence.get(uid); if (p) return { status: p.status, mode: p.mode };
  const m = c && memberOf(c, uid); return { status: m && m.status, mode: m && m.mode };
};
const statusLine = (st, fallback) => {
  const s = st && st.status;
  if (!s || (!s.text && !s.icon)) return fallback ? el('span', { class: 'stat-line' }, fallback) : null;
  return el('span', { class: 'stat-line' }, s.icon ? ic(s.icon, 14) : null, s.text ? el('span', { class: 't' }, s.text) : null);
};
const STATUS_ICONS = ['coffee', 'book', 'moon', 'music', 'code', 'gamepad', 'heart', 'sun', 'leaf', 'flame', 'headphones', 'pizza'];
const mugIcon = () => { const n = el('span', { class: 'mug' }); n.innerHTML = '<svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><g class="steam"><path d="M24 18c-3-3 3-5 0-9"/><path d="M32 18c-3-3 3-5 0-9"/><path d="M40 18c-3-3 3-5 0-9"/></g><path d="M16 26h28v14a12 12 0 0 1-12 12h-4a12 12 0 0 1-12-12z"/><path d="M44 30h4a6 6 0 0 1 0 12h-4"/></svg>'; return n; };
const wordmark = (size) => el('h1', { class: 'logo', style: size ? `font-size:${size}px` : null }, 'chat', el('i', null, 'room'));
const applyTheme = () => { const t = S.prefs.theme; if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; X.applyTheme && X.applyTheme(); };

// ---------- auth ----------
function fatal(msg, retry) {
  const a = app(); a.className = 'auth-wrap'; a.replaceChildren(el('div', { class: 'auth-card' }, mugIcon(), wordmark(), el('p', { class: 'form-err' }, msg), retry ? el('button', { class: 'btn primary wide', onclick: retry }, 'try again') : null));
}
function showAuth(mode = 'login', note = '') {
  const a = app(); a.className = 'auth-wrap'; a.replaceChildren();
  const err = el('div', { class: 'form-err', role: 'alert' }, note);
  const user = el('input', { placeholder: 'username', autocomplete: 'username', maxLength: 20, autocapitalize: 'none', spellcheck: false });
  const disp = el('input', { placeholder: 'display name (optional)', maxLength: 32, autocomplete: 'nickname' });
  const pw = el('input', { type: 'password', placeholder: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password' });
  const pw2 = el('input', { type: 'password', placeholder: 'again', autocomplete: 'new-password' });
  const refIn = el('input', { placeholder: 'invite code (optional)', maxLength: 12, autocapitalize: 'none', value: lsGet('chatroom.ref') || '' });
  const key = el('input', { type: 'password', placeholder: 'setup key', autocomplete: 'off' });
  const keyBox = el('label', { style: 'display:none' }, 'this name is reserved', key);
  const label = mode === 'login' ? 'sign in' : 'join';
  const btn = el('button', { class: 'btn primary wide', type: 'submit' }, label);
  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ''; btn.disabled = true; btn.textContent = 'one sec...';
      try {
        const username = user.value.trim().toLowerCase();
        if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new Error('username: 3-20 chars, a-z 0-9 and _');
        if (mode === 'register') {
          if (pw.value.length < 8) throw new Error('password needs 8+ characters');
          if (pw.value !== pw2.value) throw new Error('passwords do not match');
          const kdfSalt = b64(rand(16));
          const { authSecret, wrapKey } = await kdf(pw.value, kdfSalt);
          const id = await newIdentity(wrapKey);
          const r = await api('POST', '/api/auth/register', { username, displayName: disp.value.trim() || username, kdfSalt, authSecret, publicKey: id.pub, wrappedPriv: id.wrappedPriv, wrappedPrivIv: id.wrappedPrivIv, setupKey: key.value, ref: refIn.value.trim().toLowerCase() || undefined }, { quiet: true });
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
        if (ex.data && ex.data.error === 'setup_key_required') { keyBox.style.display = ''; key.focus(); }
        if (ex.data && ex.data.error === 'suspended') { err.textContent = 'this account is suspended'; X.appealModal(ex.data, user.value.trim().toLowerCase()); }
        else err.textContent = ex.status === 429 ? `too many tries, wait ${ex.data.retryAfter}s` : ex.message;
        btn.disabled = false; btn.textContent = label;
      }
    },
  },
  el('label', null, 'username', user), mode === 'register' ? el('label', null, 'display name', disp) : null,
  el('label', null, 'password', pw), mode === 'register' ? el('label', null, 'confirm', pw2) : null,
  mode === 'register' ? el('label', null, 'invite code', refIn) : null,
  mode === 'register' ? keyBox : null,
  err, btn,
  mode === 'register' ? el('p', { class: 'muted small', style: 'margin-bottom:0' }, 'no password resets. forget it and old messages are gone.') : null);
  a.append(el('div', { class: 'auth-card' },
    mugIcon(), wordmark(), el('p', { class: 'tagline' }, 'somewhere warm to talk'),
    el('div', { class: 'seg' }, el('button', { class: mode === 'login' ? 'on' : '', onclick: () => showAuth('login') }, 'sign in'), el('button', { class: mode === 'register' ? 'on' : '', onclick: () => showAuth('register') }, 'join')),
    form));
  user.focus();
}
async function finishAuth(token, user, publicKey, priv) {
  S.token = token; S.me = { ...user, publicKey }; S.ttlHours = S.ttlHours || 48; S.priv = priv;
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
  closePlayer(); clearInterval(actTimer); clearInterval(nowTimer); clearInterval(pruneTimer);
  Object.assign(S, { me: null, priv: null, convs: [], keyUsers: {}, active: null, view: 'chats', notifs: [], notifUnread: 0, wsOk: false });
  S.presence.clear(); S.typing.clear(); skCache.clear(); convKeys.clear(); builtMain = '';
  document.title = 'chatroom'; sideStagger = true;
  showAuth('login', forced ? 'you were signed out' : '');
}
window.__chatroomLogout = logout;

// ---------- shell ----------
let builtMain = '', chatRef = {}, rind = null, sideStagger = true, pruneTimer = 0;
function buildShell() {
  const a = app(); a.className = 'app'; a.replaceChildren();
  const search = el('input', { placeholder: 'filter', id: 'cfilter', oninput: () => renderSide() });
  a.append(
    el('div', { class: 'topbar', id: 'topbar' }),
    el('nav', { class: 'rail', id: 'rail' }),
    el('aside', { class: 'side', id: 'side' },
      el('div', { class: 'side-head' }, el('h2', null, 'chats'), el('div', { class: 'row gap-s' },
        el('button', { class: 'icon-btn', title: 'new chat', onclick: newChatModal }, ic('userplus')),
        el('button', { class: 'icon-btn', title: 'new group', onclick: newGroupModal }, ic('users')))),
      el('div', { class: 'searchbox side-search' }, ic('search', 16), search),
      el('div', { class: 'folders', id: 'folders' }),
      el('div', { class: 'clist', id: 'clist' })),
    el('main', { class: 'main', id: 'main' }));
  builtMain = ''; sideStagger = true;
}
async function startApp() {
  try { const p = JSON.parse(lsGet('chatroom.prefs') || '{}'); Object.assign(S.prefs, p); } catch {}
  X.applyTheme();
  buildShell();
  connectWS();
  await Promise.all([
    loadConvs().catch((e) => toast(e.message, 'error')),
    api('GET', '/api/notifications', null, { quiet: true }).then((d) => { S.notifs = d.notifications; S.notifUnread = d.unread; }).catch(() => {}),
    api('GET', '/api/me', null, { quiet: true }).then((d) => { S.ttlHours = d.ttlHours || 48; Object.assign(S.me, d.user); S.referral = d.referral; }).catch(() => {}),
  ]);
  const want = new URLSearchParams(location.search).get('c') || lsGet('chatroom.last');
  if (want && convOf(want) && !isMobile()) { S.active = want; }
  renderAll();
  if (S.active) openConv(S.active);
  X.announce();                                              // 'what's new' nudge once per release
  clearInterval(pruneTimer); pruneTimer = setInterval(pruneExpired, 30000); // messages vanish after ttl, mirror that on screen
}
// drop anything older than the server's expiry from memory and the screen
function pruneExpired() {
  if (!S.me) return;
  const cut = Date.now() - S.ttlHours * 3600_000; let touched = false;
  for (const c of S.convs) {
    if (c.loaded) {
      const n = c.msgs.length;
      c.msgs = c.msgs.filter((x) => new Date(x.createdAt).getTime() > cut);
      if (c.msgs.length !== n) {
        touched = true;
        const last = c.msgs[c.msgs.length - 1];
        c.lastMessage = last || null; c._preview = last ? C.previewText(last._p, last.senderId === S.me.id) : '';
        if (S.active === c.id) renderMessages(c);
      }
    } else if (c.lastMessage && new Date(c.lastMessage.createdAt).getTime() <= cut) { c.lastMessage = null; c._preview = ''; touched = true; }
  }
  if (touched) { renderSide(); renderRail(); }
}
function renderAll() { if (!S.me) return; renderRail(); renderSide(); renderMain(); renderHeader(); X.renderTop(); }

function renderRail() {
  const r = $('#rail'); if (!r) return;
  const unread = updateBadge();
  const btn = (view, icon, label, badge) => el('button', { class: 'rbtn' + (S.view === view ? ' on' : ''), title: label, onclick: () => { S.view = view; renderAll(); } }, ic(icon, 22), el('span', { class: 'rlabel' }, label), badge ? el('span', { class: 'badge' }, badge > 99 ? '99+' : badge) : null);
  if (!rind) rind = el('div', { class: 'rind' });             // one sliding highlight that glides between tabs
  r.replaceChildren(...[rind,
    el('div', { class: 'rlogo' }, 'c'),
    btn('chats', 'chat', 'chats', unread),
    btn('discover', 'compass', 'discover', 0),
    btn('games', 'gamepad', 'games', 0),
    btn('beta', 'star', 'beta', 0),
    btn('alerts', 'bell', 'alerts', S.notifUnread),
    S.me.isAdmin ? btn('admin', 'crown', 'admin', S.reportsOpen || 0) : null,
    el('button', { class: 'rbtn', title: 'settings', onclick: settingsModal }, ic('sliders', 22), el('span', { class: 'rlabel' }, 'you'), X.newsUnseen() ? el('span', { class: 'newdot' }) : null),
    el('div', { class: 'grow' }),
    el('div', { class: 'conn ' + (S.wsOk ? 'ok' : 'bad'), title: S.wsOk ? 'connected' : 'reconnecting' }),
    el('button', { class: 'rme', title: 'status', onclick: statusModal }, el('div', { class: 'avwrap' }, avatar(S.me.displayName, 38, '', S.me.avatar), dot(S.me.mode !== 'invisible', S.me.mode)))].filter(Boolean));
  requestAnimationFrame(() => {
    const on = r.querySelector('.rbtn.on');
    if (!on || isMobile()) { rind.style.opacity = 0; return; }
    const first = !rind.dataset.placed;
    if (first) { rind.style.transition = 'none'; }
    rind.style.opacity = 1; rind.style.transform = `translateY(${on.offsetTop}px)`;
    if (first) { rind.dataset.placed = 1; rind.offsetHeight; rind.style.transition = ''; }
  });
}
function renderSide() {
  const list = $('#clist'); if (!list) return;
  const f = ($('#cfilter') || { value: '' }).value.trim().toLowerCase();
  X.renderFolders();                                         // folder chips above the list (beta)
  const items = X.inFolder(S.convs).filter((c) => !f || convTitle(c).toLowerCase().includes(f)).sort((a, b) => (b.systemKind ? 1 : 0) - (a.systemKind ? 1 : 0)); // Everyone + Beta lounge stay on top
  if (!items.length) { list.classList.remove('stagger'); list.replaceChildren(el('div', { class: 'empty-s' }, S.convs.length ? 'no matches' : 'nothing yet, start one above')); return; }
  const anim = sideStagger; sideStagger = false;
  list.classList.toggle('stagger', anim);
  list.replaceChildren(...items.map((c, i) => {
    const o = c.type === 'dm' ? other(c) : null;
    const st = o ? statusFor(o.id, c) : null;
    const av = c.type === 'dm' ? el('div', { class: 'avwrap' }, avatar(convTitle(c), 46, '', o.avatar), dot(isOnline(c, o.id), st.mode)) : el('div', { class: 'avwrap' }, el('div', { class: 'avatar', style: `width:46px;height:46px;background:${tone(c.name)}` }, ic(c.systemKind === 'beta' ? 'star' : c.isPublic ? 'globe' : 'users', 20)));
    const act = o && activityOf(o.id);
    const typing = S.typing.get(c.id) && S.typing.get(c.id).size;
    const sub = typing ? el('span', { class: 'accent' }, 'typing...') : act ? el('span', null, 'playing ' + act.title) : (c._preview || '');
    return el('div', { class: 'citem' + (S.active === c.id ? ' active' : ''), style: `--i:${Math.min(i, 12)}`, onclick: () => openConv(c.id) }, av,
      el('div', { class: 'cmeta' },
        el('div', { class: 'crow' }, el('span', { class: 'ctitle' }, convTitle(c), o ? vb(o) : null), el('span', { class: 'ctime' }, c.lastMessage ? fmtTime(c.lastMessage.createdAt) : '')),
        el('div', { class: 'crow' },
          el('span', { class: 'cprev' }, sub),
          c.muted ? ic('mute', 14) : null,
          c.unread && !c.muted ? el('span', { class: 'badge' }, c.unread > 99 ? '99+' : c.unread) : c.unread ? el('span', { class: 'badge quiet' }, c.unread) : null),
        st && st.status && (st.status.text || st.status.icon) ? el('div', { style: 'margin-top:1px' }, statusLine(st)) : null));
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
  else if (want === 'admin') buildAdmin(m);
  else if (want === 'discover') X.buildDiscover(m);
  else if (want === 'beta') X.buildBeta(m);
  else buildChat(m, convOf(S.active));
}
function emptyState() {
  return el('div', { class: 'empty' }, mugIcon(), el('h2', null, 'chat', el('i', null, 'room')),
    el('div', { class: 'row gap center', style: 'margin-top:8px' }, el('button', { class: 'btn primary', onclick: newChatModal }, ic('userplus', 16), 'new chat'), el('button', { class: 'btn', onclick: newGroupModal }, ic('users', 16), 'new group')));
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
  const pinbar = el('div', { class: 'pinbar' });
  const msgs = el('div', { class: 'msgs' });
  const typing = el('div', { class: 'typing' });
  const cool = el('div', { class: 'cool' });
  const selbar = el('div', { class: 'selbar' });
  const sugg = el('div', { class: 'sugg' });
  const freebar = el('div', { class: 'freebar' });
  const modbar = el('div', { class: 'modbar' });
  const replybar = el('div', { class: 'replybar' });
  let lastTyping = 0;
  const input = el('textarea', {
    rows: 1, maxLength: 2000, placeholder: 'say something',
    oninput: () => {
      input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px';
      c.draft = input.value;
      if (input.value && Date.now() - lastTyping > 2500) { lastTyping = Date.now(); sendWS({ t: 'typing', convId: c.id }); }
      X.suggest(input, sugg);                                // :sk -> shows :skull:, @na -> members, /ba -> commands
    },
    onkeydown: (e) => { if (X.suggestKey(e, input, sugg)) return; if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); doSend(); } },
  });
  input.value = c.draft || '';
  const sendBtn = el('button', { class: 'btn primary send', title: 'send', onclick: doSend }, ic('send', 18));
  let sending = false;
  async function doSend() {
    if (sending) return;
    const raw = input.value.trim();
    if (raw.startsWith('/') && await X.slash(c, raw)) { input.value = ''; c.draft = ''; input.style.height = 'auto'; sugg.classList.remove('on'); input.focus(); return; }   // /ban, /mute, /slow and friends never get sent as messages
    const text = C.expandShortcodes(raw);                    // :skull: becomes the emoji before encryption
    if (!text) return;
    if (X.sendBlock(c)) { toast(X.sendBlock(c).text, 'error'); return; }
    if (C.F.check(text)) { toast('keep it clean, that was not sent', 'error'); return; } // word filter, runs before anything is encrypted
    sending = true; sendBtn.disabled = true;
    const payload = { t: 'text', text };
    if (c._reply) payload.reply = c._reply;                  // quoted message
    const ok = await sendPayload(c, payload, false, { mentions: X.mentionIds(c, text) });
    if (ok) { c._reply = null; X.drawReply(c); input.value = ''; c.draft = ''; input.style.height = 'auto'; sugg.classList.remove('on'); }
    sending = false; tickCooldown(); input.focus();
  }
  const emojiBtn = el('button', { class: 'icon-btn', title: 'emoji', onclick: () => X.emojiPicker(emojiBtn, (ch) => { const a = input.selectionStart ?? input.value.length; input.setRangeText(ch, a, input.selectionEnd ?? a, 'end'); input.dispatchEvent(new Event('input')); input.focus(); }) }, ic('smile', 20));
  m.append(el('div', { class: 'chat' }, head, pinbar, msgs, typing, selbar,
    el('div', { class: 'composer-wrap' }, cool, freebar, modbar, replybar, sugg,
      el('div', { class: 'composer' },
        el('button', { class: 'icon-btn', title: 'more: voice, stickers, polls, schedule, games', onclick: (e) => X.plusMenu(e.currentTarget, c, input) }, ic('plus', 20)),
        el('button', { class: 'icon-btn', title: 'share a game', onclick: () => pickGameModal(c) }, ic('gamepad', 20)),
        el('button', { class: 'icon-btn gifbtn', title: 'gif', onclick: () => X.gifModal(c) }, ic('image', 20)),
        emojiBtn, input, sendBtn))));
  c._shown = null;                                           // first paint of a chat should not animate every old message
  sel = null;                                                // leave select mode when switching chats
  chatRef = { head, pinbar, msgs, typing, input, sendBtn, cool, selbar, freebar, modbar, replybar, convId: c.id };
  renderHeader(); renderTyping(); tickCooldown(); X.loadPins(c); X.renderTop(); X.drawReply(c); X.applyWallpaper(c);
}
function renderHeader() {
  const h = chatRef.head; if (!h) return;
  const c = convOf(chatRef.convId); if (!c) return;
  const o = c.type === 'dm' ? other(c) : null;
  const st = o ? statusFor(o.id, c) : null;
  let sub;
  const t = S.typing.get(c.id);
  if (t && t.size) sub = el('span', { class: 'accent' }, c.type === 'dm' ? 'typing...' : [...t.keys()].map((id) => (memberOf(c, id) || {}).displayName || 'someone').join(', ') + ' typing...');
  else if (o) {
    const act = activityOf(o.id), on = isOnline(c, o.id);
    sub = act ? el('span', { class: 'good' }, 'playing ' + act.title) : (st && st.status && (st.status.text || st.status.icon)) ? statusLine(st) : el('span', { class: on ? 'good' : 'muted' }, on ? 'online' : 'offline');
  } else sub = el('span', { class: 'muted' }, `${c.isPublic ? 'public · ' : ''}${c.members.filter((x) => isOnline(c, x.id)).length} of ${c.memberCount || c.members.length} here${c.slowSeconds ? ' · slow mode ' + X.slowLabel(c.slowSeconds) : ''}`);
  h.replaceChildren(
    el('button', { class: 'icon-btn back', title: 'back', onclick: () => { S.active = null; renderAll(); } }, ic('back', 22)),
    o ? el('div', { class: 'avwrap' }, avatar(convTitle(c), 42, '', o.avatar), dot(isOnline(c, o.id), st.mode)) : el('div', { class: 'avatar', style: `width:42px;height:42px;background:${tone(c.name)}` }, ic(c.isPublic ? 'globe' : 'users', 18)),
    el('div', { class: 'grow click', onclick: () => (o ? openProfile(o.username) : groupModal(c)) }, el('div', { class: 'ctitle' }, convTitle(c), o ? vb(o) : null), el('div', { class: 'small' }, sub)),
    el('span', { class: 'ic muted', title: c.isPublic ? 'public room: open to everyone, not end-to-end encrypted' : 'end-to-end encrypted' }, ic(c.isPublic ? 'globe' : 'lock', 16)),
    !c.systemKind && (c.type === 'dm' || c.role === 'admin') ? el('button', { class: 'icon-btn' + (c.ttlSeconds ? ' on' : ''), title: 'disappearing messages', onclick: () => X.ttlModal(c) }, ic('timer', 20)) : null,
    el('button', { class: 'icon-btn', title: 'search this chat', onclick: () => X.searchModal(c) }, ic('search', 20)),
    X.dndActive() ? el('button', { class: 'icon-btn on', title: 'do not disturb is on', onclick: () => X.dndModal() }, ic('moon', 20)) : null,
    el('button', { class: 'icon-btn', title: c.muted ? 'unmute' : 'mute', onclick: async () => { c.muted = !c.muted; await api('PATCH', `/api/conversations/${c.id}/me`, { muted: c.muted }).catch(() => {}); renderHeader(); renderSide(); updateBadge(); } }, ic(c.muted ? 'mute' : 'volume', 20)),
    el('button', { class: 'icon-btn', title: 'details', onclick: () => (o ? openProfile(o.username) : groupModal(c)) }, ic('info', 20)));
}
function renderTyping() {
  renderHeader(); renderSide();
  const b = chatRef.typing; if (!b) return;
  const c = convOf(chatRef.convId); const t = c && S.typing.get(c.id);
  if (t && t.size) b.replaceChildren(el('span', { class: 'dots' }, el('i'), el('i'), el('i')), [...t.keys()].map((id) => (memberOf(c, id) || {}).displayName || 'someone').join(', '));
  else b.replaceChildren();
}
function tickCooldown() {
  const cool = chatRef.cool; if (!cool) return;
  clearInterval(tickCooldown.t);
  const upd = () => {
    const c = convOf(chatRef.convId);
    const left = Math.ceil((S.cooldownUntil - Date.now()) / 1000);
    const blk = c ? X.sendBlock(c) : null;                   // admin mute, group mute or slow mode
    if (left > 0) { cool.textContent = `easy there, try again in ${left}s`; cool.classList.add('on'); }
    else { cool.textContent = ''; cool.classList.remove('on'); }
    X.drawModbar(c);
    chatRef.sendBtn.disabled = left > 0 || !!blk;
    if (left <= 0 && !blk) clearInterval(tickCooldown.t);
  };
  upd(); if (S.cooldownUntil > Date.now() || (convOf(chatRef.convId) && X.sendBlock(convOf(chatRef.convId)))) tickCooldown.t = setInterval(upd, 500);
}
function gameCard(p) {
  return el('div', { class: 'gshare' }, el('div', { class: 'gshare-ic', style: `background:${tone(p.title)}` }, ic('gamepad', 22)),
    el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, p.title)),
    el('button', { class: 'btn small primary', onclick: () => openGame(p.path, p.title) }, ic('play', 14), 'play'));
}
// ---------- message actions: delete with undo, select many, pin, react, report ----------
let sel = null;                                              // Set of selected message ids while in select mode
const pendingDeletes = new Set();
const rankR = (isAdmin, role) => (isAdmin ? 3 : role === 'admin' ? 2 : role === 'mod' ? 1 : 0);   // global admin > host > mod > member
const myRank = (c) => rankR(S.me.isAdmin, c.role);
const canDelete = (c, m) => { if (m.deleted || m._hide) return false; if (m.senderId === S.me.id) return true; if (c.type !== 'group') return false; const s = memberOf(c, m.senderId); return myRank(c) >= 1 && myRank(c) > rankR(s && s.isAdmin, s && s.role); };
const canPin = (c) => c.type === 'dm' || c.role === 'admin' || c.role === 'mod';
function undoToast(text, onUndo, ms = 5000) {
  let box = $('#toasts'); if (!box) { box = el('div', { id: 'toasts' }); document.body.append(box); }
  const gone = () => { t.classList.add('out'); setTimeout(() => t.remove(), 240); };
  const t = el('div', { class: 'toast success undo' }, el('span', null, text), el('button', { class: 'btn small', onclick: () => { onUndo(); gone(); } }, ic('undo', 14), 'undo'));
  box.append(t); setTimeout(gone, ms);
}
function deleteWithUndo(c, ids) {
  const mine = ids.filter((id) => { const x = c.msgs.find((y) => y.id === id); return x && canDelete(c, x); });
  if (!mine.length) return;
  for (const id of mine) c.msgs.find((y) => y.id === id)._hide = true;   // hide right away, the real delete waits 5 seconds
  endSelect(c); renderMessages(c);
  const job = { ids: mine, sent: false }; pendingDeletes.add(job);
  const undo = () => { job.sent = true; pendingDeletes.delete(job); for (const id of mine) { const x = c.msgs.find((y) => y.id === id); if (x) x._hide = false; } renderMessages(c); };
  undoToast(mine.length > 1 ? `${mine.length} messages deleted` : 'message deleted', undo);
  setTimeout(async () => {
    if (job.sent) return; job.sent = true; pendingDeletes.delete(job);
    try { await api('POST', '/api/messages/delete', { ids: mine }, { quiet: true }); } catch (e) { toast(e.message, 'error'); for (const id of mine) { const x = c.msgs.find((y) => y.id === id); if (x) x._hide = false; } renderMessages(c); }
  }, 5200);
}
window.addEventListener('pagehide', () => { for (const j of pendingDeletes) if (!j.sent) { j.sent = true; api('POST', '/api/messages/delete', { ids: j.ids }, { quiet: true, keepalive: true }).catch(() => {}); } });
function startSelect(c, id) { sel = new Set(id ? [id] : []); drawSelbar(c); renderMessages(c); }
function toggleSel(c, id) { if (!sel) return; if (sel.has(id)) sel.delete(id); else sel.add(id); if (!sel.size) return endSelect(c); drawSelbar(c); renderMessages(c); }
function endSelect(c) { sel = null; drawSelbar(c); if (c) renderMessages(c); }
function drawSelbar(c) {
  const b = chatRef.selbar; if (!b) return;
  b.classList.toggle('on', !!sel);
  if (!sel) return b.replaceChildren();
  b.replaceChildren(el('span', { class: 'grow' }, `${sel.size} selected`), el('button', { class: 'btn small ghost', onclick: () => endSelect(c) }, 'cancel'), el('button', { class: 'btn small danger', onclick: () => deleteWithUndo(c, [...sel]) }, ic('trash', 14), 'delete'));
}
function msgTools(c, m, mine) {
  const p = m._p || {};
  const b = (icon, title, fn) => el('button', { class: 'icon-btn tiny', title, onclick: (e) => { e.stopPropagation(); fn(e); } }, ic(icon, 15));
  const kids = [b('smile', 'react', (e) => (!S.me.verified ? X.verifyModal() : X.emojiPicker(e.currentTarget, (ch) => X.toggleReact(c, m, ch, true), true)))];
  if (!m.deleted) kids.unshift(b('reply', 'reply', () => X.setReply(c, m)));
  if (!m.deleted && ['text', 'gif', 'game', 'image', 'sticker', 'voice'].includes(p.t)) kids.push(b('forward', 'forward', () => X.forwardModal(c, m)));
  if (!m.deleted) kids.push(b('bell', 'remind me', () => X.remindModal(c, m)));
  if (canPin(c)) kids.push(b('pin', m.pinned ? 'unpin' : 'pin', () => X.pinMessage(c, m)));
  if (mine && p.t === 'text' && C.betaActive()) kids.push(b('edit', 'edit', () => X.editMessage(c, m)));
  if (p.t === 'text') kids.push(b('copy', 'copy', () => { navigator.clipboard && navigator.clipboard.writeText(p.text).then(() => toast('copied', 'success')).catch(() => {}); }));
  if (canDelete(c, m)) kids.push(b('checksquare', 'select', () => startSelect(c, m.id)));
  if (!mine && p.t !== 'once') kids.push(b('flag', 'report', () => X.reportModal({ kind: 'message', msgId: m.id, convId: c.id, title: 'this message', snapshot: p.t === 'text' ? p.text : p.t === 'gif' ? '[gif] ' + p.url : '[' + p.t + ']' })));
  if (canDelete(c, m)) kids.push(b('trash', 'delete', () => deleteWithUndo(c, [m.id])));
  return el('div', { class: 'mtools' }, kids);
}
function renderMessages(c, stick) {
  const box = chatRef.msgs; if (!box || chatRef.convId !== c.id) return;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  const shown = c._shown;                                    // ids already on screen, so only fresh ones animate in
  const frag = document.createDocumentFragment();
  const gone = (x) => c.ttlSeconds && !x.pinned && Date.now() - new Date(x.createdAt).getTime() > c.ttlSeconds * 1000;   // short-timer chats hide old messages right away
  const list = c.msgs.filter((x) => !x._hide && !gone(x));
  if (c.hasMore) frag.append(el('button', { class: 'btn small ghost more', onclick: async () => { const h = box.scrollHeight; await loadMessages(c, true); c._shown = null; renderMessages(c); box.scrollTop = box.scrollHeight - h; } }, 'earlier'));
  frag.append(el('div', { class: 'vanish' }, ic('timer', 13), c.ttlSeconds ? `vanishes after ${X.ttlLabel(c.ttlSeconds)}, pins stay` : `vanishes after ${S.ttlHours % 24 === 0 ? S.ttlHours / 24 + (S.ttlHours === 24 ? ' day' : ' days') : S.ttlHours + ' hours'}, pins stay`));
  if (c.loaded && !list.length) frag.append(el('div', { class: 'empty-s' }, mugIcon()));
  let day = '', prev = null, prevT = 0;
  const lastMineId = [...list].reverse().find((x) => x.senderId === S.me.id && !x.deleted);
  const o = c.type === 'dm' ? other(c) : null;
  for (const m of list) {
    const d = fmtDay(m.createdAt);
    if (d !== day) { day = d; prev = null; frag.append(el('div', { class: 'daysep' }, d.toLowerCase())); }
    const t = new Date(m.createdAt).getTime();
    const first = prev !== m.senderId || t - prevT > 300000;
    prev = m.senderId; prevT = t;
    const mine = m.senderId === S.me.id;
    const sender = memberOf(c, m.senderId);
    const p = m._p || { t: 'error' };
    const body = p.t === 'text' ? el('div', { class: 'mtext' + (C.onlyEmoji(p.text) ? ' big' : '') }, linkify(p.text, c)) : p.t === 'game' ? gameCard(p) : p.t === 'gif' ? X.gifBody(p) : p.t === 'image' ? X.imageBody(c, m, p) : p.t === 'once' || (m.deleted && m.once) ? X.onceBody(c, m, p) : (X.extraBody(c, m, p) || el('div', { class: 'mtext muted-i' }, p.t === 'deleted' ? 'deleted' : 'could not decrypt'));
    const tome = p.t === 'text' && !mine && X.mentionsMe(p.text);
    const seen = lastMineId && lastMineId.id === m.id && o && o.lastReadAt && new Date(o.lastReadAt) >= new Date(m.createdAt);
    const isNew = shown && !shown.has(m.id);
    const picked = sel && sel.has(m.id), selectable = sel && canDelete(c, m);
    const rx = Object.entries(m.reactions || {}).filter(([, u]) => u.length);
    frag.append(el('div', { 'data-mid': m.id, class: 'mrow' + (mine ? ' mine' : '') + (first ? ' first' : '') + (isNew ? ' new' : '') + (sel ? ' selecting' : '') + (picked ? ' picked' : '') },
      selectable ? el('span', { class: 'selbox' + (picked ? ' on' : ''), onclick: () => toggleSel(c, m.id) }, picked ? ic('check', 12) : null) : (sel ? el('span', { class: 'selbox off' }) : null),
      !mine && c.type === 'group' ? (first ? el('div', { class: 'click', onclick: () => sender && openProfile(sender.username) }, avatar(sender ? sender.displayName : '?', 30, '', sender && sender.avatar)) : el('div', { style: 'width:30px;flex:none' })) : null,
      el('div', { class: 'bubwrap' },
        el('div', { class: 'bubble' + (tome ? ' tome' : '') + (p.t === 'image' ? ' imgb' : '') + (p.t === 'gif' ? ' gifb' : '') + (p.t === 'sticker' ? ' stickb' : '') + (m.pinned ? ' pinned' : ''), onclick: (e) => { if (sel && selectable) return toggleSel(c, m.id); if (matchMedia('(hover: none)').matches && !e.target.closest('a,button')) { const was = e.currentTarget.classList.contains('tools-on'); box.querySelectorAll('.tools-on').forEach((n) => n.classList.remove('tools-on')); if (!was) e.currentTarget.classList.add('tools-on'); } } },
          !m.deleted && !sel ? msgTools(c, m, mine) : null,
          first && !mine && c.type === 'group' ? el('div', { class: 'mname click', onclick: () => sender && openProfile(sender.username) }, sender ? sender.displayName : 'former member', vb(sender)) : null,
          p.fwd ? el('div', { class: 'fwdtag' }, ic('forward', 12), 'forwarded' + (p.fwd.name ? ' from ' + p.fwd.name : '')) : null,
          p.reply ? X.quoteEl(c, p.reply) : null,
          body,
          el('div', { class: 'mmeta' }, m.pinned ? el('span', { class: 'pinmark', title: 'pinned' }, ic('pin', 12)) : null, fmtTime(m.createdAt), m.editedAt ? el('span', { class: 'edited' }, 'edited') : null, seen ? el('span', { class: 'seen' }, ic('check', 12), 'seen') : null)),
        rx.length ? el('div', { class: 'rxrow' }, rx.map(([e, u]) => el('button', { class: 'rx' + (u.includes(S.me.id) ? ' mine' : ''), title: u.map((id) => (id === S.me.id ? 'you' : (memberOf(c, id) || {}).displayName || 'someone')).join(', '), onclick: () => X.toggleReact(c, m, e) }, C.emojiEl(e), el('span', null, u.length)))) : null)));
  }
  box.replaceChildren(frag);
  c._shown = new Set(c.msgs.map((x) => x.id));
  if (stick) box.scrollTop = box.scrollHeight;
  else if (near) box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
}
function notifyMessage(c, msg, payload) {
  const sender = memberOf(c, msg.senderId);
  const who = sender ? sender.displayName : 'Someone';
  const text = C.previewText(payload, false);
  const title = c.type === 'group' ? `${who} in ${c.name}` : who;
  if (X.dndActive()) return;                                 // do not disturb: no sound, no popups
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
  const m = modal('new chat', null);
  const s = userSearch((u) => startDM(u.username, m));
  m.box.querySelector('.modal-body').replaceChildren(s.node);
  s.input.focus();
}
function newGroupModal() {
  const picked = new Map();
  const chips = el('div', { class: 'chips' });
  const name = el('input', { placeholder: 'group name', maxLength: 40 });
  const err = el('div', { class: 'form-err' });
  const create = el('button', { class: 'btn primary wide', onclick: async () => {
    if (!name.value.trim()) { err.textContent = 'needs a name'; return; }
    if (!picked.size) { err.textContent = 'add someone'; return; }
    create.disabled = true; create.textContent = 'one sec...'; err.textContent = '';
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
    } catch (e) { err.textContent = e.message; create.disabled = false; create.textContent = 'create'; }
  } }, 'create');
  const draw = () => chips.replaceChildren(...[...picked.values()].map((u) => el('span', { class: 'chip' }, u.displayName, el('button', { onclick: () => { picked.delete(u.id); draw(); } }, ic('x', 12)))));
  const s = userSearch((u) => { if (picked.size < 49) picked.set(u.id, u); draw(); s.reset(); }, new Set([S.me.id]));
  const m = modal('new group', el('div', null, name, chips, s.node, err, create));
  name.focus();
}
async function groupModal(c) {
  const body = el('div');
  const m = modal(c.name, body, { wide: true });
  const isAdmin = () => c.role === 'admin';
  const draw = () => {
    const nameIn = el('input', { value: c.name, maxLength: 40, disabled: !isAdmin() });
    const addBox = el('div');
    if (isAdmin() && !c.isPublic) {
      const s = userSearch(async (u) => {
        try {
          const p = await api('GET', '/api/users/' + encodeURIComponent(u.username));
          const { raw } = await keyFor(c, c.keyVersion);
          const w = await wrapGroupKey(raw, p.publicKey, p.id);
          await api('POST', `/api/conversations/${c.id}/members`, { userId: p.id, ...w });
          await loadConvs(); toast(`${p.displayName} is in`, 'success'); draw();
        } catch (e) { toast(e.message, 'error'); }
      }, new Set(c.members.map((x) => x.id)));
      addBox.append(el('h4', null, 'add someone'), s.node);
    }
    body.replaceChildren(
      c.isPublic ? el('div', { class: 'row gap-s', style: 'margin-bottom:8px' }, el('span', { class: 'tag' }, 'public'), el('span', { class: 'tag' }, c.topic || 'other')) : null,
      c.isPublic && c.description ? el('p', { class: 'muted', style: 'margin:0 0 8px' }, c.description) : null,
      el('div', { class: 'row gap' }, nameIn, isAdmin() ? el('button', { class: 'btn', onclick: async () => { try { await api('PATCH', `/api/conversations/${c.id}`, { name: nameIn.value }); c.name = nameIn.value.trim(); renderAll(); toast('renamed', 'success'); } catch (e) { toast(e.message, 'error'); } } }, 'save') : null),
      isAdmin() && c.isPublic ? el('button', { class: 'btn small', style: 'margin-top:8px', onclick: () => X.editPublic(c, draw) }, ic('edit', 14), 'about') : null,
      el('h4', null, `${c.members.length} people`),
      el('div', { class: 'ulist' }, c.members.map((u) => el('div', { class: 'urow' },
        el('div', { class: 'avwrap click', onclick: () => openProfile(u.username) }, avatar(u.displayName, 34, '', u.avatar), dot(isOnline(c, u.id))),
        el('div', { class: 'grow click', onclick: () => openProfile(u.username) }, el('div', { class: 'ctitle' }, u.displayName + (u.id === S.me.id ? ' (you)' : ''), vb(u)), el('div', { class: 'muted small' }, '@' + u.username)),
        u.role === 'admin' ? el('span', { class: 'tag' }, 'host') : u.role === 'mod' ? el('span', { class: 'tag' }, 'mod') : null,
        ...X.memberTools(c, u, draw),
        u.id !== S.me.id && myRank(c) >= 1 && myRank(c) > rankR(u.isAdmin, u.role) ? el('button', { class: 'icon-btn', title: 'remove', onclick: async () => { if (await confirmModal(`remove ${u.displayName}?`, c.isPublic ? 'they cannot rejoin.' : 'the group key changes, so they cannot read anything new.', 'remove')) { await removeMember(c, u.id); draw(); } } }, ic('x', 16)) : null))),
      addBox,
      X.staffSection(c, draw),
      el('div', { class: 'row between', style: 'margin-top:14px' },
        c.isPublic && !isAdmin() ? el('button', { class: 'btn ghost', onclick: () => { m.close(); X.reportModal({ kind: 'group', convId: c.id, title: c.name }); } }, ic('flag', 16), 'report') : el('span'),
        el('button', { class: 'btn danger', onclick: async () => { if (await confirmModal(`leave ${c.name}?`, '', 'leave')) { await removeMember(c, S.me.id); m.close(); } } }, ic('logout', 16), 'leave')));
  };
  draw();
}
async function removeMember(c, userId) {
  try {
    const remaining = c.members.filter((x) => x.id !== userId);
    const keys = [];
    if (!c.isPublic) {                                       // private groups rotate the key so removed people lose access
      const raw = rand(32);
      for (const r of remaining) keys.push({ userId: r.id, ...(await wrapGroupKey(raw, r.publicKey, r.id)) });
    }
    await api('DELETE', `/api/conversations/${c.id}/members/${userId}`, { keys });
    if (userId === S.me.id) { S.convs = S.convs.filter((x) => x.id !== c.id); if (S.active === c.id) S.active = null; renderAll(); }
    else await loadConvs();
  } catch (e) { toast(e.message, 'error'); }
}
async function openProfile(username) {
  const body = el('div', null, el('div', { class: 'muted pad' }, '...'));
  const m = modal('', body);
  try {
    const p = await api('GET', '/api/users/' + encodeURIComponent(username));
    const me = p.id === S.me.id;
    const sn = me ? null : await safetyNumber(S.me.publicKey, p.publicKey);
    const st = me ? { status: S.me.status } : { status: p.status };
    const owner = p.isOwner;
    body.replaceChildren(
      X.banner(p.banner),
      el('div', { class: 'prof-head' + (p.banner ? ' hasbanner' : '') }, el('div', { class: 'avwrap' }, avatar(p.displayName, 68, '', p.avatar), dot(p.online, p.mode)),
        el('div', { class: 'grow' }, el('h3', null, p.displayName, vb(p)), el('div', { class: 'muted' }, '@' + p.username, p.isAdmin ? el('span', { class: 'tag gold', style: 'margin-left:8px' }, owner ? 'owner' : 'admin') : null),
          el('div', { style: 'margin-top:4px' }, p.activity ? el('span', { class: 'good small' }, 'playing ' + p.activity.title) : statusLine(st) || el('span', { class: (p.online ? 'good' : 'muted') + ' small' }, p.online ? 'online' : 'offline')))),
      p.bio ? el('p', { class: 'bio' }, p.bio) : null,
      me ? el('div', { class: 'row gap' }, el('button', { class: 'btn grow', onclick: () => { m.close(); statusModal(); } }, ic('edit', 16), 'set status'), el('button', { class: 'btn grow', onclick: () => { m.close(); X.profileEditModal(); } }, ic('sparkle', 16), 'bio and banner', el('span', { class: 'tag gold' }, 'beta'))) : null,
      p.badges && p.badges.length ? el('div', { class: 'badgerow' }, p.badges.map((b) => el('span', { class: 'bdg', title: b.name + ': ' + b.desc }, ic(b.icon, 14), b.name))) : null,
      p.stats ? el('div', { class: 'stats' }, el('div', null, el('b', null, fmtDur(p.stats.totalSeconds)), el('span', null, 'played')), el('div', null, el('b', null, p.stats.gamesPlayed), el('span', null, 'games'))) : null,
      p.stats && p.stats.top.length ? el('div', null, el('h4', null, 'most played'), p.stats.top.map((g) => el('div', { class: 'urow' }, el('div', { class: 'grow' }, g.title), el('span', { class: 'muted small' }, fmtDur(g.seconds))))) : null,
      me ? null : el('div', null, el('h4', null, ic('shield', 14), 'safety number'), el('div', { class: 'sn' }, sn)),
      me ? null : el('div', { class: 'row gap', style: 'margin-top:16px' },
        el('button', { class: 'btn primary', onclick: () => startDM(p.username, m) }, ic('chat', 16), 'message'),
        el('button', { class: 'btn ' + (p.blocked ? '' : 'danger'), onclick: async () => { try { await api(p.blocked ? 'DELETE' : 'POST', '/api/blocks/' + encodeURIComponent(p.username)); toast(p.blocked ? 'unblocked' : 'blocked', 'success'); m.close(); } catch (e) { toast(e.message, 'error'); } } }, ic('ban', 16), p.blocked ? 'unblock' : 'block'),
        el('button', { class: 'btn ghost', onclick: () => { m.close(); X.reportModal({ kind: 'user', username: p.username, title: p.displayName }); } }, ic('flag', 16), 'report')));
  } catch (e) { body.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
}
function avatarModal() {                                     // pick one of the preset pictures, or go back to the letter
  const grid = el('div', { class: 'avgrid' });
  const m = modal('profile picture', el('div', null, el('p', { class: 'muted small', style: 'margin-top:0' }, 'pick one. everyone sees it next to your name.'), grid));
  const draw = () => grid.replaceChildren(
    el('button', { class: 'avopt' + (!S.me.avatar ? ' on' : ''), title: 'letter', onclick: () => pick(null) }, avatar(S.me.displayName, 52)),
    ...Object.keys(C.PRESETS).map((id) => el('button', { class: 'avopt' + (S.me.avatar === id ? ' on' : ''), title: C.PRESETS[id][0], onclick: () => pick(id) }, avatar('', 52, '', id))));
  async function pick(id) {
    try { const d = await api('PATCH', '/api/me', { avatar: id }); S.me.avatar = d.user.avatar; draw(); renderAll(); }
    catch (e) { toast(e.message, 'error'); }
  }
  draw();
}
function settingsModal() {
  const dn = el('input', { value: S.me.displayName, maxLength: 32 });
  const savePrefs = () => lsSet('chatroom.prefs', JSON.stringify(S.prefs));
  const toggle = (label, on, fn) => { const b = el('button', { class: 'switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on, 'aria-label': label, onclick: async () => { const v = !b.classList.contains('on'); const ok = await fn(v); if (ok !== false) { b.classList.toggle('on', v); b.setAttribute('aria-checked', v); } } }, el('i')); return el('div', { class: 'setrow' }, el('div', { class: 'grow' }, label), b); };
  const pushOK = SAME_ORIGIN && 'serviceWorker' in navigator && 'PushManager' in window;
  const themeBtn = (v, label) => el('button', { class: (S.prefs.theme || 'auto') === v ? 'on' : '', onclick: (e) => { S.prefs.theme = v; savePrefs(); applyTheme(); e.target.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target)); } }, label);
  const m = modal('you', el('div', null,
    el('div', { class: 'row gap' }, dn, el('button', { class: 'btn', onclick: async () => { try { const d = await api('PATCH', '/api/me', { displayName: dn.value }); S.me.displayName = d.user.displayName; renderAll(); toast('saved', 'success'); } catch (e) { toast(e.message, 'error'); } } }, 'save')),
    el('div', { class: 'row gap', style: 'margin-top:10px' },
      el('button', { class: 'btn grow', onclick: () => { m.close(); avatarModal(); } }, avatar(S.me.displayName, 22, '', S.me.avatar), 'profile picture'),
      el('button', { class: 'btn grow', onclick: () => { m.close(); statusModal(); } }, ic('edit', 16), 'set status')),
    el('div', { class: 'row gap', style: 'margin-top:8px' },
      S.me.verified ? el('div', { class: 'btn grow verified-pill' }, ic('verified', 16), 'verified') : el('button', { class: 'btn grow primary', onclick: () => { m.close(); X.verifyModal(); } }, ic('verified', 16), 'verify me'),
      el('button', { class: 'btn grow', onclick: () => { m.close(); X.badgesModal(); } }, ic('trophy', 16), 'badges')),
    el('div', { class: 'row gap', style: 'margin-top:8px' },
      el('button', { class: 'btn grow', onclick: () => { m.close(); X.inviteModal(); } }, ic('gift', 16), 'invite friends'),
      el('button', { class: 'btn grow', onclick: () => { m.close(); X.newsModal(); } }, ic('newspaper', 16), "what's new", X.newsUnseen() ? el('span', { class: 'newdot inline' }) : null)),
    el('h4', null, ic('palette', 14), 'look'),
    el('div', { class: 'seg small' }, themeBtn('auto', 'auto'), themeBtn('light', 'day'), themeBtn('dark', 'night')),
    el('button', { class: 'btn wide', style: 'margin-top:10px', onclick: () => { m.close(); X.themeModal(); } }, ic('palette', 16), 'custom theme', el('span', { class: 'tag gold' }, 'beta')),
    el('div', { class: 'row gap', style: 'margin-top:8px' },
      el('button', { class: 'btn grow', onclick: () => { m.close(); X.dndModal(); } }, ic('moon', 16), X.dndActive() ? 'dnd is on' : 'do not disturb'),
      el('button', { class: 'btn grow', onclick: () => { m.close(); X.remindersModal(); } }, ic('bell', 16), 'reminders', el('span', { class: 'tag gold' }, 'beta'))),
    el('button', { class: 'btn wide', style: 'margin-top:8px', onclick: () => { m.close(); X.wallpaperModal(null); } }, ic('image', 16), 'chat wallpaper', el('span', { class: 'tag gold' }, 'beta')),
    el('h4', null, 'ping me'),
    toggle('show what i am playing', S.me.shareActivity, async (v) => { try { const d = await api('PATCH', '/api/me', { shareActivity: v }); S.me.shareActivity = d.user.shareActivity; } catch (e) { toast(e.message, 'error'); return false; } }),
    toggle('sound', S.prefs.sound, (v) => { S.prefs.sound = v; savePrefs(); if (v) beep(); }),
    toggle('desktop popups', S.prefs.desktop && 'Notification' in window && Notification.permission === 'granted', async (v) => {
      if (!v) { S.prefs.desktop = false; savePrefs(); return; }
      if (!('Notification' in window)) { toast('this browser has no notifications', 'error'); return false; }
      const p = await Notification.requestPermission();
      if (p !== 'granted') { toast('blocked in your browser settings', 'error'); return false; }
      S.prefs.desktop = true; savePrefs();
    }),
    pushOK ? toggle('push when closed', false, async (v) => (v ? enablePush() : disablePush())) : null,
    el('div', { style: 'margin-top:18px' }, el('button', { class: 'btn danger', onclick: async () => { if (await confirmModal('sign out?', '', 'sign out')) { m.close(); logout(false); } } }, ic('logout', 16), 'sign out'))));
}

// ---------- custom status ----------
const PRESETS = [['book', 'studying'], ['coffee', 'taking a break'], ['headphones', 'in my music'], ['code', 'building stuff'], ['gamepad', 'gaming'], ['moon', 'sleeping'], ['pizza', 'eating'], ['leaf', 'touching grass']];
function statusModal() {
  const cur = S.me.status || { text: '', icon: '' };
  let icon = cur.icon || '', mode = S.me.mode || 'online', mins = 0;
  const text = el('input', { placeholder: 'what are you up to', maxLength: 48, value: cur.text || '' });
  const grid = el('div', { class: 'status-grid' });
  const modes = el('div', { class: 'mode-row' });
  const exp = el('div', { class: 'cats', style: 'margin:0' });
  const drawGrid = () => grid.replaceChildren(...STATUS_ICONS.map((n) => el('button', { class: n === icon ? 'on' : '', title: n, onclick: () => { icon = icon === n ? '' : n; drawGrid(); } }, ic(n, 22))));
  const drawModes = () => modes.replaceChildren(...[['online', 'around'], ['busy', 'busy'], ['invisible', 'hidden']].map(([k, l]) => el('button', { class: k + (mode === k ? ' on' : ''), onclick: () => { mode = k; drawModes(); } }, el('i'), l)));
  const drawExp = () => exp.replaceChildren(...[[0, 'keep'], [30, '30 min'], [60, '1 hour'], [240, '4 hours'], [1440, 'a day']].map(([v, l]) => el('button', { class: 'chip-b' + (mins === v ? ' on' : ''), onclick: () => { mins = v; drawExp(); } }, l)));
  const presets = el('div', { class: 'presets' }, PRESETS.map(([i, t]) => el('button', { class: 'chip-b', onclick: () => { icon = i; text.value = t; drawGrid(); } }, t)));
  const save = async (clear) => {
    try {
      const d = await api('PUT', '/api/me/status', clear ? { mode: 'online' } : { text: text.value, icon, mode, expiresMinutes: mins });
      Object.assign(S.me, d.user); renderAll(); m.close(); toast(clear ? 'status cleared' : 'status set', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  const m = modal('status', el('div', null, drawModes() || modes, text, presets, grid, el('h4', null, ic('timer', 14), 'clear after'), exp,
    el('div', { class: 'row gap end', style: 'margin-top:18px' }, (cur.text || cur.icon || mode !== 'online') ? el('button', { class: 'btn ghost', onclick: () => save(true) }, 'clear') : null, el('button', { class: 'btn primary', onclick: () => save(false) }, 'save'))));
  drawGrid(); drawModes(); drawExp(); text.focus();
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
    toast('push on', 'success');
  } catch (e) { toast('push failed: ' + e.message, 'error'); return false; }
}
async function disablePush() {
  try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && (await reg.pushManager.getSubscription()); if (sub) await sub.unsubscribe(); await api('DELETE', '/api/push/subscribe'); } catch {}
}
function pickGameModal(c) {
  const list = el('div', { class: 'ulist tall' });
  const input = el('input', { placeholder: 'search games' });
  const m = modal('share a game', el('div', null, el('div', { class: 'searchbox' }, ic('search', 16), input), list));
  const run = debounce(async () => {
    try {
      const d = await api('GET', '/api/games?limit=30&q=' + encodeURIComponent(input.value), null, { quiet: true });
      list.replaceChildren(...(d.items.length ? d.items.map((g) => el('div', { class: 'urow click', onclick: async () => { m.close(); await sendPayload(c, { t: 'game', path: g.id, title: g.title }); } }, el('div', { class: 'gshare-ic sm', style: `background:${tone(g.title)}` }, ic('gamepad', 16)), el('div', { class: 'grow' }, g.title), ic('send', 16))) : [el('div', { class: 'muted pad' }, d.indexed ? 'no games found' : 'still loading the list, try again soon')]));
    } catch (e) { list.replaceChildren(el('div', { class: 'muted pad' }, e.message)); }
  }, 250);
  input.addEventListener('input', run); run(); input.focus();
}

// ---------- alerts ----------
function buildAlerts(m) {
  const list = S.notifs.length ? S.notifs.map((n) => {
    const txt = n.type === 'group_added' ? `${n.data.by} added you to ${n.data.name}` : n.type === 'dm_new' ? `${n.data.from} started a chat` : n.type === 'sched_failed' ? 'a scheduled message could not be sent' : n.type === 'referral' ? `${n.data.name} joined, +${n.data.minutes} min beta` : n.type === 'report' ? 'new report to review' : n.type === 'verified' ? 'you are verified' : n.type === 'verify_rejected' ? 'verification not approved' + (n.data.note ? ': ' + n.data.note : '') : 'new alert';
    return el('div', { class: 'urow click' + (n.read ? '' : ' unread'), onclick: () => n.data.convId && convOf(n.data.convId) && openConv(n.data.convId) }, el('div', { class: 'gshare-ic sm', style: `background:${tone(txt)}` }, ic(n.type === 'group_added' ? 'users' : n.type === 'referral' ? 'gift' : n.type === 'report' ? 'flag' : 'chat', 16)), el('div', { class: 'grow' }, el('div', null, txt), el('div', { class: 'muted small' }, ago(n.createdAt))));
  }) : [el('div', { class: 'empty-s' }, mugIcon())];
  m.append(el('div', { class: 'page' }, el('div', { class: 'page-head' }, el('h2', null, 'alerts'), S.notifs.length ? el('button', { class: 'btn small', onclick: async () => { await api('POST', '/api/notifications/read').catch(() => {}); S.notifs.forEach((n) => (n.read = true)); S.notifUnread = 0; renderAll(); builtMain = ''; renderMain(); } }, 'mark read') : null), el('div', { class: 'ulist stagger' }, list.map((x, i) => { x.style.setProperty('--i', Math.min(i, 10)); return x; }))));
  if (S.notifUnread) { api('POST', '/api/notifications/read', null, { quiet: true }).catch(() => {}); S.notifUnread = 0; S.notifs.forEach((n) => (n.read = true)); setTimeout(renderRail, 50); }
}

// ---------- admin panel (server enforces everything, this is only the face) ----------
const fmtBytes = (n) => (n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1e3) + ' KB');
function buildAdmin(m) {
  if (!S.me.isAdmin) return m.append(el('div', { class: 'empty' }, mugIcon()));
  const tiles = el('div', { class: 'stat-tiles' }), list = el('div'), q = el('input', { placeholder: 'find someone', oninput: debounce(() => loadUsers(), 250) });
  const isOwner = S.me.isOwner;
  const act = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg, 'success'); loadUsers(); loadStats(); } catch (e) { toast(e.message, 'error'); } };
  async function loadStats() {
    if (!tiles.isConnected) return;
    try {
      const d = await api('GET', '/api/admin/stats', null, { quiet: true });
      const t = [['people', d.users], ['online', d.online], ['messages', d.messages], ['groups', d.groups], ['plays', d.plays], ['reports', d.reports], ['to verify', d.pending_verifications], ['appeals', d.pending_appeals || 0], ['public', d.public_groups], ['storage', fmtBytes(d.bytes)], ['vanish', d.ttlHours % 24 ? d.ttlHours + 'h' : d.ttlHours / 24 + 'd']];
      tiles.replaceChildren(...t.map(([l, v], i) => el('div', { class: 'tile', style: `--i:${i}` }, el('b', null, v), el('span', null, l))));
    } catch (e) { tiles.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
  }
  async function loadUsers() {
    if (!list.isConnected) return;
    try {
      const d = await api('GET', '/api/admin/users?q=' + encodeURIComponent(q.value.trim()), null, { quiet: true });
      list.replaceChildren(...d.users.map((u, i) => {
        const locked = u.isOwner || (u.isAdmin && !isOwner);        // owner is untouchable, admins only the owner can touch
        return el('div', { class: 'arow' + (u.banned ? ' banned' : ''), style: `--i:${Math.min(i, 14)}` },
          el('div', { class: 'avwrap' }, avatar(u.displayName, 40, '', u.avatar), dot(u.online)),
          el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, u.displayName, u.isOwner ? el('span', { class: 'tag gold', style: 'margin-left:8px' }, 'owner') : u.isAdmin ? el('span', { class: 'tag gold', style: 'margin-left:8px' }, 'admin') : null, u.banned ? el('span', { class: 'tag', style: 'margin-left:8px' }, 'suspended') : null, u.beta && !u.isAdmin ? el('span', { class: 'tag', style: 'margin-left:8px' }, 'beta') : null),
            el('div', { class: 'muted small' }, `@${u.username} · ${u.messages} msgs · joined ${fmtDay(u.createdAt).toLowerCase()}`)),
          el('div', { class: 'acts' }, !u.isAdmin ? el('button', { class: 'icon-btn' + (u.verified ? ' on' : ''), title: u.verified ? 'remove verification' : 'verify', onclick: () => act(() => api('POST', `/api/admin/users/${u.id}/verify`, { verified: !u.verified }), u.verified ? 'unverified' : 'verified') }, ic('verified', 18)) : null, el('button', { class: 'icon-btn' + (u.beta ? ' on' : ''), title: 'beta time', onclick: () => X.betaModal(u, loadUsers) }, ic('star', 18)),
            isOwner && !u.isOwner ? el('button', { class: 'icon-btn', title: u.isAdmin ? 'remove admin' : 'make admin', onclick: () => act(() => api('POST', `/api/admin/users/${u.id}/admin`, { admin: !u.isAdmin }), u.isAdmin ? 'admin removed' : `${u.displayName} is an admin now`) }, ic('crown', 18)) : null,
            !locked ? el('button', { class: 'icon-btn', title: u.banned ? 'restore' : 'suspend', onclick: async () => { if (u.banned || await confirmModal(`suspend ${u.displayName}?`, 'they get signed out and cannot come back until restored.', 'suspend')) act(() => api('POST', `/api/admin/users/${u.id}/ban`, { banned: !u.banned }), u.banned ? 'restored' : 'suspended'); } }, ic('ban', 18)) : null,
            !locked ? el('button', { class: 'icon-btn', title: 'remove account', onclick: async () => { if (await confirmModal(`remove ${u.displayName}?`, 'the account is deleted for good.', 'remove')) act(() => api('DELETE', `/api/admin/users/${u.id}`), 'removed'); } }, ic('trash', 18)) : null));
      }));
      if (!d.users.length) list.replaceChildren(el('div', { class: 'empty-s' }, 'nobody'));
    } catch (e) { list.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
  }
  m.append(el('div', { class: 'page' },
    el('div', { class: 'page-head' }, el('h2', null, 'ad', el('i', null, 'min')),
      el('div', { class: 'row gap-s' },
        el('button', { class: 'btn small', onclick: () => act(() => api('POST', '/api/admin/purge', { what: 'messages' }), 'expired messages swept') }, ic('timer', 14), 'sweep now'),
        el('button', { class: 'btn small', onclick: async () => { if (await confirmModal('clear play history?', 'finished sessions are removed.', 'clear')) act(() => api('POST', '/api/admin/purge', { what: 'plays' }), 'cleared'); } }, ic('database', 14), 'clear plays'))),
    tiles,
    (() => {
      const people = el('div', null, el('div', { class: 'searchbox' }, ic('search', 16), q), list);
      const hid = () => el('div', { style: 'display:none' });
      const panes = { people, reports: hid(), verify: hid(), appeals: hid(), announce: hid(), audit: hid(), stats: hid() };
      const loaders = { reports: () => X.adminReports(panes.reports, loadStats), verify: () => X.adminVerify(panes.verify, loadStats), appeals: () => X.adminAppeals(panes.appeals, loadStats), announce: () => X.adminAnnounce(panes.announce), audit: () => X.adminAudit(panes.audit), stats: () => X.adminStats(panes.stats) };
      const tabBtns = {};
      const tab = (k, label) => tabBtns[k] = el('button', { class: k === 'people' ? 'on' : '', onclick: (e) => { e.currentTarget.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); for (const [n, node] of Object.entries(panes)) node.style.display = n === k ? '' : 'none'; if (loaders[k]) loaders[k](); } }, label);
      window.__ui.reportsChanged = () => { loadStats(); if (panes.reports.isConnected && panes.reports.style.display !== 'none') loaders.reports(); };
      window.__ui.verifyChanged = () => { loadStats(); if (panes.verify.isConnected && panes.verify.style.display !== 'none') loaders.verify(); };
      window.__ui.appealsChanged = () => { loadStats(); if (panes.appeals.isConnected && panes.appeals.style.display !== 'none') loaders.appeals(); };
      setTimeout(() => { const k = S.adminTab; S.adminTab = null; if (k && tabBtns[k]) tabBtns[k].click(); }, 0);   // /audit, /stats and /appeals jump straight to their tab
      return el('div', null, el('div', { class: 'seg wrapseg' }, tab('people', 'people'), tab('reports', 'reports'), tab('verify', 'verify'), tab('appeals', 'appeals'), tab('announce', 'announce'), tab('audit', 'audit log'), tab('stats', 'stats')), people, panes.reports, panes.verify, panes.appeals, panes.announce, panes.audit, panes.stats);
    })()));
  loadStats(); loadUsers();
  nowTimer = setInterval(loadStats, 20000);
}

// ---------- gamesplace ----------
const G = { q: '', cat: '', items: [], total: 0, cats: [], indexed: 0, loading: false, tab: 'library', range: 'all' };
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
    el('button', { class: G.tab === 'library' ? 'on' : '', onclick: () => { G.tab = 'library'; builtMain = ''; renderMain(); } }, ic('gamepad', 16), 'library'),
    el('button', { class: G.tab === 'activity' ? 'on' : '', onclick: () => { G.tab = 'activity'; builtMain = ''; renderMain(); } }, ic('activity', 16), 'activity'));
  m.append(el('div', { class: 'page' }, el('div', { class: 'page-head' }, el('h2', null, 'games', el('i', null, 'place')), tabs), content));
  if (G.tab === 'library') {
    const input = el('input', { placeholder: 'search', value: G.q, oninput: debounce(() => { G.q = input.value; loadGames(true); }, 300) });
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
  const catName = (c) => (c.length === 1 ? c.toUpperCase() : c);
  chips.replaceChildren(el('button', { class: 'chip-b' + (!G.cat ? ' on' : ''), onclick: () => { G.cat = ''; loadGames(true); renderGameGrid(); } }, 'all'), ...G.cats.map((c) => el('button', { class: 'chip-b' + (G.cat === c.cat ? ' on' : ''), onclick: () => { G.cat = c.cat; loadGames(true); renderGameGrid(); } }, catName(c.cat).toLowerCase())));
  const counts = {}; for (const n of S.nowPlaying) counts[n.path] = (counts[n.path] || 0) + 1;
  if (!G.items.length) { grid.replaceChildren(el('div', { class: 'empty-s wide' }, G.loading ? mugIcon() : G.indexed ? 'nothing matches' : 'list is still loading', !G.loading && !G.indexed ? el('button', { class: 'btn small', onclick: () => loadGames(true) }, 'retry') : null)); more.replaceChildren(); return; }
  grid.classList.toggle('stagger', G.items.length <= 60);
  grid.replaceChildren(...G.items.map((g, i) => el('div', { class: 'gcard', style: `--i:${Math.min(i, 14)}`, onclick: () => openGame(g.id, g.title) },
    el('div', { class: 'gtile', style: `background:${tone(g.title)}` }, el('span', null, g.title.slice(0, 2)), counts[g.id] ? el('span', { class: 'live-tag' }, counts[g.id] + ' playing') : null),
    el('div', { class: 'ginfo' }, el('div', { class: 'gname', title: g.title }, g.title), el('div', { class: 'muted small' }, catName(g.cat).toLowerCase())))));
  more.replaceChildren(...(G.items.length < G.total ? [el('button', { class: 'btn', onclick: () => loadGames(false) }, `more (${G.total - G.items.length})`)] : []));
}
async function loadActivity(box) {
  if (!box.isConnected) return;
  try {
    const [now, recent, board] = await Promise.all([
      api('GET', '/api/activity/now', null, { quiet: true }), api('GET', '/api/activity/recent', null, { quiet: true }), api('GET', '/api/activity/leaderboard?range=' + G.range, null, { quiet: true })]);
    S.nowPlaying = now.now;
    const who = (u, sub, right) => el('div', { class: 'urow click', onclick: () => openProfile(u.username) }, avatar(u.displayName, 36, '', u.avatar), el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, u.displayName), el('div', { class: 'muted small' }, sub)), right);
    const none = (t) => el('div', { class: 'muted pad' }, t);
    const first = !box.firstChild;
    const grid = el('div', { class: 'act-grid' + (first ? ' stagger' : '') },
      el('section', { class: 'card', style: '--i:0' }, el('h3', null, ic('activity', 16), 'playing now'), now.now.length ? now.now.map((n) => who(n, n.title, el('span', { class: 'good small' }, fmtDur((Date.now() - new Date(n.since)) / 1000)))) : none('quiet right now')),
      el('section', { class: 'card', style: '--i:1' }, el('h3', null, ic('clock', 16), 'recent'), recent.recent.length ? recent.recent.slice(0, 12).map((r) => who(r, r.title, el('span', { class: 'muted small' }, r.live ? 'live' : fmtDur(r.seconds)))) : none('nothing yet')),
      el('section', { class: 'card', style: '--i:2' }, el('h3', null, ic('trophy', 16), 'top players'),
        board.players.length ? board.players.map((p) => who(p, `${p.games} games`, el('b', null, fmtDur(p.seconds)))) : none('no data')),
      el('section', { class: 'card', style: '--i:3' }, el('h3', null, ic('gamepad', 16), 'most played'),
        board.games.length ? board.games.map((g) => el('div', { class: 'urow click', onclick: () => openGame(g.path, g.title) }, el('div', { class: 'gshare-ic sm', style: `background:${tone(g.title)}` }, ic('gamepad', 16)), el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, g.title), el('div', { class: 'muted small' }, `${g.players} player${g.players === 1 ? '' : 's'}`)), el('b', null, fmtDur(g.seconds)))) : none('no data')));
    box.replaceChildren(grid);
  } catch (e) { box.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
}
function renderActivityLive() { if (S.view === 'games' && G.tab === 'activity') { clearTimeout(renderActivityLive.t); renderActivityLive.t = setTimeout(() => { const b = $('.gcontent'); if (b) loadActivity(b); }, 1200); } }

// ---------- game player ----------
let player = null;
function closePlayer() {
  if (!player) return;
  clearInterval(player.timer);
  window.__ext.coopStopHost && window.__ext.coopStopHost();
  player.node.remove();
  api('POST', '/api/activity/stop', null, { quiet: true, keepalive: true }).catch(() => {});
  player = null;
}
function openGame(path, title) {
  closePlayer();
  const url = API + '/g/' + path.split('/').map(encodeURIComponent).join('/');
  const frame = el('iframe', { class: 'gframe', src: url, allow: 'autoplay; fullscreen; gamepad; clipboard-write', referrerPolicy: 'no-referrer' });
  frame.setAttribute('sandbox', 'allow-scripts allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads allow-orientation-lock');
  const spin = el('div', { class: 'gload' }, el('div', { class: 'spinner' }), el('div', null, title));
  frame.addEventListener('load', () => spin.remove());
  const node = el('div', { class: 'player' },
    el('div', { class: 'player-bar' },
      el('button', { class: 'icon-btn', title: 'close', onclick: closePlayer }, ic('back', 22)),
      el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, title), el('div', { class: 'muted small' }, S.me.shareActivity ? 'friends can see this' : 'private')),
      el('button', { class: 'icon-btn', title: 'play together: a friend joins your game from far away', onclick: () => window.__ext.coopHostModal(path, title, frame) }, ic('users', 20)),
      el('button', { class: 'icon-btn', title: 'Share to a chat', onclick: () => shareGameModal(path, title) }, ic('share', 20)),
      el('button', { class: 'icon-btn', title: 'Fullscreen', onclick: () => { (frame.requestFullscreen || frame.webkitRequestFullscreen || (() => {})).call(frame); } }, ic('expand', 20)),
      el('a', { class: 'icon-btn', title: 'Open in a new tab', href: url, target: '_blank', rel: 'noopener' }, ic('external', 20)),
      el('button', { class: 'icon-btn', title: 'Close', onclick: closePlayer }, ic('x', 22))),
    el('div', { class: 'player-body' }, frame, spin));
  document.body.append(node);
  player = { node, frame, timer: null, playId: null };
  api('POST', '/api/activity/start', { path }, { quiet: true }).then((r) => {
    if (!player || player.node !== node) return api('POST', '/api/activity/stop', null, { quiet: true }).catch(() => {});
    player.playId = r.playId;
    player.timer = setInterval(() => api('POST', '/api/activity/ping', { playId: r.playId }, { quiet: true }).catch(() => {}), 25000);
  }).catch(() => {});
}
window.addEventListener('pagehide', () => { if (player && S.token) api('POST', '/api/activity/stop', null, { quiet: true, keepalive: true }).catch(() => {}); });
function shareGameModal(path, title) {
  const list = S.convs.map((c) => el('div', { class: 'urow click', onclick: async () => { m.close(); if (await sendPayload(c, { t: 'game', path, title })) toast('sent to ' + convTitle(c), 'success'); } }, avatar(convTitle(c), 34), el('div', { class: 'grow' }, convTitle(c)), ic('send', 16)));
  const m = modal('share to', el('div', { class: 'ulist tall' }, list.length ? list : [el('div', { class: 'muted pad' }, 'no chats yet')]));
  m.box.style.zIndex = 400;
}

window.__ui = { renderAll, renderRail, renderSide, renderHeader, renderMessages, renderTyping, renderActivityLive, notifyMessage, openConv, tickCooldown, boot: () => boot(), modal, confirmModal, userSearch, openProfile, statusFor, statusLine, isMobile, chatRef: () => chatRef, resetMain: () => { builtMain = ''; renderMain(); }, startDM, mugIcon, groupModal, removeMember, deleteWithUndo, myRank, rankR, linkify, goAdminTab: (k) => { S.adminTab = k; S.view = 'admin'; builtMain = ''; renderAll(); } };

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
})();

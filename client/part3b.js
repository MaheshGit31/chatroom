/* ===== Chatroom client: extras (discover, reports, invites, gifs, themes, reactions picker, pins, news) ===== */
(() => {
'use strict';
const C = window.__core, U = window.__ui;
const { S, el, $, ic, avatar, api, toast, debounce, lsGet, lsSet, ago, fmtDay, tone } = C;
const { modal, confirmModal } = U;
const copyText = (t) => (navigator.clipboard ? navigator.clipboard.writeText(t).then(() => toast('copied', 'success')).catch(() => toast('copy failed', 'error')) : toast('copy failed', 'error'));
const mug = () => U.mugIcon();

// ---------- changes board ----------
let news = null;
const seenNews = () => lsGet('chatroom.news') || '';
const newsUnseen = () => !!(news && news[0] && seenNews() && news[0].id !== seenNews());
async function announce() {
  try {
    const d = await api('GET', '/api/changelog', null, { quiet: true });
    news = d.entries || [];
    if (news[0] && !seenNews()) lsSet('chatroom.news', news[0].id);              // brand new people are not nagged about old news
    else if (newsUnseen()) toast("what's new: " + news[0].title, 'info', newsModal);
    U.renderRail();
  } catch {}
  api('GET', '/api/announcements', null, { quiet: true }).then((d) => { anns = d.announcements; renderTop(); }).catch(() => {});
  if (S.me && S.me.isAdmin) refreshReportCount();
}
async function newsModal() {
  if (!news) { try { news = (await api('GET', '/api/changelog', null, { quiet: true })).entries || []; } catch { news = []; } }
  const body = el('div', { class: 'news' }, news.length ? news.map((e, i) => el('section', { class: 'news-item', style: `--i:${i}` },
    el('div', { class: 'row between' }, el('h3', null, e.title), el('span', { class: 'muted small' }, e.date)),
    el('ul', null, e.items.map((t) => el('li', null, t))))) : el('div', { class: 'muted pad' }, 'nothing yet'));
  modal("what's new", body, { wide: true });
  if (news[0]) { lsSet('chatroom.news', news[0].id); U.renderRail(); }
}

// ---------- theme (beta) ----------
const PRESETS = {
  cocoa: null,
  midnight: { dark: ['#11151f', '#181e2c', '#212940', '#2e3855', '#e6ebf7', '#93a0bf'], light: ['#e9edf7', '#f6f8fd', '#dde3f1', '#c7cfe3', '#1d2536', '#5d6a86'] },
  forest: { dark: ['#121a15', '#1a251e', '#243228', '#34463a', '#e4efe5', '#92a898'], light: ['#e6eddf', '#f4f8ee', '#dce6d3', '#c4d3b8', '#22301f', '#5f7458'] },
  rose: { dark: ['#1d1416', '#281b1e', '#352328', '#4a3238', '#f6e6e8', '#b69aa0'], light: ['#f6e6e4', '#fdf3f1', '#f0d9d6', '#e2c3bf', '#3d2224', '#86605f'] },
  slate: { dark: ['#16181b', '#1f2226', '#2a2e33', '#3a3f46', '#ebedf0', '#9aa0a8'], light: ['#eceef0', '#f8f9fa', '#e0e3e6', '#cdd1d6', '#23272b', '#626a73'] },
};
const SWATCHES = ['#e5855a', '#d95f4a', '#e0a33a', '#8fae6a', '#4fa68a', '#4f8fd1', '#7a7bd6', '#b46cc4', '#d9648f', '#9aa0a8'];
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (r) => '#' + r.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = hex2rgb(a), y = hex2rgb(b); return rgb2hex(x.map((v, i) => v + (y[i] - v) * t)); };
const lum = (h) => { const [r, g, b] = hex2rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
const THEME_PROPS = ['--bg', '--panel', '--panel2', '--line', '--text', '--muted', '--accent', '--accent-d', '--accent-ink', '--mine', '--mine-ink', '--k', '--t-base', '--display'];
function applyTheme(draft) {
  const root = document.documentElement;
  THEME_PROPS.forEach((p) => root.style.removeProperty(p));
  const th = draft || (S.me && S.me.theme);
  if (!th || !C.betaActive()) return;
  const dark = isDark(), set = (k, v) => root.style.setProperty(k, v);
  const pre = PRESETS[th.preset];
  if (pre) { const v = pre[dark ? 'dark' : 'light']; ['--bg', '--panel', '--panel2', '--line', '--text', '--muted'].forEach((k, i) => set(k, v[i])); }
  if (th.accent) {
    const a = th.accent, ink = lum(a) > 0.4 ? '#1d120a' : '#fff8ee';
    set('--accent', a); set('--accent-ink', ink); set('--accent-d', mix(a, '#000000', 0.15));
    set('--mine', dark ? mix(a, '#000000', 0.25) : a); set('--mine-ink', lum(dark ? mix(a, '#000000', 0.25) : a) > 0.4 ? '#1d120a' : '#fff8ee');
  }
  set('--k', { sharp: 0.35, soft: 1, round: 1.6 }[th.round] || 1);
  set('--t-base', { small: '14px', normal: '15.5px', large: '17.5px' }[th.size] || '15.5px');
  if (th.font === 'sans') set('--display', 'var(--body)');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
function lockedBox(what) {
  if (!S.me.verified) return el('div', { class: 'locked' }, ic('verified', 28), el('h3', null, what + ' needs a verified account'), el('p', { class: 'muted' }, 'verify first, then beta unlocks'), el('button', { class: 'btn primary', onclick: () => { document.querySelectorAll('.modal-back').forEach((n) => n.querySelector('.modal-head button') && n.querySelector('.modal-head button').click()); verifyModal(); } }, ic('verified', 16), 'verify me'));
  return el('div', { class: 'locked' }, ic('star', 28), el('h3', null, what + ' is in beta'),
    el('p', { class: 'muted' }, 'invite friends to earn beta time'),
    el('button', { class: 'btn primary', onclick: () => { document.querySelectorAll('.modal-back').forEach((n) => n.querySelector('.modal-head button') && n.querySelector('.modal-head button').click()); inviteModal(); } }, ic('gift', 16), 'invite friends'));
}
function themeModal() {
  const body = el('div');
  const m = modal('custom theme', body, { onClose: () => applyTheme() });
  if (!C.betaActive()) { body.append(lockedBox('themes')); return; }
  let th = { accent: null, preset: 'cocoa', round: 'soft', size: 'normal', font: 'serif', ...(S.me.theme || {}) };
  const draw = () => {
    applyTheme(th);                                          // live preview
    const opt = (key, val, label) => el('button', { class: th[key] === val ? 'on' : '', onclick: () => { th[key] = val; draw(); } }, label);
    const color = el('input', { type: 'color', value: th.accent || '#e5855a', class: 'colorin', oninput: (e) => { th.accent = e.target.value; applyTheme(th); } });
    color.addEventListener('change', draw);
    body.replaceChildren(
      el('h4', null, 'accent'),
      el('div', { class: 'swatches' }, SWATCHES.map((c) => el('button', { class: 'sw' + (th.accent === c ? ' on' : ''), style: `background:${c}`, title: c, onclick: () => { th.accent = c; draw(); } })), color),
      el('h4', null, 'paper'),
      el('div', { class: 'seg small wrapseg' }, Object.keys(PRESETS).map((k) => opt('preset', k, k))),
      el('h4', null, 'corners'),
      el('div', { class: 'seg small' }, opt('round', 'sharp', 'sharp'), opt('round', 'soft', 'soft'), opt('round', 'round', 'round')),
      el('h4', null, 'text'),
      el('div', { class: 'row gap' }, el('div', { class: 'seg small' }, opt('size', 'small', 'small'), opt('size', 'normal', 'normal'), opt('size', 'large', 'large')), el('div', { class: 'seg small' }, opt('font', 'serif', 'serif'), opt('font', 'sans', 'sans'))),
      el('div', { class: 'row gap end', style: 'margin-top:20px' },
        el('button', { class: 'btn ghost', onclick: async () => { try { await api('DELETE', '/api/me/theme'); S.me.theme = null; applyTheme(); m.close(); toast('theme reset', 'success'); } catch (e) { toast(e.message, 'error'); } } }, 'reset'),
        el('button', { class: 'btn primary', onclick: async () => { try { const d = await api('PUT', '/api/me/theme', th); S.me.theme = d.theme; applyTheme(); m.close(); toast('theme saved', 'success'); } catch (e) { toast(e.message, 'error'); } } }, 'save')));
  };
  draw();
}

// ---------- invites + beta ----------
async function inviteModal() {
  const body = el('div', null, el('div', { class: 'muted pad' }, '...'));
  modal('invite friends', body);
  try {
    const r = S.referral && S.referral.code ? S.referral : await api('GET', '/api/referral');
    S.referral = r;
    const link = `${C.API}/?ref=${r.code}`;
    const field = (v) => el('div', { class: 'copyrow' }, el('input', { value: v, readOnly: true, onfocus: (e) => e.target.select() }), el('button', { class: 'btn', onclick: () => copyText(v) }, ic('copy', 16), 'copy'));
    const active = C.betaActive();
    const left = S.me.isAdmin ? 'always on' : active ? 'until ' + new Date(S.me.betaUntil).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'off';
    body.replaceChildren(
      !S.me.verified ? el('div', { class: 'betacard' }, ic('verified', 20), el('div', { class: 'grow' }, el('b', null, 'verify to use beta'), el('div', { class: 'muted small' }, 'friends still earn you time, it switches on once you are verified')), el('button', { class: 'btn small primary', onclick: () => verifyModal() }, 'verify')) : null,
      el('div', { class: 'betacard' + (active ? ' on' : '') }, ic('star', 20), el('div', { class: 'grow' }, el('b', null, 'beta ' + (active ? 'active' : 'off')), el('div', { class: 'muted small' }, left))),
      el('h4', null, 'your link'), field(link),
      el('h4', null, 'your code'), field(r.code),
      el('div', { class: 'stats' }, el('div', null, el('b', null, r.referred), el('span', null, 'joined')), el('div', null, el('b', null, r.credited), el('span', null, `earned (max ${r.cap})`)), el('div', null, el('b', null, r.minutes), el('span', null, 'min each'))),
      el('p', { class: 'muted small', style: 'margin-bottom:0' }, 'a friend counts once they join and send their first message'));
  } catch (e) { body.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
}
function betaModal(u, done) {
  const body = el('div');
  const m = modal('beta for ' + u.displayName, body);
  const give = async (minutes) => { try { await api('POST', `/api/admin/users/${u.id}/beta`, { minutes }); toast(minutes ? 'beta added' : 'beta cleared', 'success'); m.close(); done && done(); } catch (e) { toast(e.message, 'error'); } };
  body.append(el('p', { class: 'muted', style: 'margin-top:0' }, u.isAdmin ? 'admins always have beta' : u.beta ? 'on until ' + new Date(u.betaUntil).toLocaleString() : 'off right now'),
    el('div', { class: 'presets' }, [[30, '+30 min'], [60, '+1 hour'], [1440, '+1 day'], [10080, '+1 week']].map(([v, l]) => el('button', { class: 'chip-b', onclick: () => give(v) }, l))),
    el('button', { class: 'btn danger small', onclick: () => give(0) }, 'clear beta'));
}

// ---------- emoji picker + shortcode suggestions ----------
let pop = null;
const closePop = () => { if (pop) { pop.remove(); pop = null; } };
document.addEventListener('mousedown', (e) => { if (pop && !pop.contains(e.target) && !e.target.closest('[data-emopop]')) closePop(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
function emojiPicker(anchor, onPick, closeOnPick) {
  closePop();
  anchor.dataset.emopop = 1;
  const grid = el('div', { class: 'emogrid' });
  const search = el('input', { placeholder: 'search emoji', autocomplete: 'off' });
  const draw = () => {
    const q = search.value.trim().toLowerCase().replace(/:/g, '');
    const list = C.EMOJI_LIST.filter(([n]) => !q || n.includes(q)).slice(0, 160);
    grid.replaceChildren(...(list.length ? list.map(([n, ch]) => el('button', { title: ':' + n + ':', onclick: () => { onPick(ch); if (closeOnPick) closePop(); } }, C.emojiEl(ch))) : [el('div', { class: 'muted pad' }, 'nothing')]));
  };
  search.addEventListener('input', draw);
  pop = el('div', { class: 'emopop' }, el('div', { class: 'emoquick' }, C.QUICK_REACTS.map((ch) => el('button', { onclick: () => { onPick(ch); if (closeOnPick) closePop(); } }, C.emojiEl(ch)))), el('div', { class: 'searchbox' }, ic('search', 14), search), grid);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  pop.style.top = (r.top - h - 8 > 8 ? r.top - h - 8 : Math.min(innerHeight - h - 8, r.bottom + 8)) + 'px';
  draw(); search.focus();
}
function suggest(input, box) {
  const pos = input.selectionStart ?? input.value.length;
  const m = input.value.slice(0, pos).match(/(^|\s):([a-z0-9_+-]{2,})$/i);
  if (!m) { box.classList.remove('on'); box._s = null; return; }
  const q = m[2].toLowerCase();
  const all = C.EMOJI_LIST.filter(([n]) => n.includes(q));
  const list = [...all.filter(([n]) => n.startsWith(q)), ...all.filter(([n]) => !n.startsWith(q))].slice(0, 6);
  if (!list.length) { box.classList.remove('on'); box._s = null; return; }
  box._s = { list, idx: 0, start: pos - q.length - 1, end: pos };
  drawSugg(input, box);
}
function drawSugg(input, box) {
  const s = box._s; if (!s) return;
  box.classList.add('on');
  box.replaceChildren(...s.list.map(([n, ch], i) => el('button', { class: i === s.idx ? 'on' : '', onmousedown: (e) => { e.preventDefault(); s.idx = i; pick(input, box); } }, C.emojiEl(ch), el('span', null, ':' + n + ':'))));
}
function pick(input, box) {
  const s = box._s; if (!s) return;
  const ch = s.list[s.idx][1];
  input.setRangeText(ch + ' ', s.start, s.end, 'end');
  box.classList.remove('on'); box._s = null;
  input.dispatchEvent(new Event('input')); input.focus();
}
function suggestKey(e, input, box) {
  const s = box._s; if (!s || !box.classList.contains('on')) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); s.idx = (s.idx + (e.key === 'ArrowDown' ? 1 : s.list.length - 1)) % s.list.length; drawSugg(input, box); return true; }
  if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); pick(input, box); return true; }
  if (e.key === 'Escape') { box.classList.remove('on'); return true; }
  return false;
}

// ---------- reactions + pins ----------
async function toggleReact(c, m, emoji, forceOn) {
  const mine = ((m.reactions || {})[emoji] || []).includes(S.me.id);
  if (forceOn && mine) return;
  try { await api('PUT', `/api/messages/${m.id}/reactions`, { emoji, on: forceOn ? true : !mine }, { quiet: true }); }
  catch (e) { if (e.data && e.data.error === 'verify_required') verifyModal(); else toast(e.status === 429 ? 'easy on the reactions' : e.message, 'error'); }
}
async function pinMessage(c, m) {
  try { await api('POST', `/api/messages/${m.id}/pin`, { on: !m.pinned }, { quiet: true }); }
  catch (e) { toast(e.message, 'error'); }
}
async function loadPins(c) {
  if (!c) return;
  try {
    const d = await api('GET', `/api/conversations/${c.id}/pins`, null, { quiet: true });
    await Promise.all(d.pins.map((p) => C.decryptMsg(c, p)));
    c.pinsList = d.pins; c._pinsAt = Date.now();
    renderPins(c);
  } catch {}
}
function renderPins(c) {
  const ref = U.chatRef(); const bar = ref && ref.pinbar;
  if (!bar || ref.convId !== c.id) return;
  const pins = (c.pinsList || []).filter((p) => !p.deleted);
  if (!pins.length) { bar.replaceChildren(); bar.classList.remove('on'); return; }
  const p = pins[0]._p || {};
  const text = p.t === 'text' ? p.text : p.t === 'gif' ? 'a gif' : p.t === 'game' ? p.title : 'pinned message';
  bar.classList.add('on');
  bar.replaceChildren(ic('pin', 14), el('span', { class: 'grow pintext' }, text), el('span', { class: 'muted small' }, pins.length > 1 ? pins.length + ' pins' : 'pinned'));
  bar.onclick = () => pinsModal(c);
}
U.renderPins = (c) => loadPins(c);                      // ws pin event: refetch, the cached list is stale
function pinsModal(c) {
  const body = el('div', { class: 'ulist tall' });
  const m = modal('pinned', body);
  const draw = () => {
    const pins = (c.pinsList || []).filter((p) => !p.deleted);
    if (!pins.length) return m.close();
    body.replaceChildren(...pins.map((x) => {
      const p = x._p || {}, sender = c.members.find((u) => u.id === x.senderId);
      return el('div', { class: 'urow pinrow' }, el('div', { class: 'grow' }, el('div', { class: 'muted small' }, (sender ? sender.displayName : 'someone') + ' · ' + fmtDay(x.createdAt).toLowerCase()),
        p.t === 'gif' ? C.gifOk(p.url) ? el('img', { class: 'gifimg sm', src: p.url, alt: 'gif' }) : 'gif' : el('div', { class: 'mtext' }, p.t === 'text' ? p.text : p.t === 'game' ? p.title : 'message')),
        (c.type === 'dm' || c.role === 'admin') ? el('button', { class: 'icon-btn', title: 'unpin', onclick: async () => { try { await api('POST', `/api/messages/${x.id}/pin`, { on: false }, { quiet: true }); c.pinsList = c.pinsList.filter((y) => y.id !== x.id); renderPins(c); draw(); } catch (e) { toast(e.message, 'error'); } } }, ic('x', 16)) : null);
    }));
  };
  draw();
}

// ---------- reports ----------
const REASON_LABELS = [['spam', 'spam'], ['harassment', 'harassment'], ['inappropriate', 'inappropriate'], ['impersonation', 'pretending to be someone'], ['other', 'something else']];
function reportModal(o) {
  let reason = '';
  const note = el('textarea', { rows: 3, maxLength: 400, placeholder: 'anything we should know (optional)' });
  const chips = el('div', { class: 'presets' });
  const drawChips = () => chips.replaceChildren(...REASON_LABELS.map(([k, l]) => el('button', { class: 'chip-b' + (reason === k ? ' on' : ''), onclick: () => { reason = k; drawChips(); } }, l)));
  const send = el('button', { class: 'btn primary', onclick: async () => {
    if (!reason) return toast('pick a reason', 'error');
    send.disabled = true;
    try {
      await api('POST', '/api/reports', { kind: o.kind, reason, note: note.value, msgId: o.msgId, convId: o.convId, username: o.username, snapshot: o.snapshot || '' }, { quiet: true });
      m.close(); toast('report sent, thanks', 'success');
    } catch (e) { toast(e.message, 'error'); send.disabled = false; }
  } }, ic('flag', 16), 'send report');
  const m = modal('report ' + (o.title || ''), el('div', null, chips, note,
    o.kind === 'message' ? el('p', { class: 'muted small' }, 'the text of this message is sent to the admins so they can read it') : null,
    el('div', { class: 'row end', style: 'margin-top:12px' }, send)));
  drawChips();
}
async function refreshReportCount() {
  try { const d = await api('GET', '/api/admin/reports', null, { quiet: true }); S.reportsOpen = d.reports.length; U.renderRail(); } catch {}
}
U.reportsChanged = refreshReportCount;
async function adminReports(box, refreshStats) {
  box.replaceChildren(el('div', { class: 'muted pad' }, '...'));
  try {
    const d = await api('GET', '/api/admin/reports', null, { quiet: true });
    S.reportsOpen = d.reports.length; U.renderRail();
    const act = async (fn, msg) => { try { await fn(); toast(msg, 'success'); adminReports(box, refreshStats); refreshStats && refreshStats(); } catch (e) { toast(e.message, 'error'); } };
    if (!d.reports.length) return box.replaceChildren(el('div', { class: 'empty-s' }, mug(), el('div', null, 'all clear')));
    box.replaceChildren(...d.reports.map((r, i) => el('div', { class: 'arow report', style: `--i:${Math.min(i, 12)}` },
      el('div', { class: 'grow' },
        el('div', { class: 'row gap-s', style: 'flex-wrap:wrap' }, el('span', { class: 'tag gold' }, r.kind), el('span', { class: 'tag' }, r.reason), el('b', null, r.kind === 'group' ? r.convName || 'group' : r.targetName || r.target || 'someone'), el('span', { class: 'muted small' }, `by @${r.reporter || '?'} · ${ago(r.createdAt)}`)),
        r.snapshot ? el('div', { class: 'quote' }, r.snapshot) : null,
        r.note ? el('div', { class: 'muted small', style: 'margin-top:4px' }, r.note) : null),
      el('div', { class: 'acts' },
        r.kind === 'group' && r.convId ? el('button', { class: 'icon-btn', title: 'remove group', onclick: async () => { if (await confirmModal('remove this group?', 'everyone is kicked out and it is deleted.', 'remove')) act(async () => { await api('DELETE', `/api/admin/groups/${r.convId}`); await api('POST', `/api/admin/reports/${r.id}`, { status: 'resolved' }); }, 'group removed'); } }, ic('trash', 18)) : null,
        r.targetId && r.kind !== 'group' && !r.targetBanned ? el('button', { class: 'icon-btn', title: 'suspend ' + (r.target || ''), onclick: async () => { if (await confirmModal(`suspend ${r.targetName || r.target}?`, 'they get signed out until restored.', 'suspend')) act(async () => { await api('POST', `/api/admin/users/${r.targetId}/ban`, { banned: true }); await api('POST', `/api/admin/reports/${r.id}`, { status: 'resolved' }); }, 'suspended'); } }, ic('ban', 18)) : null,
        el('button', { class: 'icon-btn', title: 'resolve', onclick: () => act(() => api('POST', `/api/admin/reports/${r.id}`, { status: 'resolved' }), 'resolved') }, ic('check', 18)),
        el('button', { class: 'icon-btn', title: 'dismiss', onclick: () => act(() => api('POST', `/api/admin/reports/${r.id}`, { status: 'dismissed' }), 'dismissed') }, ic('x', 18))))));
  } catch (e) { box.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
}

// ---------- discover (public groups) ----------
const D = { q: '', topic: '', groups: [], topics: [], loading: false };
async function loadDiscover(grid, chips) {
  D.loading = true;
  try {
    const d = await api('GET', `/api/public?q=${encodeURIComponent(D.q)}&topic=${encodeURIComponent(D.topic)}`, null, { quiet: true });
    D.groups = d.groups; D.topics = d.topics;
  } catch (e) { toast(e.status === 429 ? 'slow down a little' : e.message, 'error'); }
  D.loading = false; drawDiscover(grid, chips);
}
function drawDiscover(grid, chips) {
  if (!grid.isConnected) return;
  chips.replaceChildren(el('button', { class: 'chip-b' + (!D.topic ? ' on' : ''), onclick: () => { D.topic = ''; loadDiscover(grid, chips); } }, 'all'), ...D.topics.map((t) => el('button', { class: 'chip-b' + (D.topic === t ? ' on' : ''), onclick: () => { D.topic = t; loadDiscover(grid, chips); } }, t)));
  if (!D.groups.length) { grid.classList.remove('stagger'); grid.replaceChildren(el('div', { class: 'empty-s wide' }, mug(), el('div', null, D.loading ? '' : 'no rooms yet'), el('button', { class: 'btn small', onclick: createPublicModal }, 'host the first one'))); return; }
  grid.classList.add('stagger');
  grid.replaceChildren(...D.groups.map((g, i) => el('div', { class: 'room', style: `--i:${Math.min(i, 12)}` },
    el('div', { class: 'row gap' }, el('div', { class: 'avatar', style: `width:44px;height:44px;background:${tone(g.name)}` }, ic('globe', 20)),
      el('div', { class: 'grow' }, el('div', { class: 'roomname' }, g.name), el('div', { class: 'muted small' }, `${g.members} ${g.members === 1 ? 'person' : 'people'}`)), el('span', { class: 'tag' }, g.topic)),
    el('p', { class: 'roomdesc' }, g.description || ''),
    el('button', { class: 'btn ' + (g.joined ? '' : 'primary') + ' wide', onclick: (e) => joinPublic(g, e.currentTarget) }, g.joined ? 'open' : 'join'))));
}
async function joinPublic(g, btn) {
  try {
    if (!g.joined) {
      btn.disabled = true;
      const d = await api('POST', `/api/public/${g.id}/join`, {}, { quiet: true });
      Object.assign(S.keyUsers, d.keyUsers);
      const list = C.mergeConvs(d.conversations, false);
      await Promise.all(list.map(C.refreshPreview));
    }
    U.openConv(g.id);
  } catch (e) { toast(e.message, 'error'); if (btn) btn.disabled = false; }
}
function buildDiscover(m) {
  const grid = el('div', { class: 'rooms' }), chips = el('div', { class: 'cats' });
  const input = el('input', { placeholder: 'search rooms', value: D.q, oninput: debounce(() => { D.q = input.value; loadDiscover(grid, chips); }, 300) });
  m.append(el('div', { class: 'page' },
    el('div', { class: 'page-head' }, el('h2', null, 'public ', el('i', null, 'rooms')), el('button', { class: 'btn primary', onclick: createPublicModal }, ic('plus', 16), 'host a group')),
    el('div', { class: 'searchbox' }, ic('search', 16), input), chips, grid));
  drawDiscover(grid, chips); loadDiscover(grid, chips);
}
function topicPicker(get, set) {
  const row = el('div', { class: 'presets' });
  const draw = () => row.replaceChildren(...D.topics.concat(D.topics.length ? [] : ['chill', 'gaming', 'music', 'art', 'study', 'tech', 'memes', 'other']).map((t) => el('button', { class: 'chip-b' + (get() === t ? ' on' : ''), onclick: () => { set(t); draw(); } }, t)));
  draw(); return row;
}
function createPublicModal() {
  let topic = 'chill';
  const name = el('input', { placeholder: 'group name', maxLength: 40 });
  const desc = el('input', { placeholder: 'what is it about', maxLength: 160 });
  const err = el('div', { class: 'form-err' });
  const go = el('button', { class: 'btn primary wide', onclick: async () => {
    go.disabled = true; err.textContent = '';
    try {
      const d = await api('POST', '/api/conversations/public', { name: name.value, description: desc.value, topic }, { quiet: true });
      Object.assign(S.keyUsers, d.keyUsers); C.mergeConvs(d.conversations, false);
      m.close(); U.openConv(d.convId);
    } catch (e) { err.textContent = e.message; go.disabled = false; }
  } }, 'create');
  const m = modal('host a group', el('div', null, name, el('div', { style: 'height:8px' }), desc, topicPicker(() => topic, (t) => { topic = t; }), el('p', { class: 'muted small', style: 'margin-top:0' }, 'public rooms are open to everyone and are not end-to-end encrypted'), err, go));
  name.focus();
}
function editPublic(c, done) {
  let topic = c.topic || 'other';
  const desc = el('input', { value: c.description || '', maxLength: 160, placeholder: 'what is it about' });
  const go = el('button', { class: 'btn primary wide', onclick: async () => { try { await api('PATCH', `/api/conversations/${c.id}/about`, { description: desc.value, topic }, { quiet: true }); c.description = desc.value.trim(); c.topic = topic; m.close(); done && done(); } catch (e) { toast(e.message, 'error'); } } }, 'save');
  const m = modal('about this group', el('div', null, desc, topicPicker(() => topic, (t) => { topic = t; }), go));
}

// ---------- gifs (beta) ----------
function gifBody(p) {
  if (!C.gifOk(p.url)) return el('div', { class: 'mtext muted-i' }, 'gif blocked');
  const img = el('img', { class: 'gifimg', src: p.url, alt: p.title || 'gif', title: p.title || '', loading: 'lazy', referrerPolicy: 'no-referrer' });
  img.onerror = () => img.replaceWith(el('div', { class: 'mtext muted-i' }, 'gif unavailable'));
  return img;
}
async function gifModal(c) {
  const body = el('div');
  const m = modal('gif', body, { wide: true });
  if (!C.betaActive()) { body.append(lockedBox('gifs')); return; }
  let searchOn = false, tab = 'search';
  try { searchOn = (await api('GET', '/api/gifs/status', null, { quiet: true })).search; } catch {}
  if (!searchOn) tab = 'link';
  const content = el('div');
  const send = async (url, title) => { if (await C.sendPayload(c, { t: 'gif', url, title: title || '' })) m.close(); };
  const grid = el('div', { class: 'gifgrid' });
  const q = el('input', { placeholder: 'search gifs' });
  const runSearch = async () => {
    grid.replaceChildren(el('div', { class: 'muted pad' }, '...'));
    try {
      const d = await api('GET', '/api/gifs/search?q=' + encodeURIComponent(q.value.trim()), null, { quiet: true });
      grid.replaceChildren(...(d.gifs.length ? d.gifs.map((g) => el('button', { class: 'gifcell', title: g.title, onclick: () => send(g.url, g.title) }, el('img', { src: g.preview, alt: g.title || 'gif', loading: 'lazy', referrerPolicy: 'no-referrer' }))) : [el('div', { class: 'muted pad' }, 'nothing found')]));
    } catch (e) { grid.replaceChildren(el('div', { class: 'muted pad' }, e.message)); }
  };
  q.addEventListener('input', debounce(runSearch, 400));
  const link = el('input', { placeholder: 'paste a gif link (tenor, giphy, klipy, imgur)' });
  const prev = el('div', { class: 'gifprev' });
  const find = el('button', { class: 'btn', onclick: async () => {
    prev.replaceChildren(el('div', { class: 'muted pad' }, '...'));
    try {
      const d = await api('GET', '/api/gifs/resolve?url=' + encodeURIComponent(link.value.trim()), null, { quiet: true });
      prev.replaceChildren(el('img', { class: 'gifimg', src: d.url, alt: 'gif', referrerPolicy: 'no-referrer' }), el('button', { class: 'btn primary', onclick: () => send(d.url, '') }, ic('send', 16), 'send'));
    } catch (e) { prev.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
  } }, 'find');
  const draw = () => {
    content.replaceChildren(tab === 'search' ? el('div', null, el('div', { class: 'searchbox' }, ic('search', 16), q), grid) : el('div', null, el('div', { class: 'row gap' }, link, find), prev));
    if (tab === 'search') { q.focus(); if (!grid.firstChild) runSearch(); } else link.focus();
  };
  body.append(searchOn ? el('div', { class: 'seg' }, el('button', { class: tab === 'search' ? 'on' : '', onclick: (e) => { tab = 'search'; e.currentTarget.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); draw(); } }, ic('search', 14), 'search'), el('button', { class: tab === 'link' ? 'on' : '', onclick: (e) => { tab = 'link'; e.currentTarget.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); draw(); } }, ic('link', 14), 'link')) : null, content);
  draw();
}

// ---------- top bar: announcements, verify nudge, invite + beta pill ----------
let anns = [];
const dismissedAnn = () => { try { return JSON.parse(lsGet('chatroom.ann') || '[]'); } catch { return []; } };
function betaLeft() {                                        // short text for the pill
  if (S.me.isAdmin) return 'beta on';
  if (!C.betaActive()) return null;
  const ms = new Date(S.me.betaUntil) - Date.now();
  const m = Math.max(1, Math.ceil(ms / 60000));
  return 'beta ' + (m >= 1440 ? Math.floor(m / 1440) + 'd' : m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm') + ' left';
}
function renderTop() {
  const bar = $('#topbar'); if (!bar || !S.me) return;
  const cur = anns.find((a) => !dismissedAnn().includes(a.id));
  const left = cur
    ? el('div', { class: 'annbar' }, ic('megaphone', 16), el('div', { class: 'anntext' }, el('b', null, cur.title)),
      el('button', { class: 'btn small', onclick: () => annModal(cur) }, 'read'),
      cur.buttonUrl ? el('a', { class: 'btn small primary', href: cur.buttonUrl, target: '_blank', rel: 'noopener noreferrer' }, cur.buttonLabel || 'open') : null,
      el('button', { class: 'icon-btn tiny', title: 'close', onclick: () => { lsSet('chatroom.ann', JSON.stringify([...dismissedAnn(), cur.id].slice(-30))); renderTop(); } }, ic('x', 14)))
    : el('div', { class: 'grow' });
  const bl = betaLeft();
  const free = Math.max(0, (S.me.freeMessages || 20) - (S.me.msgCount || 0));
  bar.replaceChildren(left,
    !S.me.verified ? el('button', { class: 'pill warn', title: 'verify your account', onclick: verifyModal }, ic('verified', 15), el('span', null, free ? `verify · ${free} free left` : 'verify to chat')) : null,
    el('button', { class: 'pill' + (bl ? ' on' : ''), title: 'invite friends, earn beta time', onclick: inviteModal }, ic(bl ? 'star' : 'gift', 15), el('span', null, bl || 'invite · +30m beta')));
  const r = U.chatRef(); if (r && r.freebar) drawFree(r.freebar);
  watermark();
}
function drawFree(box) {                                     // small reminder above the composer while unverified
  if (S.me.verified) { box.classList.remove('on'); box.replaceChildren(); return; }
  const free = Math.max(0, (S.me.freeMessages || 20) - (S.me.msgCount || 0));
  box.classList.add('on');
  box.replaceChildren(ic('verified', 14), el('span', { class: 'grow' }, free ? `${free} free messages left` : 'you are out of free messages'), el('button', { class: 'btn small primary', onclick: verifyModal }, 'verify'));
}
setInterval(() => { if (S.me) renderTop(); }, 30000);        // keeps the beta countdown fresh
function onAnnounce(a) { anns = [a, ...anns.filter((x) => x.id !== a.id)]; renderTop(); }
function endAnnounce(id) { anns = anns.filter((x) => x.id !== id); renderTop(); }
function annModal(a) {
  modal(a.title, el('div', null, el('div', { class: 'annbody' }, C.F.clean(a.body || '')),
    a.buttonUrl ? el('div', { class: 'row end', style: 'margin-top:16px' }, el('a', { class: 'btn primary', href: a.buttonUrl, target: '_blank', rel: 'noopener noreferrer' }, a.buttonLabel || 'open')) : null));
}

// ---------- verification ----------
async function verifyModal() {
  const body = el('div', null, el('div', { class: 'muted pad' }, '...'));
  const m = modal('verify your account', body);
  let st = null;
  try { st = await api('GET', '/api/verify/status', null, { quiet: true }); } catch (e) { return body.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
  if (st.verified) { S.me.verified = true; return body.replaceChildren(el('div', { class: 'locked' }, ic('verified', 34), el('h3', null, 'you are verified'), el('p', { class: 'muted' }, 'the blue tick shows next to your name'))); }
  if (st.last && st.last.status === 'pending') return body.replaceChildren(el('div', { class: 'locked' }, ic('timer', 30), el('h3', null, 'waiting for review'), el('p', { class: 'muted' }, 'an admin will look at it soon. your photo is deleted as soon as they decide.')));
  let dataUrl = '';
  const prev = el('div', { class: 'idprev' });
  const send = el('button', { class: 'btn primary wide', disabled: true, onclick: async () => {
    send.disabled = true;
    try { await api('POST', '/api/verify', { image: dataUrl }, { quiet: true }); toast('sent for review', 'success'); m.close(); }
    catch (e) { toast(e.message, 'error'); send.disabled = false; }
  } }, ic('send', 16), 'send for review');
  const file = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none', onchange: async () => {
    const f = file.files && file.files[0]; if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      let w = bmp.width, h = bmp.height; const k = Math.min(1, 1100 / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
      let q = 0.78; dataUrl = cv.toDataURL('image/jpeg', q);
      while (dataUrl.length > 700_000 && q > 0.3) { q -= 0.1; dataUrl = cv.toDataURL('image/jpeg', q); }   // keep it small
      prev.replaceChildren(el('img', { src: dataUrl, alt: 'your photo' })); send.disabled = false;
    } catch { toast('could not read that photo', 'error'); }
  } });
  body.replaceChildren(
    st.last && st.last.status === 'rejected' ? el('div', { class: 'form-err' }, 'last try was not approved' + (st.last.note ? ': ' + st.last.note : '')) : null,
    el('p', { style: 'margin-top:0' }, 'take a photo of your school or bus pass so an admin can check you are real.'),
    el('ul', { class: 'tips' }, el('li', null, 'show your name and photo'), el('li', null, 'cover your id number, birthday and address'), el('li', null, 'an admin looks at it, then the photo is deleted for good')),
    el('p', { class: 'muted small' }, `unverified accounts get ${st.freeMessages} messages (${st.used} used), no reactions and no beta. verified accounts get a blue tick.`),
    prev, file,
    el('div', { class: 'row gap', style: 'margin:12px 0' }, el('button', { class: 'btn grow', onclick: () => file.click() }, ic('camera', 16), 'choose or take a photo')),
    send);
}

// ---------- badges ----------
async function badgesModal() {
  const body = el('div', null, el('div', { class: 'muted pad' }, '...'));
  modal('badges', body, { wide: true });
  try {
    const d = await api('GET', '/api/badges/mine', null, { quiet: true });
    body.replaceChildren(el('div', { class: 'badgegrid' }, d.badges.map((b, i) => el('div', { class: 'badgecard' + (b.earned ? ' on' : ''), style: `--i:${i}` },
      el('div', { class: 'bicon' }, ic(b.icon, 24)), el('b', null, b.name), el('span', { class: 'muted small' }, b.desc),
      b.earned ? el('span', { class: 'tag gold' }, 'earned') : el('div', { class: 'bar' }, el('i', { style: `width:${Math.round(b.progress / b.target * 100)}%` })),
      !b.earned ? el('span', { class: 'muted small' }, `${b.progress} / ${b.target}`) : null))));
  } catch (e) { body.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
}

// ---------- admin: verification queue + announcements ----------
async function adminVerify(box, reload) {
  box.replaceChildren(el('div', { class: 'muted pad' }, '...'));
  try {
    const d = await api('GET', '/api/admin/verifications', null, { quiet: true });
    if (!d.items.length) return box.replaceChildren(el('div', { class: 'empty-s' }, mug(), el('div', null, 'nobody waiting')));
    box.replaceChildren(...d.items.map((v, i) => el('div', { class: 'arow', style: `--i:${Math.min(i, 12)}` },
      avatar(v.displayName, 40), el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, v.displayName), el('div', { class: 'muted small' }, `@${v.username} · ${v.messages} msgs · ${ago(v.createdAt)}`)),
      el('button', { class: 'btn small primary', onclick: () => reviewModal(v, () => { adminVerify(box, reload); reload && reload(); }) }, 'review'))));
  } catch (e) { box.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
}
async function reviewModal(v, done) {
  const body = el('div', null, el('div', { class: 'muted pad' }, '...'));
  let url = '';
  const m = modal(v.displayName + ' (@' + v.username + ')', body, { wide: true, onClose: () => { if (url) URL.revokeObjectURL(url); } });
  try {
    const r = await fetch(`${C.API}/api/admin/verifications/${v.id}/image`, { headers: { Authorization: 'Bearer ' + S.token } });
    if (!r.ok) throw new Error('that one is already handled');
    url = URL.createObjectURL(await r.blob());
  } catch (e) { return body.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
  let note = '';
  const reasons = ['photo unclear', 'name does not match', 'not an id'];
  const chips = el('div', { class: 'presets' }, reasons.map((t) => el('button', { class: 'chip-b', onclick: (e) => { note = note === t ? '' : t; chips.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.textContent === note)); } }, t)));
  const decide = async (approve) => {
    try { await api('POST', `/api/admin/verifications/${v.id}`, { approve, note: approve ? '' : note }, { quiet: true }); toast(approve ? 'verified' : 'rejected', 'success'); m.close(); done && done(); }
    catch (e) { toast(e.message, 'error'); }
  };
  body.replaceChildren(el('img', { class: 'idimg', src: url, alt: 'id photo' }), el('p', { class: 'muted small' }, 'the photo is deleted the moment you decide'),
    el('h4', null, 'if rejecting'), chips,
    el('div', { class: 'row gap end', style: 'margin-top:14px' }, el('button', { class: 'btn danger', onclick: () => decide(false) }, ic('x', 16), 'reject'), el('button', { class: 'btn primary', onclick: () => decide(true) }, ic('verified', 16), 'approve')));
}
async function adminAnnounce(box) {
  const title = el('input', { placeholder: 'title', maxLength: 80 });
  const text = el('textarea', { rows: 4, maxLength: 1000, placeholder: 'the full message' });
  const label = el('input', { placeholder: 'button name (optional)', maxLength: 24 });
  const link = el('input', { placeholder: 'button link, https://... (optional)', maxLength: 300 });
  const past = el('div', { class: 'ulist tall', style: 'margin-top:14px' });
  const send = el('button', { class: 'btn primary', onclick: async () => {
    send.disabled = true;
    try { await api('POST', '/api/admin/announcements', { title: title.value, body: text.value, buttonLabel: label.value, buttonUrl: link.value }, { quiet: true }); toast('sent to everyone', 'success'); title.value = text.value = label.value = link.value = ''; loadPast(); }
    catch (e) { toast(e.message, 'error'); }
    send.disabled = false;
  } }, ic('megaphone', 16), 'send to everyone');
  async function loadPast() {
    try {
      const d = await api('GET', '/api/admin/announcements', null, { quiet: true });
      past.replaceChildren(...d.announcements.map((a) => el('div', { class: 'arow' + (a.active ? '' : ' banned') }, el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, a.title), el('div', { class: 'muted small' }, ago(a.createdAt) + (a.active ? '' : ' · ended'))),
        a.active ? el('button', { class: 'btn small', onclick: async () => { try { await api('DELETE', `/api/admin/announcements/${a.id}`); loadPast(); } catch (e) { toast(e.message, 'error'); } } }, 'end') : null)));
    } catch {}
  }
  box.replaceChildren(el('div', { class: 'annform' }, title, text, el('div', { class: 'row gap' }, label, link), el('div', { class: 'row end' }, send)), el('h4', null, 'recent'), past);
  loadPast();
}

// ---------- anti-surveillance (a deterrent: a website cannot truly stop screenshots or recording) ----------
const root = document.documentElement;
let shieldT = 0;
function hide() { clearTimeout(shieldT); root.classList.add('shielded'); }
function show(ms = 0) { clearTimeout(shieldT); shieldT = setTimeout(() => { const inFrame = document.activeElement && document.activeElement.tagName === 'IFRAME'; if (document.hidden || (!document.hasFocus() && !inFrame)) return; root.classList.remove('shielded'); }, ms); }
window.addEventListener('blur', () => setTimeout(() => { if (document.activeElement && document.activeElement.tagName === 'IFRAME') return; hide(); }, 0));   // switched window or snipping tool opened, but not when playing a game
window.addEventListener('focus', () => show(200));
document.addEventListener('visibilitychange', () => (document.hidden ? hide() : show(200)));
window.addEventListener('beforeprint', hide); window.addEventListener('afterprint', () => show(200));
document.addEventListener('contextmenu', (e) => { if (!/INPUT|TEXTAREA/.test(e.target.tagName)) e.preventDefault(); });
document.addEventListener('dragstart', (e) => e.preventDefault());
const clip = () => { try { navigator.clipboard.writeText('chatroom is private'); } catch {} };   // overwrite whatever a screenshot key put there
function capKey(e) {
  const k = e.key, meta = e.metaKey || e.ctrlKey;
  const snip = k === 'PrintScreen' || (e.shiftKey && (e.metaKey) && ['3', '4', '5', 's', 'S'].includes(k)) || (e.shiftKey && e.getModifierState && e.getModifierState('OS') && /^s$/i.test(k)) || (meta && /^[ps]$/i.test(k) && !/INPUT|TEXTAREA/.test(document.activeElement ? document.activeElement.tagName : ''));
  if (snip) { hide(); clip(); if (k === 'PrintScreen') e.preventDefault(); show(2500); }
}
window.addEventListener('keydown', capKey, true); window.addEventListener('keyup', capKey, true);
let wmUser = '';
function watermark() {                                       // faint name tiled over everything, so a leaked screenshot points back to its owner
  let w = document.getElementById('wm');
  if (!S.me) { if (w) w.style.display = 'none'; return; }
  if (!w) { w = el('div', { id: 'wm' }); document.body.append(w); }
  w.style.display = '';
  if (wmUser === S.me.username) return; wmUser = S.me.username;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='260' height='170'><text x='20' y='110' transform='rotate(-24 130 85)' font-family='sans-serif' font-size='15' fill='%23888' fill-opacity='.12'>@${S.me.username}</text></svg>`;
  w.style.backgroundImage = `url("data:image/svg+xml;utf8,${svg.replace(/#/g, '%23')}")`;
}

window.__ext = { renderTop, onAnnounce, endAnnounce, verifyModal, badgesModal, adminVerify, adminAnnounce, newsUnseen, announce, newsModal, applyTheme, themeModal, inviteModal, betaModal, emojiPicker, suggest, suggestKey, toggleReact, pinMessage, loadPins, reportModal, adminReports, buildDiscover, createPublicModal, editPublic, gifModal, gifBody };
try { const r = new URLSearchParams(location.search).get('ref'); if (r) { lsSet('chatroom.ref', r.slice(0, 16)); history.replaceState(null, '', location.pathname); } } catch {}
U.boot();                                                    // everything is defined, start the app
})();

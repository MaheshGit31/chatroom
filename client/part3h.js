(() => {
'use strict';
const C = window.__core, U = window.__ui, X = window.__ext;
const { S, el, ic, toast, convOf, convTitle, memberOf, sendPayload, api, avatar, previewText } = C;
const { modal } = U;

const FRAMES = [['none', 'none'], ['gold', 'gold'], ['neon', 'neon'], ['sunset', 'sunset'], ['ocean', 'ocean'], ['rose', 'rose']];
const nameRow = (u, sub, right) => el('div', { class: 'urow click', onclick: () => U.openProfile(u.username) }, avatar(u.displayName, 34, '', u.avatar), el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, u.displayName), sub ? el('div', { class: 'muted small' }, sub) : null), right);

function dailyBuild(box) {
  const rowsBox = el('div', { class: 'dgrid' });
  const info = el('div', { class: 'muted small' });
  const top = el('div', { class: 'card' });
  const input = el('input', { placeholder: 'type a 5 letter word', maxLength: 5, autocapitalize: 'off', autocomplete: 'off', spellcheck: false });
  const go = el('button', { class: 'btn primary', onclick: () => submit() }, ic('send', 16), 'guess');
  const form = el('div', { class: 'row gap' }, input, go);
  const result = el('div', null);
  let st = null;
  function draw() {
    if (!st) return;
    const cells = [];
    for (let r = 0; r < st.tries; r++) {
      const row = st.rows[r];
      cells.push(el('div', { class: 'drow' }, [0, 1, 2, 3, 4].map((i) => el('div', { class: 'dcell' + (row ? ' d' + row.fb[i] : '') }, row ? row.word[i].toUpperCase() : ''))));
    }
    rowsBox.replaceChildren(...cells);
    info.replaceChildren(ic('flame', 14), ' streak ' + st.streak + (st.streak === 1 ? ' day' : ' days') + ' · same word for everyone, resets at midnight utc');
    form.style.display = st.done ? 'none' : '';
    if (st.done) {
      const grid = st.rows.map((r) => r.fb.replace(/g/g, '\u{1F7E9}').replace(/y/g, '\u{1F7E8}').replace(/x/g, '⬛')).join('\n');
      result.replaceChildren(el('div', { class: 'dres ' + (st.won ? 'win' : 'lose') }, st.won ? `got it in ${st.rows.length}` : `it was ${st.answer.toUpperCase()}`),
        el('button', { class: 'btn small', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(`chatroom word ${st.day}  ${st.won ? st.rows.length : 'X'}/${st.tries}\n${grid}`).then(() => toast('copied', 'success')).catch(() => {}); } }, ic('copy', 14), 'copy result'));
    } else result.replaceChildren();
  }
  async function loadTop() {
    try {
      const d = await api('GET', '/api/daily/top', null, { quiet: true });
      top.replaceChildren(el('h3', null, ic('trophy', 16), "today's top 10"), d.top.length ? d.top.map((u, i) => nameRow(u, null, el('b', null, u.tries + '/6'))) : el('div', { class: 'muted pad' }, 'nobody has solved it yet'));
    } catch {}
  }
  async function submit() {
    const w = input.value.trim().toLowerCase();
    if (w.length !== 5) return toast('five letters', 'error');
    go.disabled = true;
    try { st = await api('POST', '/api/daily/guess', { word: w }); input.value = ''; draw(); if (st.done) loadTop(); } catch (e) { toast(e.message, 'error'); }
    go.disabled = false;
    input.focus();
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  box.replaceChildren(el('div', { class: 'daily' }, el('h3', null, ic('sparkle', 16), 'word of the day'), info, rowsBox, form, result), top);
  api('GET', '/api/daily', null, { quiet: true }).then((d) => { st = d; draw(); if (d.done) loadTop(); else loadTop(); }).catch((e) => box.replaceChildren(el('div', { class: 'form-err' }, e.message)));
}

const BOARDS = [['wins', 'game wins', 'last 30 days, 2 player games'], ['streak', 'streaks', 'daily word streaks'], ['reacts', 'reactions', 'reactions you got, last 7 days'], ['memes', 'meme of the week', 'most reacted memes in public rooms']];
let boardKind = 'wins';
function boardsBuild(box) {
  const body = el('div', { class: 'card' });
  const seg = el('div', { class: 'seg small' });
  const paintSeg = () => seg.replaceChildren(...BOARDS.map(([k, l]) => el('button', { class: boardKind === k ? 'on' : '', onclick: () => { boardKind = k; paintSeg(); load(); } }, l)));
  async function load() {
    const meta = BOARDS.find((b) => b[0] === boardKind);
    body.replaceChildren(el('div', { class: 'muted pad' }, '...'));
    try {
      const d = await api('GET', '/api/boards/' + boardKind, null, { quiet: true });
      if (boardKind === 'memes') {
        body.replaceChildren(el('h3', null, ic('trophy', 16), meta[1]), el('div', { class: 'muted small' }, meta[2] + '. react to a meme in the room to vote'),
          d.rows.length ? d.rows.map((r, i) => el('div', { class: 'mwk' },
            el('div', { class: 'row gap' }, el('b', null, '#' + (i + 1)), el('span', { class: 'grow muted small' }, 'by ' + r.displayName + ' in ' + r.convName), el('b', null, r.votes + ' votes')),
            X.memeBody(null, null, r.meme),
            S.convs.some((c) => c.id === r.convId) ? el('button', { class: 'btn small', onclick: () => { S.view = 'chats'; U.openConv(r.convId); } }, ic('chat', 14), 'open room') : null)) : el('div', { class: 'muted pad' }, 'no memes with votes yet, send one with /meme'));
      } else {
        body.replaceChildren(el('h3', null, ic('trophy', 16), meta[1]), el('div', { class: 'muted small' }, meta[2]),
          d.rows.length ? d.rows.map((u, i) => nameRow(u, null, el('b', null, '#' + (i + 1) + '  ' + u.value + ' ' + u.label))) : el('div', { class: 'muted pad' }, 'nothing here yet'));
      }
    } catch (e) { body.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
  }
  paintSeg();
  box.replaceChildren(seg, body);
  load();
}

async function profileEditModal() {
  let d;
  try { d = await api('GET', '/api/me/profile-extra'); } catch (e) { return toast(e.message, 'error'); }
  const st = { accent: d.accent || '#c9503e', hasAccent: !!d.accent, frame: d.frame || 'none', game: d.game, gameTitle: '', friends: [...d.friends] };
  const color = el('input', { type: 'color', value: st.accent, oninput: () => { st.accent = color.value; st.hasAccent = true; } });
  const frames = el('div', { class: 'seg small' });
  const paintFrames = () => frames.replaceChildren(...FRAMES.map(([k, l]) => el('button', { class: st.frame === k ? 'on' : '', onclick: () => { st.frame = k; paintFrames(); } }, l)));
  paintFrames();
  const gameLbl = el('div', { class: 'muted small' });
  const paintGame = () => { gameLbl.textContent = st.game ? 'pinned: ' + (st.gameTitle || st.game.split('/').pop().replace(/\.html?$/i, '')) : 'nothing pinned'; };
  paintGame();
  const gq = el('input', { placeholder: 'search a game to pin' });
  const gres = el('div', { class: 'ulist' });
  let t;
  gq.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      if (!gq.value.trim()) return gres.replaceChildren();
      try { const r = await api('GET', '/api/games?limit=6&q=' + encodeURIComponent(gq.value.trim()), null, { quiet: true }); gres.replaceChildren(...r.items.map((g) => el('div', { class: 'urow click', onclick: () => { st.game = g.id; st.gameTitle = g.title; paintGame(); gres.replaceChildren(); gq.value = ''; } }, el('div', { class: 'grow' }, g.title)))); } catch {}
    }, 300);
  });
  const url = el('input', { placeholder: 'https:// song or profile link (youtube, spotify, soundcloud...)', value: d.link ? d.link.url : '' });
  const label = el('input', { placeholder: 'label, like "my song rn"', maxLength: 40, value: d.link ? d.link.label : '' });
  const dms = S.convs.filter((c) => c.type === 'dm').map((c) => C.other(c)).filter((o) => o && !o.isBot);
  const fr = el('div', { class: 'chips-wrap' });
  const paintFr = () => fr.replaceChildren(...dms.map((o) => el('button', { class: 'chip-b' + (st.friends.includes(o.username) ? ' on' : ''), onclick: () => { const i = st.friends.indexOf(o.username); if (i >= 0) st.friends.splice(i, 1); else if (st.friends.length < 3) st.friends.push(o.username); else toast('top 3 only', 'error'); paintFr(); } }, o.displayName)));
  paintFr();
  const save = el('button', { class: 'btn primary wide', onclick: async () => {
    save.disabled = true;
    try {
      await api('PUT', '/api/me/profile-extra', { accent: st.hasAccent ? st.accent : '', frame: st.frame, game: st.game || '', linkUrl: url.value.trim(), linkLabel: label.value.trim(), friends: st.friends });
      toast('saved', 'success'); m.close();
    } catch (e) { toast(e.message, 'error'); save.disabled = false; }
  } }, 'save');
  const m = modal('profile glow-up', el('div', { class: 'col gap-s' },
    d.beta ? null : el('div', { class: 'form-err' }, 'setting these is a beta perk. everyone can still see what beta people set.'),
    el('h4', null, 'accent color'), el('div', { class: 'row gap' }, color, el('span', { class: 'muted small' }, 'tints your profile')),
    el('h4', null, 'avatar frame'), frames,
    el('h4', null, 'favorite game'), gameLbl, gq, gres,
    el('h4', null, 'bio song or link'), url, label,
    el('h4', null, 'top 3 friends'), dms.length ? fr : el('div', { class: 'muted small' }, 'start a dm with someone first'),
    save));
}

function profileDecorate(body, p, m) {
  const head = body.querySelector('.prof-head');
  const x = p.extra;
  if (head && p.streak) head.querySelector('.grow') && head.querySelector('.grow').append(el('div', { class: 'small', style: 'margin-top:4px' }, el('span', { class: 'tag gold' }, ic('flame', 12), p.streak + ' day word streak')));
  if (!x || !head) return;
  if (x.accent) { head.style.setProperty('--pacc', x.accent); head.classList.add('pacc'); }
  const av = head.querySelector('.avwrap');
  if (av && x.frame && x.frame !== 'none') av.classList.add('frame', 'frame-' + x.frame);
  const blocks = [];
  if (x.game) blocks.push(el('div', { class: 'urow click', onclick: () => { m.close(); window.__ext.openGameFromProfile(x.game.path, x.game.title); } }, ic('gamepad', 18), el('div', { class: 'grow' }, el('div', { class: 'muted small' }, 'favorite game'), el('div', { class: 'ctitle' }, x.game.title))));
  if (x.link) blocks.push(el('a', { class: 'urow click', href: x.link.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, ic('link', 18), el('div', { class: 'grow' }, el('div', { class: 'muted small' }, 'on repeat'), el('div', { class: 'ctitle' }, x.link.label))));
  if (x.friends && x.friends.length) blocks.push(el('div', null, el('div', { class: 'muted small', style: 'margin:6px 0' }, (x.friends.length === 1 ? 'top friend' : 'top ' + x.friends.length + ' friends')), el('div', { class: 'topfr' }, x.friends.map((f, i) => el('div', { class: 'tf click', onclick: () => { m.close(); U.openProfile(f.username); } }, el('span', { class: 'tfn' }, i + 1), avatar(f.displayName, 38, '', f.avatar), el('span', { class: 'small' }, f.displayName))))));
  if (blocks.length) head.insertAdjacentElement('afterend', el('div', { class: 'pextra' }, blocks));
}

function gameRoomModal(c) {
  const body = el('div', { class: 'col gap-s' });
  const m = modal('game room', body);
  const set = async (path, title) => {
    try { await api('PUT', `/api/conversations/${c.id}/game`, { path }); c.gamePath = path; c.gameTitle = title || null; toast(path ? 'game pinned' : 'unpinned', 'success'); U.renderHeader(); draw(); } catch (e) { toast(e.message, 'error'); }
  };
  const q = el('input', { placeholder: 'search a game to pin here' });
  const res = el('div', { class: 'ulist' });
  let t;
  q.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      if (!q.value.trim()) return res.replaceChildren();
      try { const r = await api('GET', '/api/games?limit=8&q=' + encodeURIComponent(q.value.trim()), null, { quiet: true }); res.replaceChildren(...r.items.map((g) => el('div', { class: 'urow click', onclick: () => set(g.id, g.title) }, ic('gamepad', 16), el('div', { class: 'grow' }, g.title)))); } catch {}
    }, 300);
  });
  function draw() {
    body.replaceChildren(
      c.gamePath ? el('div', { class: 'col gap-s' }, el('div', { class: 'muted small' }, 'pinned in this chat'), el('div', { class: 'ctitle' }, c.gameTitle || 'game'),
        el('button', { class: 'btn primary wide', onclick: () => { m.close(); window.__ext.openGameFromProfile(c.gamePath, c.gameTitle || 'game', c.id); } }, ic('play', 16), 'drop in'),
        el('button', { class: 'btn wide', onclick: () => set(null) }, 'unpin')) : el('div', { class: 'muted small' }, 'pin a game here so everyone in this chat can drop in and out. the chat stays open on top of the game.'),
      q, res);
  }
  draw();
}

let dock = null;
function dockOpen(playerNode, convId) {
  dockClose();
  let cid = convId && convOf(convId) ? convId : (S.convs[0] && S.convs[0].id);
  if (!cid) return;
  const box = el('div', { class: 'gdock' });
  const list = el('div', { class: 'gdmsgs' });
  const sel = el('select', { class: 'gdsel', onchange: () => { cid = sel.value; seen = 0; unread = 0; prime(); } }, S.convs.map((c) => el('option', { value: c.id }, convTitle(c))));
  sel.value = cid;
  const input = el('input', { placeholder: 'say something', maxLength: 2000 });
  const badge = el('span', { class: 'gdbadge' });
  const bubble = el('button', { class: 'gdbub', title: 'chat', onclick: () => toggle(true) }, ic('chat', 22), badge);
  const panel = el('div', { class: 'gdpanel' },
    el('div', { class: 'gdhead' }, sel, el('button', { class: 'icon-btn', title: 'hide chat', onclick: () => toggle(false) }, ic('x', 18))),
    list,
    el('div', { class: 'gdin' }, input, el('button', { class: 'icon-btn', onclick: () => send() }, ic('send', 18))));
  box.append(bubble, panel);
  playerNode.append(box);
  let open = false, seen = 0, unread = 0;
  const cur = () => convOf(cid);
  async function prime() { const c = cur(); if (c && !c.loaded) { try { await C.loadMessages(c); } catch {} } paint(); }
  function paint() {
    const c = cur(); if (!c) return;
    const msgs = (c.msgs || []).filter((m) => !m.deleted).slice(-30);
    const last = msgs.length ? msgs[msgs.length - 1].id : 0;
    if (!seen) seen = last;
    if (open) { seen = last; unread = 0; if (c.unread) C.markRead(c); }
    else unread = msgs.filter((m) => m.id > seen && m.senderId !== S.me.id).length;
    badge.textContent = unread ? String(unread) : '';
    badge.style.display = unread ? '' : 'none';
    if (!open) return;
    list.replaceChildren(...msgs.map((m) => {
      const mine = m.senderId === S.me.id, p = m._p || {};
      const who = mine ? 'you' : ((memberOf(c, m.senderId) || {}).displayName || 'someone');
      return el('div', { class: 'gdm' + (mine ? ' mine' : '') }, el('b', null, who), el('span', null, p.t === 'text' ? p.text : previewText(p, false)));
    }));
    list.scrollTop = list.scrollHeight;
  }
  async function send() {
    const c = cur(), text = input.value.trim();
    if (!c || !text) return;
    input.value = '';
    if (!(await sendPayload(c, { t: 'text', text }))) input.value = text;
    paint();
  }
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') send(); });
  input.addEventListener('keyup', (e) => e.stopPropagation());
  function toggle(v) { open = v; box.classList.toggle('open', v); paint(); if (v) setTimeout(() => input.focus(), 50); }
  dock = { box, timer: setInterval(paint, 1200) };
  prime();
}
function dockClose() { if (dock) { clearInterval(dock.timer); dock.box.remove(); dock = null; } }

Object.assign(window.__ext, { openGameFromProfile: (path, title, convId) => U.openGame(path, title, { convId }), dailyBuild, boardsBuild, profileEditModal, profileDecorate, gameRoomModal, dockOpen, dockClose });
})();

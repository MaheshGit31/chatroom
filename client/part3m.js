(() => {
'use strict';
const C = window.__core, U = window.__ui, X = window.__ext;
const { S, el, ic, toast, api, convOf } = C;
const { modal, confirmModal } = U;

const BW = 1000, BH = 700;
const COLORS = ['#222222', '#e0674f', '#e0a526', '#6bb26b', '#4f9fd8', '#8b6bd8', '#d86bb0', '#ffffff'];
const SIZES = [3, 8, 18];

let open = null;

function drawStroke(g, d) {
  if (d.k === 'text') { g.fillStyle = d.c; g.font = `bold ${d.w}px sans-serif`; g.textBaseline = 'top'; g.fillText(d.t, d.x, d.y); return; }
  g.strokeStyle = d.c; g.fillStyle = d.c; g.lineWidth = d.w; g.lineCap = 'round'; g.lineJoin = 'round';
  if (d.p.length === 1) { g.beginPath(); g.arc(d.p[0][0], d.p[0][1], d.w / 2, 0, 7); g.fill(); return; }
  g.beginPath(); g.moveTo(d.p[0][0], d.p[0][1]);
  for (let i = 1; i < d.p.length; i++) g.lineTo(d.p[i][0], d.p[i][1]);
  g.stroke();
}

async function boardModal(boardId, admin) {
  if (open) return;
  let data;
  try { data = await api('GET', admin ? `/api/admin/whiteboards/${boardId}` : `/api/whiteboards/${boardId}`); } catch (e) { return toast(e.message, 'error'); }
  const board = data.board;
  const strokes = data.strokes.slice();
  const canvas = el('canvas', { width: BW, height: BH, class: 'boardcv' });
  const g = canvas.getContext('2d');
  const st = { color: COLORS[0], size: SIZES[0], tool: 'pen', cur: null };
  const redraw = () => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, BW, BH); strokes.forEach((s) => drawStroke(g, s.d)); if (st.cur) drawStroke(g, st.cur); };
  const tools = el('div', { class: 'row gap-s wraprow', style: 'align-items:center' });
  const drawTools = () => tools.replaceChildren(
    ...COLORS.map((c) => el('button', { class: 'swatch' + (st.color === c && st.tool !== 'text' ? ' on' : ''), style: `background:${c};border-color:${st.color === c ? 'var(--text)' : 'var(--line)'}`, onclick: () => { st.color = c; if (st.tool === 'text') st.tool = 'pen'; drawTools(); } })),
    ...SIZES.map((n) => el('button', { class: 'btn small' + (st.size === n ? ' primary' : ''), onclick: () => { st.size = n; drawTools(); } }, n === 3 ? 'thin' : n === 8 ? 'med' : 'thick')),
    el('button', { class: 'btn small' + (st.tool === 'text' ? ' primary' : ''), onclick: () => { st.tool = st.tool === 'text' ? 'pen' : 'text'; drawTools(); } }, 'text'),
    el('button', { class: 'btn small', onclick: undo }, ic('back', 14), 'undo'));
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * BW / r.width), Math.round((e.clientY - r.top) * BH / r.height)]; };
  const send = async (d) => {
    try { const r = await api('POST', `/api/whiteboards/${board.id}/strokes`, d); if (!strokes.some((s) => s.id === r.id)) { strokes.push({ id: r.id, u: S.me.id, d: serverShape(d) }); redraw(); } } catch (e) { toast(e.message, 'error'); redraw(); }
  };
  const serverShape = (d) => (d.k === 'text' ? { ...d, w: Math.min(40, Math.max(10, d.w * 4)) } : d);

  canvas.addEventListener('pointerdown', (e) => {
    if (admin) return;
    const [x, y] = pos(e);
    if (st.tool === 'text') {
      askText().then((t) => { if (t) send({ k: 'text', c: st.color, w: Math.max(3, Math.round(st.size / 3)), t, x, y }); });
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    st.cur = { k: 'pen', c: st.color, w: st.size, p: [[x, y]] }; redraw();
  });
  canvas.addEventListener('pointermove', (e) => { if (!st.cur) return; const [x, y] = pos(e); const l = st.cur.p[st.cur.p.length - 1]; if (Math.hypot(x - l[0], y - l[1]) < 3) return; if (st.cur.p.length < 400) st.cur.p.push([x, y]); redraw(); });
  const end = () => { if (!st.cur) return; const d = st.cur; st.cur = null; send(d); };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);

  function askText() {
    return new Promise((done) => {
      const inp = el('input', { placeholder: 'type your text', maxLength: 40 });
      let fin = false;
      const finish = (v) => { if (fin) return; fin = true; mm.close(); done(v); };
      const mm = modal('add text', el('div', { class: 'col gap-s' }, inp, el('button', { class: 'btn primary', onclick: () => finish(inp.value.trim()) }, 'place it')), { onClose: () => finish('') });
      mm.box.style.zIndex = 430; inp.focus();
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(inp.value.trim()); });
    });
  }

  async function undo() {
    const mine = [...strokes].reverse().find((s) => s.u === S.me.id);
    if (!mine) return;
    try { await api('DELETE', `/api/whiteboards/${board.id}/strokes/${mine.id}`); } catch (e) { toast(e.message, 'error'); }
  }

  X.onBoard = (e) => {
    if (e.boardId !== board.id) return;
    if (e.t === 'board_stroke') { if (!strokes.some((s) => s.id === e.id)) { strokes.push({ id: e.id, u: e.u, d: e.d }); redraw(); } }
    else if (e.t === 'board_unstroke') { const i = strokes.findIndex((s) => s.id === e.id); if (i >= 0) { strokes.splice(i, 1); redraw(); } }
    else if (e.t === 'board_clear') { strokes.length = 0; redraw(); }
    else if (e.t === 'board_del') { toast('this board was deleted', 'info'); m.close(); }
  };

  const actions = el('div', { class: 'row gap-s wraprow' },
    !admin ? el('button', { class: 'btn small ghost', onclick: () => { m.close(); X.reportModal({ kind: 'board', boardId: board.id, convId: board.convId, title: 'this whiteboard' }); } }, ic('flag', 14), 'report') : null,
    board.mine || board.staff ? el('button', { class: 'btn small', onclick: async () => { if (await confirmModal('clear the board?', 'everything on it is wiped for everyone.', 'clear')) { try { await api('POST', admin ? `/api/admin/whiteboards/${board.id}/clear` : `/api/whiteboards/${board.id}/clear`); } catch (e) { toast(e.message, 'error'); } } } }, 'clear') : null);
  const body = el('div', { class: 'col gap-s' },
    el('div', { class: 'muted small' }, admin ? 'reported board (view only)' : 'everyone in the group can draw here. pick a color, draw, or tap text to place words.'),
    admin ? null : tools, canvas, actions);
  const m = modal(board.title, body, { wide: true, onClose: () => { open = null; X.onBoard = null; } });
  m.box.style.width = 'min(96vw, 900px)'; m.box.style.maxWidth = 'min(96vw, 900px)';
  open = true; drawTools(); redraw();
}

async function boardsModal(c) {
  const body = el('div', { class: 'col gap-s' });
  const m = modal('whiteboards · ' + c.name, body);
  const draw = async () => {
    try {
      const d = await api('GET', `/api/conversations/${c.id}/whiteboards`);
      const title = el('input', { placeholder: 'new board name', maxLength: 40 });
      body.replaceChildren(
        el('p', { class: 'muted small', style: 'margin:0' }, 'shared drawing boards. anyone in the group can draw on them, and anything inappropriate can be reported.'),
        ...(d.boards.length ? d.boards.map((b) => el('div', { class: 'urow click', onclick: () => { m.close(); boardModal(b.id); } }, el('div', { class: 'gshare-ic sm' }, ic('palette', 18)), el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, b.title), el('div', { class: 'muted small' }, `by ${b.creator} · ${b.strokes} strokes`)))) : [el('div', { class: 'muted pad' }, 'no boards yet')]),
        d.boards.length < d.max ? el('div', { class: 'row gap-s' }, title, el('button', { class: 'btn primary', onclick: async () => {
          try { const r = await api('POST', `/api/conversations/${c.id}/whiteboards`, { title: title.value }); m.close(); boardModal(r.board.id); } catch (e) { toast(e.message, 'error'); }
        } }, ic('plus', 16), 'new')) : el('div', { class: 'muted small' }, `max ${d.max} boards, delete one to make room`));
    } catch (e) { body.replaceChildren(el('div', { class: 'form-err' }, e.message)); }
  };
  draw();
}

function nightsSection(c, redraw) {
  if (c.type !== 'group' || c.systemKind) return null;
  const box = el('div', { class: 'col gap-s', style: 'margin-top:14px' });
  const staff = U.myRank(c) >= 1;
  const load = async () => {
    try {
      const d = await api('GET', `/api/conversations/${c.id}/nights`, null, { quiet: true });
      const title = el('input', { placeholder: 'game night name', maxLength: 50 });
      const when = el('input', { type: 'datetime-local' });
      const game = el('input', { placeholder: 'game (optional)', maxLength: 80 });
      box.replaceChildren(
        el('h4', { style: 'margin:0' }, ic('gamepad', 14), 'game nights'),
        ...(d.nights.length ? d.nights.map((n) => el('div', { class: 'urow' }, el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, n.title), el('div', { class: 'muted small' }, new Date(n.startsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }) + (n.gameTitle ? ' · ' + n.gameTitle : '') + ` · ${n.going} going`)),
          el('button', { class: 'btn small' + (n.mine ? '' : ' primary'), onclick: async () => { try { await api('POST', `/api/nights/${n.id}/rsvp`, { going: !n.mine }); load(); } catch (e) { toast(e.message, 'error'); } } }, n.mine ? 'going' : 'i am in'),
          staff || n.mineCreated ? el('button', { class: 'icon-btn', title: 'cancel', onclick: async () => { try { await api('DELETE', `/api/nights/${n.id}`); load(); } catch (e) { toast(e.message, 'error'); } } }, ic('trash', 16)) : null)) : [el('div', { class: 'muted small' }, 'nothing planned yet')]),
        staff ? el('div', { class: 'col gap-s' }, title, game, when, el('button', { class: 'btn', onclick: async () => {
          if (!when.value) return toast('pick a time', 'error');
          try { await api('POST', `/api/conversations/${c.id}/nights`, { title: title.value, gameTitle: game.value || null, startsAt: new Date(when.value).toISOString() }); load(); } catch (e) { toast(e.message, 'error'); }
        } }, ic('plus', 16), 'plan a game night')) : null);
    } catch (e) { box.replaceChildren(el('div', { class: 'muted small' }, e.message)); }
  };
  load();
  return box;
}

function boardsRow(c) {
  if (c.type !== 'group' || c.systemKind) return null;
  return el('button', { class: 'btn', style: 'margin-top:14px', onclick: () => boardsModal(c) }, ic('palette', 16), 'whiteboards');
}

Object.assign(window.__ext, { boardsModal, boardModal, nightsSection, boardsRow, onBoard: null });
})();

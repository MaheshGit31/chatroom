/* ===== Chatroom client: /meme (pick up to 5 messages, choose a style, send a meme card) ===== */
(() => {
'use strict';
const C = window.__core, U = window.__ui;
const { S, el, ic, toast, convOf, sendPayload } = C;
const { modal } = U;

const MAX = 5;
const STYLES = [['classic', 'classic'], ['chat', 'screenshot'], ['drake', 'nope / yes'], ['brain', 'big brain']];
const clip = (s, n) => String(s || '').slice(0, n);

function memeCard(p) {
  const lines = (Array.isArray(p.lines) ? p.lines : []).slice(0, MAX);
  const style = STYLES.some(([k]) => k === p.style) ? p.style : 'classic';
  const cap = (t, cls) => (t ? el('div', { class: 'mcap ' + cls }, clip(t, 90)) : null);
  const bubble = (l) => el('div', { class: 'mbub' }, el('b', null, clip(l.n, 32)), el('span', null, clip(l.s, 200)));
  let mid;
  if (style === 'drake') {
    mid = lines.map((l, i) => el('div', { class: 'mdrake ' + (i % 2 ? 'yes' : 'no') }, el('div', { class: 'mdicon' }, ic(i % 2 ? 'check' : 'x', 26)), el('div', { class: 'mdtext' }, clip(l.s, 200))));
  } else if (style === 'brain') {
    mid = lines.map((l, i) => el('div', { class: 'mbrain', style: `--lvl:${lines.length > 1 ? i / (lines.length - 1) : 1}` }, el('div', { class: 'mblvl' }, ic('sparkle', 18)), el('div', { class: 'mbtext' }, clip(l.s, 200))));
  } else mid = lines.map(bubble);
  return el('div', { class: 'meme s-' + style }, cap(p.top, 'top'), el('div', { class: 'mmid' }, mid), cap(p.bottom, 'bot'));
}

let pick = null;
function memePick(c) {
  if (pick) pickStop();
  const box = U.chatRef().msgs; if (!box) return;
  const ids = [];
  const bar = el('div', { class: 'memebar' }, el('span', { class: 'grow' }), el('button', { class: 'btn small', onclick: () => pickStop() }, 'cancel'));
  const label = bar.querySelector('.grow'), go = el('button', { class: 'btn small primary', onclick: () => { const chosen = ids.map((id) => c.msgs.find((m) => m.id === id)).filter(Boolean); pickStop(); maker(c, chosen); } }, 'next');
  bar.append(go);
  const paint = () => {
    box.querySelectorAll('.mrow').forEach((r) => { const id = Number(r.dataset.mid), i = ids.indexOf(id); r.classList.toggle('mpicked', i >= 0); r.dataset.mn = i >= 0 ? String(i + 1) : ''; });
    label.textContent = ids.length ? `${ids.length} of ${MAX} picked, in the order you tapped` : `tap up to ${MAX} messages`; go.disabled = !ids.length;
  };
  const click = (e) => {
    const row = e.target.closest('.mrow'); if (!row) return;
    e.preventDefault(); e.stopPropagation();
    const id = Number(row.dataset.mid), m = c.msgs.find((x) => x.id === id), i = ids.indexOf(id);
    if (i >= 0) ids.splice(i, 1);
    else if (!m || m.deleted || !m._p || m._p.t !== 'text') return toast('only text messages can go in a meme', 'error');
    else if (ids.length >= MAX) return toast(`up to ${MAX} messages`, 'error');
    else ids.push(id);
    paint();
  };
  const watch = new MutationObserver(() => { if (U.chatRef().convId !== c.id) return pickStop(); paint(); });
  box.addEventListener('click', click, true); watch.observe(box, { childList: true });
  box.classList.add('memepicking'); document.body.append(bar);
  pick = { stop: () => { box.removeEventListener('click', click, true); watch.disconnect(); box.classList.remove('memepicking'); box.querySelectorAll('.mpicked').forEach((r) => r.classList.remove('mpicked')); bar.remove(); } };
  paint();
}
function pickStop() { if (pick) { pick.stop(); pick = null; } }

function maker(c, msgs) {
  if (!msgs.length) return;
  const nameOf = (m) => (m.senderId === S.me.id ? S.me.displayName : ((c.members.find((x) => x.id === m.senderId) || {}).displayName || 'someone'));
  const lines = msgs.map((m) => ({ n: nameOf(m), s: clip(m._p.text, 160) }));
  const st = { style: msgs.length === 2 ? 'drake' : 'classic', top: '', bottom: '' };
  const preview = el('div', { class: 'memeprev' });
  const draw = () => { preview.replaceChildren(memeCard({ t: 'meme', ...st, lines })); chips.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === st.style)); };
  const chips = el('div', { class: 'seg' }, STYLES.map(([k, label]) => el('button', { 'data-k': k, onclick: () => { st.style = k; draw(); } }, label)));
  const top = el('input', { placeholder: 'top caption (optional)', maxLength: 90, oninput: () => { st.top = top.value; draw(); } });
  const bot = el('input', { placeholder: 'bottom caption (optional)', maxLength: 90, oninput: () => { st.bottom = bot.value; draw(); } });
  const send = el('button', { class: 'btn primary wide', onclick: async () => {
    send.disabled = true;
    const ok = await sendPayload(c, { t: 'meme', style: st.style, top: st.top.trim(), bottom: st.bottom.trim(), lines });
    if (ok) m.close(); else send.disabled = false;
  } }, ic('send', 16), 'send meme');
  const m = modal('make a meme', el('div', { class: 'col gap-s' }, chips, top, bot, preview, send));
  draw();
}

Object.assign(window.__ext, { memeBody: (c, m, p) => el('div', { class: 'memewrap' }, memeCard(p)), memePick, memeStop: pickStop });
})();

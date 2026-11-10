// ---------- stories ----------
{
const C = window.__core, S = C.S, el = C.el, ic = C.ic, api = C.api, toast = C.toast, avatar = C.avatar, fmtTime = C.fmtTime;
const modal = (...a) => window.__ui.modal(...a);
const ST = { users: new Map(), list: [], loaded: false };
S.stories = ST.users;
const live = () => true;

const css = document.createElement('style');
css.textContent = `
.avwrap.hasstory{cursor:pointer}
.avwrap.hasstory>.avatar{box-shadow:0 0 0 2px var(--bg,#1c1612),0 0 0 4px var(--muted,#8a7b6a)}
.avwrap.hasstory.unseen>.avatar{box-shadow:0 0 0 2px var(--bg,#1c1612),0 0 0 4.5px var(--accent),0 0 16px 4px color-mix(in srgb,var(--accent) 60%,transparent);animation:storyglow 2.4s ease-in-out infinite}
@keyframes storyglow{50%{box-shadow:0 0 0 2px var(--bg,#1c1612),0 0 0 4.5px var(--accent),0 0 24px 8px color-mix(in srgb,var(--accent) 75%,transparent)}}
.storystrip{display:flex;gap:14px;overflow-x:auto;padding:10px 14px 6px;scrollbar-width:none;flex:none}
.storystrip::-webkit-scrollbar{display:none}
.storystrip:empty{display:none}
.stitem{display:flex;flex-direction:column;align-items:center;gap:6px;flex:none;width:58px;background:none;color:var(--text);padding:4px 0}
.stitem .stname{font-size:var(--t-xs,12px);max-width:58px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}
.stadd{position:relative}
.stadd .plus{position:absolute;right:-4px;bottom:-4px;width:20px;height:20px;border-radius:50%;background:var(--accent);color:var(--accent-ink,#fff);display:flex;align-items:center;justify-content:center;border:2px solid var(--bg,#1c1612)}
.stvid{width:100%;max-height:60dvh;border-radius:18px;background:#000;display:block;object-fit:cover}
.stvid.mirror{transform:scaleX(-1)}
.stprev{width:100%;max-height:60dvh;border-radius:18px;display:block;object-fit:contain;background:#000}
.stbtns{display:flex;gap:8px;margin-top:10px;align-items:center;justify-content:center}
.stshot{width:64px;height:64px;border-radius:50%;border:4px solid var(--text);background:var(--accent);flex:none}
.storyview{position:fixed;inset:0;z-index:290;background:#000;display:flex;align-items:center;justify-content:center;animation:fade .2s both}
.storyview .sv-box{position:relative;width:min(100vw,calc(100dvh*9/16));height:100dvh;max-height:100dvh;background:#0b0907;display:flex;align-items:center;justify-content:center;overflow:hidden}
.storyview img.sv-img{width:100%;height:100%;object-fit:contain;user-select:none;-webkit-user-drag:none}
.sv-top{position:absolute;left:0;right:0;top:0;padding:max(10px,env(safe-area-inset-top)) 12px 28px;background:linear-gradient(#000a,#0000);color:#fff;z-index:3}
.sv-bars{display:flex;gap:4px;margin-bottom:10px}
.sv-bars i{flex:1;height:3px;border-radius:2px;background:#fff4;overflow:hidden;display:block}
.sv-bars i b{display:block;height:100%;width:0;background:#fff}
.sv-bars i.done b{width:100%}
.sv-head{display:flex;align-items:center;gap:10px}
.sv-head .nm{font-weight:700;font-size:15px}.sv-head .tm{font-size:12px;opacity:.75}
.sv-head button{color:#fff;background:#fff2;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;flex:none}
.sv-cap{position:absolute;left:0;right:0;bottom:0;padding:40px 18px max(22px,env(safe-area-inset-bottom));background:linear-gradient(#0000,#000c);color:#fff;font-size:17px;text-align:center;z-index:3}
.sv-tap{position:absolute;top:70px;bottom:90px;width:40%;z-index:2}
.sv-tap.l{left:0}.sv-tap.r{right:0;width:60%}
.sv-own{position:absolute;right:12px;bottom:max(70px,env(safe-area-inset-bottom));z-index:4;display:flex;gap:8px}
.sv-own button{display:flex;align-items:center;gap:6px;color:#fff;background:#0009;border-radius:999px;padding:8px 14px;font-size:14px}
`;
document.head.append(css);

async function load() {
  if (!live() || !S.me) return;
  try {
    const d = await api('GET', '/api/stories', null, { quiet: true });
    ST.list = d.users;
    ST.users = new Map(d.users.map((u) => [u.userId, u]));
    S.stories = ST.users;
    ST.loaded = true;
    window.__ui.renderSide();
    renderStrip();
    window.__ui.renderRail && window.__ui.renderRail();
  } catch {}
}

function ring(wrap, uid) {
  const s = uid && ST.users.get(uid);
  if (!s || !wrap) return wrap;
  wrap.classList.add('hasstory');
  if (!s.seen) wrap.classList.add('unseen');
  wrap.addEventListener('click', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault(); openViewer(uid); }, true);
  return wrap;
}

function renderStrip() {
  const box = document.getElementById('storystrip');
  if (!box) return;
  if (!live() || !S.me) { box.replaceChildren(); return; }
  const mine = ST.users.get(S.me.id);
  const meWrap = el('div', { class: 'avwrap stadd' }, avatar(S.me.displayName, 46, '', S.me.avatar), el('span', { class: 'plus' }, ic('plus', 12)));
  const meBtn = el('button', { class: 'stitem', title: 'add to your story', onclick: () => composer() }, meWrap, el('span', { class: 'stname' }, 'your story'));
  const items = [meBtn];
  if (mine) {
    const mw = el('div', { class: 'avwrap' }, avatar(S.me.displayName, 46, '', S.me.avatar));
    items.push(el('button', { class: 'stitem', title: 'view your story' }, ring(mw, S.me.id), el('span', { class: 'stname' }, 'mine')));
  }
  for (const u of ST.list) {
    if (u.userId === S.me.id) continue;
    const w = el('div', { class: 'avwrap' }, avatar(u.displayName, 46, '', u.avatar));
    items.push(el('button', { class: 'stitem', title: u.displayName }, ring(w, u.userId), el('span', { class: 'stname' }, u.displayName)));
  }
  box.replaceChildren(...items);
}

function shrink(src, mirror) {
  const w0 = src.videoWidth || src.naturalWidth || src.width, h0 = src.videoHeight || src.naturalHeight || src.height;
  const k = Math.min(1, 960 / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
  const g = c.getContext('2d');
  if (mirror) { g.translate(c.width, 0); g.scale(-1, 1); }
  g.drawImage(src, 0, 0, c.width, c.height);
  let q = 0.82, out = c.toDataURL('image/jpeg', q);
  while (out.length * 0.75 > 300_000 && q > 0.3) { q -= 0.08; out = c.toDataURL('image/jpeg', q); }
  return out;
}

function composer() {
  if (!S.me.verified && !S.me.isAdmin) return toast('verify your account to post a story', 'error');
  let stream = null, facing = 'user', shot = null;
  const body = el('div', null);
  const stop = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
  const m = modal('new story', body, { onClose: stop });
  const video = el('video', { class: 'stvid mirror', autoplay: true, playsInline: true, muted: true });
  const file = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  const note = el('p', { class: 'muted small', style: 'text-align:center;margin:8px 0 0' }, 'stories vanish after 24 hours');

  const start = async () => {
    stop();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
      video.srcObject = stream;
      video.classList.toggle('mirror', facing === 'user');
      note.textContent = 'stories vanish after 24 hours';
    } catch { note.textContent = 'camera is blocked or missing. you can pick a photo instead'; }
  };
  const draw = () => {
    shot = null;
    const snap = el('button', { class: 'stshot', title: 'take photo', onclick: () => {
      if (!video.videoWidth) return toast('camera is not ready yet', 'error');
      shot = shrink(video, facing === 'user'); stop(); review();
    } });
    body.replaceChildren(video, el('div', { class: 'stbtns' },
      el('button', { class: 'btn', onclick: () => { facing = facing === 'user' ? 'environment' : 'user'; start(); } }, 'flip'),
      snap,
      el('button', { class: 'btn', onclick: () => file.click() }, ic('image', 16), 'photo')), note, file);
    start();
  };
  const review = () => {
    const cap = el('input', { placeholder: 'add a caption', maxlength: 140, style: 'width:100%;margin-top:10px' });
    const post = el('button', { class: 'btn primary grow' }, ic('send', 16), 'post story');
    post.onclick = async () => {
      post.disabled = true;
      try { await api('POST', '/api/stories', { image: shot, caption: cap.value.trim() }); toast('story posted', 'success'); m.close(); load(); }
      catch (e) { toast(e.message, 'error'); post.disabled = false; }
    };
    body.replaceChildren(el('img', { class: 'stprev', src: shot }), cap,
      el('div', { class: 'row gap', style: 'margin-top:10px' }, el('button', { class: 'btn', onclick: draw }, 'retake'), post));
  };
  file.onchange = () => {
    const f = file.files && file.files[0]; if (!f) return;
    const img = new Image();
    img.onload = () => { shot = shrink(img, false); URL.revokeObjectURL(img.src); stop(); review(); };
    img.onerror = () => toast('could not read that photo', 'error');
    img.src = URL.createObjectURL(f);
  };
  draw();
}

async function openViewer(uid) {
  let order = ST.list.map((u) => u.userId);
  if (uid === S.me.id && !order.includes(uid)) order = [uid];
  let ui = Math.max(0, order.indexOf(uid)), si = 0, items = [], timer = 0, started = 0, paused = false, left = 0, DUR = 5000;
  const root = el('div', { class: 'storyview' });
  const box = el('div', { class: 'sv-box' });
  root.append(box);
  document.body.append(root);
  const close = () => { clearInterval(timer); document.removeEventListener('keydown', key); root.remove(); load(); };
  const key = (e) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') next(); else if (e.key === 'ArrowLeft') prev(); };
  document.addEventListener('keydown', key);

  async function loadUser() {
    clearInterval(timer);
    const id = order[ui];
    try { items = (await api('GET', `/api/stories/user/${id}`, null, { quiet: true })).stories; } catch { items = []; }
    if (!items.length) return next(true);
    si = Math.max(0, items.findIndex((x) => !x.seen)); if (si < 0 || order[ui] === S.me.id) si = 0;
    show();
  }
  function show() {
    const id = order[ui], u = ST.users.get(id) || (id === S.me.id ? { displayName: S.me.displayName, avatar: S.me.avatar } : { displayName: '', avatar: null });
    const it = items[si];
    const bars = el('div', { class: 'sv-bars' }, items.map((_, i) => el('i', { class: i < si ? 'done' : '' }, el('b'))));
    const mine = id === S.me.id;
    const top = el('div', { class: 'sv-top' }, bars, el('div', { class: 'sv-head' }, avatar(u.displayName, 36, '', u.avatar),
      el('div', { class: 'grow' }, el('div', { class: 'nm' }, mine ? 'your story' : u.displayName), el('div', { class: 'tm' }, fmtTime(it.createdAt))),
      el('button', { title: 'close', onclick: close }, ic('x', 18))));
    const img = el('img', { class: 'sv-img', src: `${C.API}/api/stories/${it.id}/img`, draggable: false });
    const kids = [img, top,
      el('div', { class: 'sv-tap l', onclick: prev }), el('div', { class: 'sv-tap r', onclick: () => next() })];
    if (it.caption) kids.push(el('div', { class: 'sv-cap' }, it.caption));
    const own = [];
    if (mine || S.me.isAdmin) {
      if (it.views !== undefined) own.push(el('button', { onclick: () => viewers(it) }, ic('eye', 16), String(it.views)));
      own.push(el('button', { title: 'delete', onclick: () => del(it) }, ic('trash', 16)));
    }
    if (own.length) kids.push(el('div', { class: 'sv-own' }, own));
    box.replaceChildren(...kids);
    const bar = bars.children[si].firstChild;
    started = performance.now(); left = DUR; paused = false;
    clearInterval(timer);
    timer = setInterval(() => {
      if (paused) { started = performance.now() - (DUR - left); return; }
      const t = performance.now() - started; left = DUR - t;
      bar.style.width = Math.min(100, (t / DUR) * 100) + '%';
      if (t >= DUR) next();
    }, 50);
    box.onpointerdown = () => { paused = true; };
    box.onpointerup = box.onpointercancel = () => { paused = false; };
    if (!mine && !it.seen) { it.seen = true; api('POST', `/api/stories/${it.id}/view`, null, { quiet: true }).catch(() => {}); }
    if (si === items.length - 1) { const s = ST.users.get(id); if (s) { s.seen = true; } }
  }
  function next(skip) {
    if (si < items.length - 1 && !skip) { si++; return show(); }
    if (ui < order.length - 1) { ui++; si = 0; return loadUser(); }
    close();
  }
  function prev() {
    if (si > 0) { si--; return show(); }
    if (ui > 0) { ui--; return loadUser(); }
    show();
  }
  async function del(it) {
    paused = true;
    if (!(await window.__ui.confirmModal('delete story', 'delete this story for everyone?'))) { paused = false; return; }
    try { await api('DELETE', `/api/stories/${it.id}`); } catch (e) { paused = false; return toast(e.message, 'error'); }
    items.splice(si, 1);
    if (!items.length) { await load(); order.splice(ui, 1); if (ui >= order.length) return close(); return loadUser(); }
    if (si >= items.length) si = items.length - 1;
    show();
  }
  async function viewers(it) {
    paused = true;
    const b = el('div', null, el('div', { class: 'muted pad' }, '...'));
    modal('seen by', b, { onClose: () => { paused = false; } });
    try {
      const d = await api('GET', `/api/stories/${it.id}/views`);
      b.replaceChildren(...(d.views.length ? d.views.map((v) => el('div', { class: 'urow' }, avatar(v.displayName, 32), el('div', { class: 'grow' }, el('div', { class: 'ctitle' }, v.displayName), el('div', { class: 'small muted' }, '@' + v.username)), el('span', { class: 'small muted' }, fmtTime(v.at)))) : [el('div', { class: 'muted pad' }, 'nobody yet')]));
    } catch (e) { b.replaceChildren(el('div', { class: 'muted pad' }, e.message)); }
  }
  loadUser();
}

function onStories(m) { if (m.t === 'stories_changed') load(); }
setInterval(() => { if (live() && S.me && (!ST.loaded || document.visibilityState === 'visible')) load(); }, 60_000);
setTimeout(load, 4000);
Object.assign(window.__ext, { storyRing: ring, renderStories: renderStrip, storiesLoad: load, onStories, storyComposer: composer });
}

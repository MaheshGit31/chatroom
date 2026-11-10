(() => {
const S = window.__core.S;
const ST = document.createElement('style');
ST.textContent = `
html.ui2{--r:12px;--r-s:9px;--quick:.12s;--med:.22s;--shadow:0 10px 30px rgba(0,0,0,.32);--line:color-mix(in srgb,var(--text) 9%,var(--bg))}
html.ui2 body{font-size:14.5px;line-height:1.45}
html.ui2 body::after{opacity:calc(var(--grain)*.4)}
html.ui2 .btn{padding:7px 14px;border-radius:10px}
html.ui2 .btn.small{padding:4px 10px}
html.ui2 input,html.ui2 textarea{padding:8px 11px}
html.ui2 .modal{border-radius:18px;box-shadow:var(--shadow),0 0 0 1px var(--line)}
html.ui2 .modal-head{padding:12px 12px 4px 18px}
html.ui2 .modal-head h3{font-size:20px}
html.ui2 .modal-body{padding:4px 18px 18px}
html.ui2 .msgs{padding:8px 18px;gap:1px}
html.ui2 .mrow.first{margin-top:8px}
html.ui2 .mrow.new{animation:ui2in .28s var(--ease) both}
@keyframes ui2in{from{opacity:0;transform:translateY(8px)}}
html.ui2 .bubble{padding:6px 11px 4px;border-radius:14px;background:color-mix(in srgb,var(--panel2) 78%,var(--bg))}
html.ui2 .mine .bubble{border-radius:14px;background:linear-gradient(160deg,var(--mine),color-mix(in srgb,var(--mine) 82%,#000))}
html.ui2 .mrow:not(.first) .bubble{border-top-left-radius:5px}
html.ui2 .mrow.mine:not(.first) .bubble{border-top-left-radius:14px;border-top-right-radius:5px}
html.ui2 .mname{font-size:12.5px}
html.ui2 .daysep{margin:12px 0 6px;font-style:normal;font-family:var(--body);font-size:12px;letter-spacing:.04em}
html.ui2 .chat-head{padding:8px 16px;border-bottom:1px solid var(--line);backdrop-filter:blur(8px)}
html.ui2 .chat-head .ctitle{font-size:16px}
html.ui2 .composer-wrap{padding:0 12px 12px}
html.ui2 .composer{border-radius:16px;padding:4px;box-shadow:inset 0 0 0 1px var(--line)}
html.ui2 .composer:focus-within{box-shadow:inset 0 0 0 1px var(--accent),0 0 0 3px color-mix(in srgb,var(--accent) 12%,transparent)}
html.ui2 .send{width:38px;height:36px;border-radius:12px}
html.ui2 .seg button{padding:5px 11px}
@media (min-width:761px){
html.ui2 .app{grid-template-columns:62px 300px 1fr}
html.ui2 .app[data-view=games],html.ui2 .app[data-view=alerts],html.ui2 .app[data-view=admin],html.ui2 .app[data-view=discover],html.ui2 .app[data-view=beta]{grid-template-columns:62px 0 1fr}
html.ui2 .topbar{padding:6px 12px 0 74px;min-height:40px}
html.ui2 .rail{padding:10px 0;gap:2px;background:color-mix(in srgb,var(--panel) 70%,var(--bg))}
html.ui2 .rlogo{width:36px;height:36px;font-size:20px;margin-bottom:8px;border-radius:12px;transform:none}
html.ui2 .rlogo:hover{transform:scale(1.08)}
html.ui2 .rind{left:6px;width:50px;height:46px;border-radius:12px;background:color-mix(in srgb,var(--accent) 16%,transparent)}
html.ui2 .rbtn{width:50px;height:46px;border-radius:12px}
html.ui2 .rlabel{font-size:10px}
html.ui2 .side{border-radius:0;margin:0;box-shadow:none;border-right:1px solid var(--line);background:color-mix(in srgb,var(--panel) 40%,var(--bg))}
html.ui2 .side-head{padding:12px 12px 6px 16px}
html.ui2 .side-head h2{font-size:20px}
}
html.ui2 .rbtn .ic svg,html.ui2 .rbtn:hover .ic svg{transition:transform .2s var(--ease)}
`;
document.head.appendChild(ST);
let cur = null;
const want = () => { const x = window.__ext; return !!(x && x.dropOn && x.dropOn()) && S.prefs.ui !== 'legacy'; };
const apply = () => { const on = want(); if (on !== cur) { cur = on; document.documentElement.classList.toggle('ui2', on); } };
setInterval(apply, 1000);
setTimeout(apply, 300);
const seg = (save) => {
  const x = window.__ext;
  if (!(x && x.dropOn && x.dropOn())) return null;
  const el = window.__core.el;
  const b = (v, label) => el('button', { class: (S.prefs.ui === 'legacy' ? 'legacy' : 'new') === v ? 'on' : '', onclick: (e) => { S.prefs.ui = v === 'legacy' ? 'legacy' : 'new'; save(); apply(); e.target.parentNode.querySelectorAll('button').forEach((n) => n.classList.toggle('on', n === e.target)); } }, label);
  return el('div', { class: 'seg small', style: 'margin-top:8px' }, b('new', 'new look'), b('legacy', 'legacy look'));
};
Object.assign(window.__ext, { uiApply: apply, uiSeg: seg });
})();

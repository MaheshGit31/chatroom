(() => {
'use strict';
const C = window.__core;
async function startMC() {
  try {
    const t = await C.api('GET', '/api/blockworld/ticket');
    const q = new URLSearchParams({ u: t.user, p: t.pass, h: t.host, port: String(t.port) });
    window.open(C.API + '/blockworld/#' + q.toString(), '_blank', 'noopener');
  } catch (e) { C.toast(e.message || 'block world is not available right now', 'error'); }
}
Object.assign(window.__ext, { startMC });
})();

// lib/games.js - game index + html proxy for brickyosu/ugs-files-sorted
const REPO = 'brickyosu/ugs-files-sorted';
const GH_HEADERS = {
  'User-Agent': 'chatroom-app',
  Accept: 'application/vnd.github+json',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}), // optional, lifts rate limits
};

// fetch with a timeout
async function tfetch(url, opts = {}, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}

// "clADarkRoom.html" -> "A Dark Room" style titles (best effort)
function prettyTitle(file) {
  let n = file.replace(/\.html?$/i, '');                     // drop extension
  n = n.replace(/^cl(?=[A-Za-z0-9])/, '');                   // the stash prefixes most files with "cl"
  n = n.replace(/[_\-.]+/g, ' ');                            // separators to spaces
  n = n.replace(/([a-z])([A-Z])/g, '$1 $2');                 // camelCase to words
  n = n.replace(/([A-Za-z])(\d)/g, '$1 $2');                 // "amigopancho2" -> "amigopancho 2"
  n = n.replace(/\s+/g, ' ').trim();
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : file;
}

class Games {
  constructor() {
    this.items = [];                                         // [{ id, title, cat }]
    this.byId = new Map();
    this.cats = [];
    this.loadedAt = 0;
    this.cache = new Map();                                  // html proxy cache
    this.paths = [];                                         // raw path list (saved to the db so restarts don't need github)
    this.onLoad = null;                                      // called with the path list after each successful load
  }

  set(paths) {
    const items = paths
      .filter((p) => /\.html?$/i.test(p) && p.includes('/'))  // only html files inside folders
      .map((p) => ({ id: p, title: prettyTitle(p.split('/').pop()), cat: p.split('/')[0] }))
      .sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));
    if (!items.length) return false;
    this.items = items;
    this.byId = new Map(items.map((i) => [i.id, i]));
    const counts = {};
    for (const i of items) counts[i.cat] = (counts[i.cat] || 0) + 1;
    this.cats = Object.keys(counts).sort().map((c) => ({ cat: c, count: counts[c] }));
    this.loadedAt = Date.now();
    this.paths = items.map((i) => i.id);
    if (this.onLoad) this.onLoad(this.paths);
    return true;
  }

  // load the file list: one recursive tree call, falling back to per-folder listing
  async refresh() {
    try {
      const r = await tfetch(`https://api.github.com/repos/${REPO}/git/trees/HEAD?recursive=1`, { headers: GH_HEADERS }, 30000);
      if (r.ok) {
        const j = await r.json();
        if (!j.truncated && this.set(j.tree.filter((x) => x.type === 'blob').map((x) => x.path))) {
          console.log(`games: indexed ${this.items.length} via tree api`);
          return true;
        }
      } else console.warn('games: tree api status', r.status);
    } catch (e) { console.warn('games: tree api failed', e.message); }

    try {                                                    // fallback: list top-level then each folder
      const top = await (await tfetch(`https://api.github.com/repos/${REPO}/contents/`, { headers: GH_HEADERS })).json();
      if (!Array.isArray(top)) throw new Error(top && top.message ? top.message : 'bad response');
      const paths = [];
      for (const d of top.filter((x) => x.type === 'dir')) {
        const r = await tfetch(`https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(d.name)}`, { headers: GH_HEADERS });
        if (!r.ok) continue;
        for (const f of await r.json()) if (f.type === 'file') paths.push(f.path);
      }
      if (this.set(paths)) { console.log(`games: indexed ${this.items.length} via contents api`); return true; }
    } catch (e) { console.warn('games: contents api failed', e.message); }
    return false;
  }

  search({ q = '', cat = '', limit = 60, offset = 0 }) {
    const needle = q.trim().toLowerCase();
    let list = this.items;
    if (cat) list = list.filter((i) => i.cat === cat);
    if (needle) list = list.filter((i) => i.title.toLowerCase().includes(needle) || i.id.toLowerCase().includes(needle));
    return { total: list.length, items: list.slice(offset, offset + limit) };
  }

  // fetch a game's html (jsdelivr first, then raw github), with a small cache
  async html(path) {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < 600_000) return hit.html;
    const enc = path.split('/').map(encodeURIComponent).join('/');
    const urls = [
      `https://cdn.jsdelivr.net/gh/${REPO}@main/${enc}`,
      `https://raw.githubusercontent.com/${REPO}/HEAD/${enc}`,
    ];
    let lastErr = 'fetch failed';
    for (const u of urls) {
      try {
        const r = await tfetch(u, {}, 15000);
        if (!r.ok) { lastErr = `status ${r.status}`; continue; }
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 6_000_000) { lastErr = 'too large'; continue; }
        const html = prepare(buf.toString('utf8'), path);
        this.cache.set(path, { at: Date.now(), html });
        if (this.cache.size > 80) this.cache.delete(this.cache.keys().next().value); // tiny lru
        return html;
      } catch (e) { lastErr = e.message; }
    }
    throw new Error(lastErr);
  }
}

// make the page work from inside a sandboxed (opaque-origin) frame
function prepare(html, path) {
  const dir = path.split('/').slice(0, -1).map(encodeURIComponent).join('/');
  const base = /<base\s/i.test(html) ? '' : `<base href="https://cdn.jsdelivr.net/gh/${REPO}@main/${dir}/">`; // relative assets resolve to the repo
  // sandboxed frames have no localStorage, so give games an in-memory one instead of crashing
  const shim = `<script>(function(){function mk(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}try{void navigator.serviceWorker}catch(e){try{delete Navigator.prototype.serviceWorker}catch(_){}}try{void window.localStorage}catch(e){try{Object.defineProperty(window,'localStorage',{value:mk(),configurable:true});Object.defineProperty(window,'sessionStorage',{value:mk(),configurable:true})}catch(_){}}})();</script>`;
  const inject = base + shim;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + inject);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + '<head>' + inject + '</head>');
  return inject + html;
}

module.exports = { Games, REPO };

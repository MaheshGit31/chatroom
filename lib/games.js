// lib/games.js - game index + html proxy for brickyosu/ugs-files-sorted
const REPO = 'brickyosu/ugs-files-sorted';
const EXTRAS = [
  {
    id: 'extra/donottakethiscathome/index.html',
    title: 'Do NOT Take This Cat Home',
    cat: 'Horror',
    cdn: '/gx/donottakethiscathome/',
    raw: 'https://raw.githubusercontent.com/genizy/web-port/main/donottakethiscathome/',
    credits: {
      creator: 'Pixeliminal',
      creatorUrl: 'https://pixeliminal.itch.io/do-not-take-this-cat-home',
      port: 'genizy',
      portUrl: 'https://github.com/genizy/web-port/tree/main/donottakethiscathome',
      supportUrl: 'https://pixeliminal.itch.io/do-not-take-this-cat-home',
    },
  },
];
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
    this.onLoad = null;
    this.thumbs = new Map();
    this.thumbBusy = 0;
    this.thumbWait = [];                                      // called with the path list after each successful load
  }

  set(paths) {
    const items = paths
      .filter((p) => /\.html?$/i.test(p) && p.includes('/') && !p.startsWith('extra/'))  // only html files inside folders
      .map((p) => ({ id: p, title: prettyTitle(p.split('/').pop()), cat: p.split('/')[0] }))
      .sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));
    if (!items.length) return false;
    for (const x of EXTRAS) items.push({ id: x.id, title: x.title, cat: x.cat, credits: x.credits });
    items.sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));
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

  async thumb(path) {
    const hit = this.thumbs.get(path);
    if (hit && (hit.img || Date.now() - hit.at < 3_600_000)) return hit.img || null;
    if (hit && hit.pending) return hit.pending;
    const run = async () => {
      while (this.thumbBusy >= 4) await new Promise((r) => this.thumbWait.push(r));
      this.thumbBusy++;
      try { return await this.findThumb(path); } catch { return null; } finally { this.thumbBusy--; const w = this.thumbWait.shift(); if (w) w(); }
    };
    const pending = run();
    this.thumbs.set(path, { at: Date.now(), pending });
    const img = await pending;
    this.thumbs.set(path, { at: Date.now(), img });
    if (this.thumbs.size > 500) this.thumbs.delete(this.thumbs.keys().next().value);
    return img;
  }

  async findThumb(path) {
    const extra = EXTRAS.find((x) => x.id === path);
    const dirUrl = extra ? extra.raw : `https://cdn.jsdelivr.net/gh/${REPO}@main/${path.split('/').slice(0, -1).map(encodeURIComponent).join('/')}/`;
    if (extra) return this.fetchImg(extra.raw + 'icons/icon.png');
    const item = this.byId.get(path);
    const steam = item ? await this.steamThumb(item.title) : null;
    if (steam) return steam;
    const enc = path.split('/').map(encodeURIComponent).join('/');
    let text = '';
    for (const u of [`https://cdn.jsdelivr.net/gh/${REPO}@main/${enc}`, `https://raw.githubusercontent.com/${REPO}/HEAD/${enc}`]) {
      try {
        const r = await tfetch(u, { headers: { Range: 'bytes=0-65535' } }, 10000);
        if (!r.ok) continue;
        text = (await r.text()).slice(0, 200000);
        break;
      } catch {}
    }
    if (!text) return null;
    const head = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    const attr = (tag, name) => { const m = tag.match(new RegExp(name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')); return m ? (m[1] || m[2] || m[3] || '') : ''; };
    const cands = [];
    for (const m of head.matchAll(/<meta\b[^>]*>/gi)) { const k = (attr(m[0], 'property') || attr(m[0], 'name')).toLowerCase(); if (k === 'og:image' || k === 'twitter:image') cands.push(attr(m[0], 'content')); }
    const links = [];
    for (const m of head.matchAll(/<link\b[^>]*>/gi)) { const rel = attr(m[0], 'rel').toLowerCase(); if (/icon/.test(rel)) links.push({ rel, href: attr(m[0], 'href') }); }
    links.sort((a, b) => (/apple/.test(b.rel) ? 1 : 0) - (/apple/.test(a.rel) ? 1 : 0));
    for (const l of links) cands.push(l.href);
    for (const m of head.matchAll(/<img\b[^>]*>/gi)) { cands.push(attr(m[0], 'src')); if (cands.length > 8) break; }
    for (const c of cands.filter(Boolean).slice(0, 5)) {
      const img = await this.fetchImg(c, dirUrl);
      if (img) return img;
    }
    return null;
  }

  async steamThumb(title) {
    const norm = (x) => String(x).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
    const want = norm(title);
    if (want.length < 4) return null;
    try {
      const r = await tfetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&cc=us&l=en`, { headers: { 'User-Agent': 'chatroom-app' } }, 8000);
      if (!r.ok) return null;
      const j = await r.json();
      const hit = (j.items || []).find((i) => i.type === 'app' && norm(i.name) === want);
      if (!hit) return null;
      return await this.fetchImg(`https://cdn.akamai.steamstatic.com/steam/apps/${hit.id}/header.jpg`);
    } catch { return null; }
  }

  async fetchImg(ref, base) {
    try {
      if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,/i.test(ref)) {
        const m = ref.match(/^data:([^;]+);base64,(.*)$/is);
        const buf = Buffer.from(m[2], 'base64');
        return buf.length > 20 && buf.length < 600_000 ? { type: m[1], buf } : null;
      }
      const url = new URL(ref, base || undefined).toString();
      if (!/^https:/.test(url)) return null;
      const r = await tfetch(url, {}, 10000);
      if (!r.ok) return null;
      const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const buf = Buffer.from(await r.arrayBuffer());
      if (!/^image\//.test(type) || buf.length < 20 || buf.length > 600_000) return null;
      return { type, buf };
    } catch { return null; }
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
    const extra = EXTRAS.find((x) => x.id === path);
    if (extra) {
      const r = await tfetch(extra.raw + 'index.html', {}, 15000);
      if (!r.ok) throw new Error(`status ${r.status}`);
      const html = prepare((await r.text()).replace(/<base\s[^>]*>/i, ''), path, extra.cdn);
      this.cache.set(path, { at: Date.now(), html });
      return html;
    }
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
function prepare(html, path, baseUrl) {
  const dir = path.split('/').slice(0, -1).map(encodeURIComponent).join('/');
  const base = /<base\s/i.test(html) ? '' : `<base href="${baseUrl || `https://cdn.jsdelivr.net/gh/${REPO}@main/${dir}/`}">`; // relative assets resolve to the repo
  // sandboxed frames have no localStorage, so give games an in-memory one instead of crashing
  const shim = `<script>(function(){function mk(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}try{void navigator.serviceWorker}catch(e){try{delete Navigator.prototype.serviceWorker}catch(_){}}try{void window.localStorage}catch(e){try{Object.defineProperty(window,'localStorage',{value:mk(),configurable:true});Object.defineProperty(window,'sessionStorage',{value:mk(),configurable:true})}catch(_){}}})();</script>`;

  // play together: the host's page forwards a friend's keys and mouse here (only accepted from the parent page)
  const coop = `<script>(function(){var cur=null;function dot(c){if(!cur){cur=document.createElement('div');cur.style.cssText='position:fixed;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid #fff;pointer-events:none;z-index:2147483647;transition:left .05s,top .05s';(document.body||document.documentElement).appendChild(cur)}cur.style.background=c||'#e5855a';return cur}
function key(m){var t=document.activeElement&&document.activeElement!==document.body?document.activeElement:(document.body||document.documentElement);var e=new KeyboardEvent(m.type,{key:m.key,code:m.code,bubbles:true,cancelable:true,repeat:!!m.repeat});try{Object.defineProperty(e,'keyCode',{get:function(){return m.keyCode||0}});Object.defineProperty(e,'which',{get:function(){return m.keyCode||0}})}catch(x){}t.dispatchEvent(e)}
function mouse(m){var x=m.x*innerWidth,y=m.y*innerHeight,c=dot(m.color);c.style.left=x+'px';c.style.top=y+'px';var t=document.elementFromPoint(x,y)||document.body;var o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:m.button||0,buttons:m.type==='down'?1:0,view:window};var names=m.type==='move'?['pointermove','mousemove']:m.type==='down'?['pointerdown','mousedown']:['pointerup','mouseup','click'];names.forEach(function(n){var E=n.indexOf('pointer')===0&&window.PointerEvent?PointerEvent:MouseEvent;t.dispatchEvent(new E(n,o))})}
window.addEventListener('message',function(ev){if(ev.source!==parent)return;var m=ev.data;if(!m||!m.__coop)return;try{if(m.k==='key')key(m);else if(m.k==='mouse')mouse(m);else if(m.k==='wheel'){var t=document.elementFromPoint(m.x*innerWidth,m.y*innerHeight)||document.body;t.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:m.dy||0,clientX:m.x*innerWidth,clientY:m.y*innerHeight}))}}catch(e){}});})();<\/script>`;
  const act = `<script>(function(){var t=0;function a(){var n=Date.now();if(n-t<8000)return;t=n;try{parent.postMessage({__act:1},'*')}catch(e){}}['pointerdown','keydown','touchstart','wheel'].forEach(function(k){addEventListener(k,a,true)});a()})()</script>`;
  const inject = base + shim + coop + act;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + inject);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + '<head>' + inject + '</head>');
  return inject + html;
}

const MIME = { html: 'text/html; charset=utf-8', js: 'application/javascript; charset=utf-8', mjs: 'application/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', wasm: 'application/wasm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', zip: 'application/zip', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', txt: 'text/plain; charset=utf-8' };

function assetSource(dirName, rest) {
  const x = EXTRAS.find((e) => e.cdn === `/gx/${dirName}/`);
  if (!x) return null;
  const parts = String(rest || '').split('/').filter(Boolean);
  if (!parts.length || parts.some((q) => q === '..' || q === '.' || /[\\\0]/.test(q))) return null;
  const ext = (parts[parts.length - 1].split('.').pop() || '').toLowerCase();
  return { url: x.raw + parts.map(encodeURIComponent).join('/'), type: MIME[ext] || 'application/octet-stream' };
}

module.exports = { Games, REPO, assetSource, tfetch };

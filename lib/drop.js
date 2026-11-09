const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const FILE = path.join(os.tmpdir(), 'chatroom_drop_video');
const MAX_BYTES = 300 * 1024 * 1024;
const PRELOAD_MS = 180_000;

let cfg = { at: null, link: '', setBy: '' };
let vid = { state: 'none', bytes: 0, mime: 'video/mp4', error: '' };
let ctx = null;

const driveId = (link) => {
  const m = /\/d\/([A-Za-z0-9_-]{15,})/.exec(link) || /[?&]id=([A-Za-z0-9_-]{15,})/.exec(link);
  return m ? m[1] : null;
};
const resolveUrl = (link) => {
  const id = driveId(link);
  if (id && /drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com/.test(link)) return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
  if (/^https?:\/\//i.test(link)) return link;
  return null;
};

async function load() {
  const r = (await ctx.q("select value from settings where key='drop'")).rows[0];
  if (r) { try { cfg = { at: null, link: '', setBy: '', ...JSON.parse(r.value) }; } catch {} }
}
async function save() {
  await ctx.q("insert into settings(key,value) values('drop',$1) on conflict(key) do update set value=$1", [JSON.stringify(cfg)]);
}

async function fetchVideo() {
  vid = { state: 'fetching', bytes: 0, mime: 'video/mp4', error: '' };
  try { fs.rmSync(FILE, { force: true }); } catch {}
  const url = resolveUrl(cfg.link);
  if (!url) { vid = { ...vid, state: 'failed', error: 'that link does not look like a google drive or video link' }; return; }
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok || !res.body) throw new Error('could not download it (status ' + res.status + '). is the file shared as anyone with the link?');
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (type.includes('text/html')) throw new Error('google sent a web page instead of the video. set sharing to anyone with the link');
    const len = parseInt(res.headers.get('content-length') || '0', 10);
    if (len > MAX_BYTES) throw new Error('that file is over 300 MB');
    let got = 0;
    const counter = new (require('stream').Transform)({ transform(chunk, _e, cb) { got += chunk.length; vid.bytes = got; if (got > MAX_BYTES) return cb(new Error('that file is over 300 MB')); cb(null, chunk); } });
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(FILE));
    if (got < 2000) throw new Error('that file is too small to be a video');
    const head = Buffer.alloc(16); const fd = fs.openSync(FILE, 'r'); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd);
    const isMp4 = head.slice(4, 8).toString() === 'ftyp', isWebm = head[0] === 0x1a && head[1] === 0x45;
    if (!isMp4 && !isWebm) throw new Error('that file is not an mp4 or webm video');
    vid = { state: 'ready', bytes: got, mime: isWebm ? 'video/webm' : 'video/mp4', error: '' };
  } catch (e) {
    try { fs.rmSync(FILE, { force: true }); } catch {}
    vid = { state: 'failed', bytes: 0, mime: 'video/mp4', error: String(e.message || e).slice(0, 200) };
  }
}

const key = () => crypto.createHmac('sha256', ctx.secret()).update('drop:' + cfg.at + ':' + vid.bytes).digest('hex').slice(0, 32);
const released = () => !!cfg.at && Date.now() >= cfg.at;
const on = (user) => released() || !!(user && user.is_admin);

function pub() {
  return { at: cfg.at, now: Date.now(), hasVideo: vid.state === 'ready', released: released() };
}
function broadcast() {
  for (const id of ctx.sockets.keys()) ctx.sendTo(id, { t: 'drop_update', drop: pub() });
}

function mount(app, c) {
  ctx = c;
  const { auth, adminOnly, ownerOnly, byUser, bad, wrap, rl } = c;

  app.get('/api/drop', rl('drop-get', 120, 60_000), wrap(async (req, res) => { res.json(pub()); }));

  app.get('/api/drop/video-url', auth, byUser('drop-url', 30, 60_000), wrap(async (req, res) => {
    if (vid.state !== 'ready' || !cfg.at) return bad(res, 'no video', 404);
    if (Date.now() < cfg.at - PRELOAD_MS && !req.user.is_admin) return bad(res, 'too early', 403);
    res.json({ url: `/api/drop/video?k=${key()}`, bytes: vid.bytes });
  }));

  app.get('/api/drop/video', rl('drop-vid', 120, 60_000), (req, res) => {
    if (vid.state !== 'ready' || !cfg.at || req.query.k !== key()) return res.status(404).end();
    let size;
    try { size = fs.statSync(FILE).size; } catch { return res.status(404).end(); }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    const base = { 'Content-Type': vid.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' };
    if (!range) { res.writeHead(200, { ...base, 'Content-Length': size }); return fs.createReadStream(FILE).pipe(res); }
    let start = range[1] === '' ? Math.max(0, size - parseInt(range[2], 10)) : parseInt(range[1], 10);
    let end = range[1] === '' || range[2] === '' ? size - 1 : Math.min(parseInt(range[2], 10), size - 1);
    if (!(start >= 0) || start >= size || end < start) return res.status(416).set('Content-Range', `bytes */${size}`).end();
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(FILE, { start, end }).pipe(res);
  });

  app.get('/api/admin/drop', auth, adminOnly, wrap(async (req, res) => {
    res.json({ ...pub(), link: req.user.username === c.ownerName ? cfg.link : '', video: { state: vid.state, bytes: vid.bytes, error: vid.error }, isOwner: req.user.username === c.ownerName });
  }));

  app.put('/api/admin/drop', auth, adminOnly, ownerOnly, byUser('drop-set', 20, 3_600_000), wrap(async (req, res) => {
    const b = req.body || {};
    const link = b.link === undefined ? cfg.link : String(b.link || '').trim().slice(0, 500);
    if (b.link !== undefined && link && !resolveUrl(link)) return bad(res, 'paste a google drive share link or a direct video link');
    let at = cfg.at;
    if (b.at !== undefined) {
      if (b.at === null) at = null;
      else {
        at = Number(b.at);
        if (!Number.isFinite(at)) return bad(res, 'bad time');
        if (at < Date.now() + 20_000) return bad(res, 'pick a time at least a minute from now');
        if (at > Date.now() + 90 * 86400_000) return bad(res, 'that is too far away');
      }
    }
    const linkChanged = link !== cfg.link;
    cfg = { at, link, setBy: req.user.username };
    await save();
    if (linkChanged || (link && vid.state === 'none')) { if (link) fetchVideo().then(broadcast); else { vid = { state: 'none', bytes: 0, mime: 'video/mp4', error: '' }; try { fs.rmSync(FILE, { force: true }); } catch {} } }
    broadcast();
    res.json({ ...pub(), link: cfg.link, video: { state: vid.state, bytes: vid.bytes, error: vid.error } });
  }));

  app.delete('/api/admin/drop', auth, adminOnly, ownerOnly, wrap(async (req, res) => {
    cfg = { at: null, link: '', setBy: req.user.username };
    vid = { state: 'none', bytes: 0, mime: 'video/mp4', error: '' };
    try { fs.rmSync(FILE, { force: true }); } catch {}
    await save();
    broadcast();
    res.json({ ok: true });
  }));
}

async function start() {
  await load();
  if (cfg.link && cfg.at && cfg.at > Date.now() - 6 * 3600_000) fetchVideo().then(broadcast).catch(() => {});
}

module.exports = { mount, start, on, released, pub };

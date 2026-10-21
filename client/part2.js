/* ===== Chatroom client: core (helpers, crypto, state, api, realtime, data) ===== */
(() => {
'use strict';

// ---------- config ----------
// when loaded through loader.html the server url is injected as window.CHATROOM_ORIGIN
const API = String(window.CHATROOM_ORIGIN || location.origin).replace(/\/+$/, '');
const WSURL = API.replace(/^http/, 'ws') + '/ws';
const SAME_ORIGIN = API === location.origin;               // web push needs a service worker on the server's own origin

// ---------- tiny dom helpers ----------
// el('div', {class:'x', onclick: fn}, 'text', childNode) - builds nodes with textContent only (no innerHTML, so no xss)
// append/replaceChildren would print "null" for empty slots, so skip null/false/undefined everywhere
for (const k of ['append', 'prepend', 'replaceChildren']) { const o = Element.prototype[k]; Element.prototype[k] = function (...a) { return o.apply(this, a.flat(9).filter((x) => x != null && x !== false)); }; }
const el = (tag, props, ...kids) => {
  const n = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;                // skip empty props
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k in n) { try { n[k] = v; } catch { n.setAttribute(k, v); } }
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(9)) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
};
const $ = (sel, root = document) => root.querySelector(sel);

// icons are static svg strings defined here (never user data)
const ICONS = {
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  gamepad: '<line x1="6" x2="10" y1="12" y2="12"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="15" x2="15.01" y1="13" y2="13"/><line x1="18" x2="18.01" y1="11" y2="11"/><rect width="20" height="12" x="2" y="6" rx="2"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  sliders: '<line x1="4" x2="20" y1="7" y2="7"/><line x1="4" x2="20" y1="17" y2="17"/><circle cx="9" cy="7" r="2.5"/><circle cx="15" cy="17" r="2.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/><path d="M10 15v3M14 15v3M8 22h8"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="23" x2="17" y1="9" y2="15"/><line x1="17" x2="23" y1="9" y2="15"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  coffee: '<path d="M10 2v2M14 2v2M6 2v2"/><path d="M5 8h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M20 17v4H6.5A2.5 2.5 0 0 1 4 18.5"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z"/><path d="M2 21c0-3 1.9-5.4 5.1-6.4C9.5 13.9 12 13 12 13"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3 0 1.4 1 2.5 2.5 2.5z"/>',
  headphones: '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><path d="M21 16a2 2 0 0 1-2 2h-1v-6h3zM3 16a2 2 0 0 0 2 2h1v-6H3z"/>',
  pizza: '<path d="M15 11h.01M11 15h.01M16 16h.01M2 16l20 6-6-20A20 20 0 0 0 2 16z"/><path d="M5.7 12.5a14 14 0 0 1 6-6.5"/>',
  crown: '<path d="m2 18 2-11 5 5 3-8 3 8 5-5 2 11z"/><path d="M3 21h18"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  eyeoff: '<path d="M9.9 4.2A10 10 0 0 1 12 4c7 0 10 8 10 8a13 13 0 0 1-1.7 2.7M6.6 6.6A13 13 0 0 0 2 12s3 8 10 8a9.7 9.7 0 0 0 5.4-1.6"/><path d="m2 2 20 20"/>',
  timer: '<circle cx="12" cy="14" r="8"/><path d="M12 10v4l2 2M9 2h6"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.300 0-1.100.900-2 2-2h2.300c3 0 5.200-2.200 5.200-5.200C22 6 17.500 2 12 2z"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9a2 2 0 0 1-1.1-1.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  flag: '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 8 2a6 6 0 0 0 4-1v12a6 6 0 0 1-4 1c-3 0-5-2-8-2a6 6 0 0 0-4 1"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  checksquare: '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  newspaper: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3-6.2 3.3L8 14.2 3 9.3l6.9-1z"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
};
const ic = (name, size = 18) => {
  const s = document.createElement('span');
  s.className = 'ic';
  s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return s;
};

const hue = (str) => { let h = 0; for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const TONES = ['#b4532e', '#7a8c55', '#b8843a', '#8c5a6c', '#587a82', '#a2644a', '#6c7596', '#8f6a3a', '#6d8a6a', '#9c5b52'];   // earthy, muted, no neon
const tone = (str) => TONES[hue(str) % TONES.length];
const avatar = (name, size = 40, extra = '') => el('div', { class: 'avatar ' + extra, style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.46)}px;background:${tone(name)}` }, (String(name).trim()[0] || '?').toLowerCase());
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (d) => { d = new Date(d); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDay = (d) => { d = new Date(d); const t = new Date(); const y = new Date(Date.now() - 864e5); if (d.toDateString() === t.toDateString()) return 'Today'; if (d.toDateString() === y.toDateString()) return 'Yesterday'; return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' }); };
const fmtDur = (s) => { s = Math.max(0, Math.round(s)); if (s < 60) return s + 's'; const m = Math.floor(s / 60); if (m < 60) return m + 'm'; const h = Math.floor(m / 60); return h + 'h ' + (m % 60) + 'm'; };
const ago = (d) => fmtDur((Date.now() - new Date(d)) / 1000) + ' ago';
const rid = () => Math.random().toString(36).slice(2, 10);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch {} };

// ---------- crypto (webcrypto only, nothing leaves the browser unencrypted) ----------
const enc = new TextEncoder(), dec = new TextDecoder();
const subtle = window.crypto && crypto.subtle;
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const b64 = (buf) => { const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const EC = { name: 'ECDH', namedCurve: 'P-256' };

// one pbkdf2 run gives 64 bytes: first half = login secret (sent), second half = key-wrapping key (never sent)
async function kdf(password, saltB64) {
  const base = await subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: 310000 }, base, 512));
  const wrapKey = await subtle.importKey('raw', bits.slice(32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { authSecret: b64(bits.slice(0, 32)), wrapKey };
}
// make the account identity key pair; the private half is stored encrypted on the server so you can log in anywhere
async function newIdentity(wrapKey) {
  const kp = await subtle.generateKey(EC, true, ['deriveBits']);
  const pkcs8 = await subtle.exportKey('pkcs8', kp.privateKey);
  const iv = rand(12);
  const wrapped = await subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, pkcs8);
  const priv = await subtle.importKey('pkcs8', pkcs8, EC, false, ['deriveBits']); // non-extractable copy for daily use
  return { priv, pub: b64(await subtle.exportKey('raw', kp.publicKey)), wrappedPriv: b64(wrapped), wrappedPrivIv: b64(iv) };
}
async function openIdentity(wrappedPriv, iv, wrapKey) {
  const pkcs8 = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, wrapKey, unb64(wrappedPriv));
  return subtle.importKey('pkcs8', pkcs8, EC, false, ['deriveBits']);
}

const S = {                                                  // app state
  token: null, me: null, priv: null, convs: [], keyUsers: {}, active: null, view: 'chats',
  ttlHours: 48, presence: new Map(), typing: new Map(), notifs: [], notifUnread: 0, ws: null, wsOk: false,
  cooldownUntil: 0, nowPlaying: [], prefs: { sound: true, desktop: true },
};
const skCache = new Map(), convKeys = new Map();

// ecdh -> hkdf -> aes-gcm key shared between me and one other public key
async function sharedKey(theirPub, info) {
  const ck = theirPub + '|' + info;
  if (skCache.has(ck)) return skCache.get(ck);
  const theirs = await subtle.importKey('raw', unb64(theirPub), EC, false, []);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: theirs }, S.priv, 256);
  const hk = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  skCache.set(ck, key);
  return key;
}
// group key (32 random bytes) encrypted for one member
async function wrapGroupKey(raw, recipientPub, recipientId) {
  const k = await sharedKey(recipientPub, 'chatroom-wrap-v1');
  const iv = rand(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(S.me.id + '>' + recipientId) }, k, raw);
  return { wrappedKey: b64(ct), iv: b64(iv) };
}
async function unwrapGroupKey(entry) {
  const wrapperPub = entry.wrappedBy === S.me.id ? S.me.publicKey : (S.keyUsers[entry.wrappedBy] || {}).publicKey;
  if (!wrapperPub) throw new Error('unknown key wrapper');
  const k = await sharedKey(wrapperPub, 'chatroom-wrap-v1');
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(entry.iv), additionalData: enc.encode(entry.wrappedBy + '>' + S.me.id) }, k, unb64(entry.wrappedKey)));
}
async function keyFor(conv, version) {
  const id = conv.id + ':' + version;
  if (convKeys.has(id)) return convKeys.get(id);
  let entry;
  if (conv.type === 'dm') {
    const other = conv.members.find((m) => m.id !== S.me.id);
    entry = { key: await sharedKey(other.publicKey, 'chatroom-dm-v1|' + [S.me.id, other.id].sort().join(':')) };
  } else if (conv.isPublic) {                                // public rooms: anyone can join, so the key is derived from the room id (readable by the server, by design)
    const raw = new Uint8Array(await subtle.digest('SHA-256', enc.encode('chatroom-public-v1|' + conv.id)));
    entry = { raw, key: await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']) };
  } else {
    const ke = conv.keys.find((k) => k.version === version);
    if (!ke) throw new Error('no key for version ' + version);
    const raw = await unwrapGroupKey(ke);
    entry = { raw, key: await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']) };
  }
  convKeys.set(id, entry);
  return entry;
}
// aad binds each ciphertext to its conversation, sender and key version (server cannot move messages around)
async function encryptPayload(conv, payload) {
  const version = conv.keyVersion;
  const { key } = await keyFor(conv, version);
  const iv = rand(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`${conv.id}|${S.me.id}|${version}`) }, key, enc.encode(JSON.stringify(payload)));
  return { ciphertext: b64(ct), iv: b64(iv), keyVersion: version };
}
async function decryptMsg(conv, m) {
  if (m.deleted) return (m._p = { t: 'deleted' });
  if (m._p) return m._p;
  try {
    const { key } = await keyFor(conv, m.keyVersion);
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(m.iv), additionalData: enc.encode(`${conv.id}|${m.senderId}|${m.keyVersion}`) }, key, unb64(m.ciphertext));
    m._p = JSON.parse(dec.decode(pt));
  } catch { m._p = { t: 'error' }; }
  return m._p;
}
// 60 digit number both people can compare out loud to confirm nobody swapped keys
async function safetyNumber(pubA, pubB) {
  const [a, b] = [pubA, pubB].sort();
  const h = new Uint8Array(await subtle.digest('SHA-256', enc.encode(a + '|' + b)));
  const g = [];
  for (let i = 0; i < 24; i += 2) g.push(String(((h[i] << 8) | h[i + 1]) % 100000).padStart(5, '0'));
  return g.join(' ');
}

// ---------- indexeddb (keeps the unlocked, non-extractable private key between reloads) ----------
const idb = () => new Promise((ok, no) => { const r = indexedDB.open('chatroom', 1); r.onupgradeneeded = () => r.result.createObjectStore('keys'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const idbGet = async (k) => { try { const db = await idb(); return await new Promise((ok, no) => { const r = db.transaction('keys').objectStore('keys').get(k); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); } catch { return undefined; } };
const idbSet = async (k, v) => { try { const db = await idb(); await new Promise((ok, no) => { const t = db.transaction('keys', 'readwrite'); t.objectStore('keys').put(v, k); t.oncomplete = ok; t.onerror = () => no(t.error); }); } catch {} };
const idbDel = async (k) => { try { const db = await idb(); await new Promise((ok) => { const t = db.transaction('keys', 'readwrite'); t.objectStore('keys').delete(k); t.oncomplete = ok; t.onerror = ok; }); } catch {} };

// ---------- emoji (shown as twemoji images so they look the same on windows, mac and phones) ----------
const EMOJI_SRC = '+1 👍|-1 👎|smile 😄|grin 😁|joy 😂|rofl 🤣|sweat_smile 😅|wink 😉|blush 😊|heart_eyes 😍|kissing_heart 😘|yum 😋|zany 🤪|thinking 🤔|shush 🤫|neutral_face 😐|expressionless 😑|unamused 😒|roll_eyes 🙄|smirk 😏|pleading 🥺|sob 😭|cry 😢|angry 😠|rage 😡|scream 😱|flushed 😳|sleeping 😴|sunglasses 😎|nerd 🤓|cold 🥶|hot 🥵|sick 🤢|mask 😷|salute 🫡|melting 🫠|party 🥳|skull 💀|skull_crossbones ☠️|ghost 👻|clown 🤡|poop 💩|alien 👽|robot 🤖|moai 🗿|fire 🔥|sparkles ✨|star ⭐|boom 💥|100 💯|zap ⚡|rainbow 🌈|sun ☀️|moon 🌙|snowflake ❄️|sweat 💦|heart ❤️|orange_heart 🧡|yellow_heart 💛|green_heart 💚|blue_heart 💙|purple_heart 💜|black_heart 🖤|broken_heart 💔|sparkling_heart 💖|thumbsup 👍|thumbsdown 👎|clap 👏|wave 👋|pray 🙏|muscle 💪|ok_hand 👌|v ✌️|crossed_fingers 🤞|point_up ☝️|point_right 👉|raised_hands 🙌|handshake 🤝|eyes 👀|brain 🧠|tada 🎉|balloon 🎈|gift 🎁|trophy 🏆|medal 🏅|crown 👑|gem 💎|money 💰|game 🎮|dice 🎲|music 🎵|headphones 🎧|guitar 🎸|pizza 🍕|burger 🍔|fries 🍟|taco 🌮|cake 🍰|cookie 🍪|coffee ☕|tea 🍵|beer 🍺|cat 🐱|dog 🐶|fox 🦊|panda 🐼|frog 🐸|unicorn 🦄|bee 🐝|butterfly 🦋|flower 🌸|rose 🌹|tree 🌳|cactus 🌵|mushroom 🍄|apple 🍎|banana 🍌|strawberry 🍓|watermelon 🍉|rocket 🚀|car 🚗|plane ✈️|house 🏠|bulb 💡|bomb 💣|hammer 🔨|wrench 🔧|key 🔑|lock 🔒|bell 🔔|mag 🔍|phone 📱|computer 💻|camera 📷|book 📖|pencil ✏️|memo 📝|calendar 📅|check ✅|x ❌|warning ⚠️|question ❓|exclamation ❗|no_entry ⛔|recycle ♻️|hourglass ⌛|alarm ⏰|soccer ⚽|basketball 🏀|football 🏈|tennis 🎾|bowling 🎳|chains ⛓️';
const EMOJI = new Map(EMOJI_SRC.split('|').map((x) => { const i = x.indexOf(' '); return [x.slice(0, i), x.slice(i + 1)]; }));
const EMOJI_LIST = [...EMOJI];
const QUICK_REACTS = ['thumbsup', 'heart', 'joy', 'skull', 'fire', 'tada', 'eyes', 'pray'].map((n) => EMOJI.get(n));
const emojiUrl = (ch) => { const str = ch.indexOf('‍') < 0 ? ch.replace(/️/g, '') : ch; return 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/' + [...str].map((c) => c.codePointAt(0).toString(16)).join('-') + '.svg'; };
const emojiEl = (ch, cls = '') => { const i = el('img', { class: 'emoji ' + cls, src: emojiUrl(ch), alt: ch, draggable: false }); i.onerror = () => i.replaceWith(document.createTextNode(ch)); return i; };
const EMOJI_RE = /((?:\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])?)(?:‍\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])?)*|[\u{1F1E6}-\u{1F1FF}]{2})/gu;
// turns emoji characters inside text into image nodes, everything else stays text
function emojify(text, cls = '') {
  const out = []; let last = 0; const str = String(text);
  for (const m of str.matchAll(EMOJI_RE)) {
    if (m[0].codePointAt(0) < 0x203c) continue;           // (c) (r) (tm) stay as plain text
    if (m.index > last) out.push(str.slice(last, m.index));
    out.push(emojiEl(m[0], cls)); last = m.index + m[0].length;
  }
  if (last < str.length) out.push(str.slice(last));
  return out;
}
const onlyEmoji = (t) => { const s = String(t).trim(); if (!s) return false; const r = s.replace(EMOJI_RE, '').trim(); return r === '' && (s.match(EMOJI_RE) || []).length <= 3; };
const expandShortcodes = (t) => String(t).replace(/:([a-z0-9_+-]{1,24}):/gi, (all, n) => EMOJI.get(n.toLowerCase()) || all);
const GIF_HOSTS = ['tenor.com', 'giphy.com', 'klipy.com', 'klipy.co', 'imgur.com'];
const gifOk = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && GIF_HOSTS.some((d) => x.hostname === d || x.hostname.endsWith('.' + d)); } catch { return false; } };
const betaActive = () => !!(S.me && (S.me.isAdmin || (S.me.betaUntil && new Date(S.me.betaUntil) > new Date())));

// ---------- toasts, sound, notifications ----------
function toast(msg, kind = 'info', onclick) {
  let box = $('#toasts');
  if (!box) { box = el('div', { id: 'toasts' }); document.body.append(box); }
  const gone = () => { t.classList.add('out'); setTimeout(() => t.remove(), 240); };
  const t = el('div', { class: 'toast ' + kind, onclick: () => { gone(); onclick && onclick(); } }, el('span', null, msg));
  box.append(t);
  setTimeout(gone, kind === 'error' ? 6000 : 4500);
}
let actx;
function beep() {
  if (!S.prefs.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(880, actx.currentTime); o.frequency.setValueAtTime(1175, actx.currentTime + 0.08);
    g.gain.setValueAtTime(0.0001, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.12, actx.currentTime + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.22);
    o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.25);
  } catch {}
}
function updateBadge() {
  const n = S.convs.reduce((a, c) => a + (c.muted ? 0 : c.unread || 0), 0);
  document.title = (n ? `(${n}) ` : '') + 'chatroom';
  return n;
}

// ---------- api ----------
async function api(method, path, body, opts = {}) {
  let res;
  try {
    res = await fetch(API + path, { method, keepalive: !!opts.keepalive, headers: { ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch (e) { const err = new Error('cannot reach the server'); err.network = true; throw err; }
  let data = null; try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error((data && (data.message || data.error)) || res.statusText);
    err.status = res.status; err.data = data || {};
    if (res.status === 401 && S.token && !opts.quiet) window.__chatroomLogout && window.__chatroomLogout(true);
    if (res.status === 429 && !opts.quiet) toast(`slow down - try again in ${err.data.retryAfter || '?'}s`, 'error');
    throw err;
  }
  return data;
}

// ---------- conversations + messages ----------
const convOf = (id) => S.convs.find((c) => c.id === id);
const other = (c) => c.members.find((m) => m.id !== S.me.id) || c.members[0];
const convTitle = (c) => (c.type === 'group' ? c.name : (other(c) || {}).displayName || 'Unknown');
const memberOf = (c, id) => c.members.find((m) => m.id === id);

function previewText(p, mine) {
  if (!p) return '';
  const pre = mine ? 'You: ' : '';
  if (p.t === 'text') return pre + p.text;
  if (p.t === 'game') return pre + 'shared a game: ' + p.title;
  if (p.t === 'gif') return pre + 'sent a gif';
  if (p.t === 'deleted') return 'message deleted';
  return 'encrypted message';
}
async function refreshPreview(c) {
  if (!c.lastMessage) { c._preview = ''; return; }
  const p = await decryptMsg(c, c.lastMessage);
  c._preview = previewText(p, c.lastMessage.senderId === S.me.id);
}
const sortConvs = () => S.convs.sort((a, b) => new Date((b.lastMessage || b).createdAt) - new Date((a.lastMessage || a).createdAt));

function mergeConvs(list, replaceAll) {
  const old = new Map(S.convs.map((c) => [c.id, c]));
  const next = list.map((c) => {
    const o = old.get(c.id);
    if (o) { const keep = { msgs: o.msgs, hasMore: o.hasMore, loaded: o.loaded, draft: o.draft, _preview: o._preview }; Object.assign(o, c, keep); return o; }
    return Object.assign(c, { msgs: [], hasMore: false, loaded: false, draft: '', _preview: '' });
  });
  if (replaceAll) S.convs = next; else for (const c of next) if (!old.has(c.id)) S.convs.push(c);
  sortConvs();
  return next;
}
async function loadConvs() {
  const d = await api('GET', '/api/conversations');
  Object.assign(S.keyUsers, d.keyUsers);
  const list = mergeConvs(d.conversations, true);
  await Promise.all(list.map(refreshPreview));
  window.__ui.renderSide();
}
async function loadMessages(c, older) {
  const before = older && c.msgs.length ? c.msgs[0].id : '';
  const d = await api('GET', `/api/conversations/${c.id}/messages?limit=50${before ? '&before=' + before : ''}`);
  await Promise.all(d.messages.map((m) => decryptMsg(c, m)));
  c.msgs = older ? d.messages.concat(c.msgs) : d.messages;
  c.hasMore = d.hasMore; c.loaded = true;
}
function addMessage(c, msg, payload) {
  if (c.msgs.some((m) => m.id === msg.id)) return false;
  if (payload) msg._p = payload;
  c.msgs.push(msg);
  c.msgs.sort((a, b) => a.id - b.id);
  c.lastMessage = msg;
  return true;
}
function startCooldown(sec, msg) {
  S.cooldownUntil = Date.now() + sec * 1000;
  toast(msg || `slow down - wait ${sec}s`, 'error');
  window.__ui.tickCooldown();
}
async function sendPayload(c, payload, retried) {
  if (S.cooldownUntil > Date.now()) { toast('you are on cooldown, wait a moment', 'error'); return false; }
  try {
    const e = await encryptPayload(c, payload);
    const r = await api('POST', `/api/conversations/${c.id}/messages`, { ...e, cid: rid() }, { quiet: true });
    if (addMessage(c, r.message, payload)) { c._preview = previewText(payload, true); sortConvs(); }
    window.__ui.renderSide(); window.__ui.renderMessages(c, true);
    return true;
  } catch (err) {
    if (err.status === 429) startCooldown(err.data.retryAfter || 5, err.data.message);
    else if (err.status === 409 && err.data.error === 'key_version_stale' && !retried) { await loadConvs(); return sendPayload(convOf(c.id), payload, true); }
    else if (err.status === 401) window.__chatroomLogout(true);
    else toast(err.message, 'error');
    return false;
  }
}
async function markRead(c) {
  if (!c) return;
  const had = c.unread;
  c.unread = 0;
  window.__ui.renderSide(); updateBadge(); window.__ui.renderRail();
  if (had || !c._readSent) { c._readSent = true; api('POST', `/api/conversations/${c.id}/read`, null, { quiet: true }).catch(() => {}); }
}

// ---------- realtime ----------
let wsTimer, wsBackoff = 1000, hb;
function connectWS() {
  clearTimeout(wsTimer);
  if (!S.token) return;
  const ws = new WebSocket(WSURL);
  S.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token: S.token }));
  ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } onWS(m).catch((e) => console.error('ws handler', e)); };
  ws.onclose = (ev) => {
    S.wsOk = false; clearInterval(hb); window.__ui && window.__ui.renderRail();
    if (ev.code === 4001) return window.__chatroomLogout(true);   // token rejected
    if (S.token) { wsTimer = setTimeout(connectWS, wsBackoff); wsBackoff = Math.min(wsBackoff * 2, 15000); }
  };
  ws.onerror = () => {};
}
const sendWS = (o) => { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)); };

async function onWS(m) {
  const ui = window.__ui;
  switch (m.t) {
    case 'ready':
      S.wsOk = true; wsBackoff = 1000;
      clearInterval(hb); hb = setInterval(() => sendWS({ t: 'ping' }), 25000);
      await loadConvs().catch(() => {});                     // resync after (re)connect
      api('GET', '/api/presence', null, { quiet: true }).then((d) => { for (const p of d.presence) S.presence.set(p.userId, p); ui.renderAll(); }).catch(() => {});
      ui.renderAll();
      break;
    case 'msg': {
      const c = convOf(m.convId);
      if (!c) { await loadConvs(); return; }
      const mine = m.message.senderId === S.me.id;
      if (!c.loaded && !mine) { c.lastMessage = m.message; }
      const payload = await decryptMsg(c, m.message);
      if (c.loaded) addMessage(c, m.message); else c.lastMessage = m.message;
      c._preview = previewText(payload, mine);
      sortConvs();
      if (!mine) {
        const viewing = S.view === 'chats' && S.active === c.id && !document.hidden;
        const t = S.typing.get(c.id); if (t) { t.delete(m.message.senderId); }
        if (viewing) markRead(c);
        else { c.unread = (c.unread || 0) + 1; if (!m.muted) ui.notifyMessage(c, m.message, payload); }
        updateBadge();
      }
      ui.renderSide(); ui.renderRail(); if (S.active === c.id) ui.renderMessages(c, mine);
      break;
    }
    case 'msg_deleted': {
      const c = convOf(m.convId); if (!c) return;
      const x = c.msgs.find((y) => y.id === m.id); if (x) { x.deleted = true; x._p = { t: 'deleted' }; }
      if (c.lastMessage && c.lastMessage.id === m.id) { c.lastMessage.deleted = true; c._preview = 'message deleted'; }
      ui.renderSide(); if (S.active === c.id) ui.renderMessages(c);
      break;
    }
    case 'msgs_deleted': {                                   // one or many deleted at once
      const c = convOf(m.convId); if (!c) return;
      for (const id of m.ids) { const x = c.msgs.find((y) => y.id === id); if (x) { x.deleted = true; x._p = { t: 'deleted' }; x.pinned = false; x.reactions = {}; } if (c.lastMessage && c.lastMessage.id === id) { c.lastMessage.deleted = true; c._preview = 'message deleted'; } }
      ui.renderSide(); if (S.active === c.id) ui.renderMessages(c);
      break;
    }
    case 'reaction': {
      const c = convOf(m.convId); const x = c && c.msgs.find((y) => y.id === m.msgId); if (!x) return;
      x.reactions = x.reactions || {};
      const list = (x.reactions[m.emoji] = x.reactions[m.emoji] || []);
      const at = list.indexOf(m.userId);
      if (m.on && at < 0) list.push(m.userId); else if (!m.on && at >= 0) list.splice(at, 1);
      if (!list.length) delete x.reactions[m.emoji];
      if (S.active === c.id) ui.renderMessages(c);
      break;
    }
    case 'pin': {
      const c = convOf(m.convId); if (!c) return;
      const x = c.msgs.find((y) => y.id === m.msgId); if (x) x.pinned = m.on;
      c._pinsAt = 0;                                          // pins list is stale, refetch next time
      if (S.active === c.id) { ui.renderMessages(c); window.__ui.renderPins && window.__ui.renderPins(c); }
      break;
    }
    case 'reports_changed': if (window.__ui.reportsChanged) window.__ui.reportsChanged(); break;
    case 'typing': {
      const c = convOf(m.convId); if (!c) return;
      let t = S.typing.get(c.id); if (!t) { t = new Map(); S.typing.set(c.id, t); }
      clearTimeout(t.get(m.userId));
      t.set(m.userId, setTimeout(() => { t.delete(m.userId); ui.renderTyping(); }, 3500));
      ui.renderTyping();
      break;
    }
    case 'me_update': {
      const me = await api('GET', '/api/me', null, { quiet: true }).catch(() => null);
      if (me) { Object.assign(S.me, me.user); S.ttlHours = me.ttlHours || S.ttlHours; S.referral = me.referral; window.__ext && window.__ext.applyTheme(); ui.renderAll(); }
      break;
    }
    case 'presence': S.presence.set(m.userId, m); ui.renderSide(); ui.renderHeader(); ui.renderActivityLive(); break;
    case 'read': {
      const c = convOf(m.convId); if (!c) return;
      const mem = memberOf(c, m.userId); if (mem) mem.lastReadAt = m.at;
      if (S.active === c.id) ui.renderMessages(c);
      break;
    }
    case 'conv_added': {
      Object.assign(S.keyUsers, m.keyUsers || {});
      const list = mergeConvs(m.conversations, false);
      await Promise.all(list.map(refreshPreview));
      ui.renderAll();
      break;
    }
    case 'conv_update': {
      if (m.refresh) { await loadConvs(); ui.renderAll(); break; }
      const c = convOf(m.convId); if (c && m.name) c.name = m.name;
      ui.renderAll();
      break;
    }
    case 'conv_removed': {
      S.convs = S.convs.filter((c) => c.id !== m.convId);
      if (S.active === m.convId) { S.active = null; }
      ui.renderAll();
      break;
    }
    case 'notif': {
      S.notifs.unshift(m.notif); S.notifUnread++;
      ui.renderRail();
      const txt = m.notif.type === 'group_added' ? `${m.notif.data.by} added you to ${m.notif.data.name}` : m.notif.type === 'dm_new' ? `${m.notif.data.from} started a chat with you` : m.notif.type === 'referral' ? `${m.notif.data.name} joined, +${m.notif.data.minutes} min beta` : m.notif.type === 'report' ? 'new report to review' : 'new notification';
      toast(txt, 'info', () => { if (m.notif.data.convId) ui.openConv(m.notif.data.convId); });
      beep();
      break;
    }
  }
}

window.__core = { API, SAME_ORIGIN, S, el, $, ic, avatar, fmtTime, fmtDay, fmtDur, ago, rid, debounce, lsGet, lsSet, lsDel, toast, beep, updateBadge, api, kdf, newIdentity, openIdentity, wrapGroupKey, encryptPayload, decryptMsg, safetyNumber, idbGet, idbSet, idbDel, convOf, other, convTitle, memberOf, keyFor, previewText, refreshPreview, sortConvs, mergeConvs, loadConvs, loadMessages, addMessage, sendPayload, markRead, connectWS, sendWS, rand, b64, unb64, subtle, skCache, convKeys, startCooldown, hue, tone, EMOJI, EMOJI_LIST, QUICK_REACTS, emojiEl, emojify, onlyEmoji, expandShortcodes, gifOk, betaActive };
})();

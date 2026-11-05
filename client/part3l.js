(() => {
'use strict';
const C = window.__core, U = window.__ui, X = window.__ext, G = window.__mcgen;
const { S, el, ic, toast, sendWS, api } = C;
const { H, CS, B } = G;

let live = null;

const ck = (cx, cz) => cx + ',' + cz;
const TILE_NAMES = ['grass top', 'grass side', 'dirt', 'stone', 'sand', 'log side', 'log top', 'leaves', 'planks', 'water', 'bedrock', 'cobble', 'bricks', 'glass', 'lamp'];
const faceTile = (b, f) => {
  switch (b) {
    case B.GRASS: return f === 2 ? 0 : f === 3 ? 2 : 1;
    case B.DIRT: return 2;
    case B.STONE: return 3;
    case B.SAND: return 4;
    case B.LOG: return f === 2 || f === 3 ? 6 : 5;
    case B.LEAVES: return 7;
    case B.PLANKS: return 8;
    case B.WATER: return 9;
    case B.BEDROCK: return 10;
    case B.COBBLE: return 11;
    case B.BRICK: return 12;
    case B.GLASS: return 13;
    case B.LAMP: return 14;
  }
  return 3;
};
const iconTile = (b) => (b === B.GRASS ? 1 : b === B.LOG ? 5 : faceTile(b, 0));
const SHADE = [0.82, 0.82, 1, 0.55, 0.7, 0.7];
const FACES = [
  { d: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { d: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { d: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { d: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { d: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { d: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];
const UVS = [[0, 1], [1, 1], [1, 0], [0, 0]];

function makeAtlas() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 16;
  const g = cv.getContext('2d');
  const px = (t, x, y, r, gg, b, a) => { g.fillStyle = `rgba(${r | 0},${gg | 0},${b | 0},${a === undefined ? 1 : a})`; g.fillRect(t * 16 + x, y, 1, 1); };
  const n = (x, y, t, k) => (G.hash(x, y, t * 31 + 5) - 0.5) * k;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let v = n(x, y, 0, 36); px(0, x, y, 88 + v, 160 + v, 54 + v);
    const gr = y < 3 + (G.hash(x, 0, 77) < 0.45 ? 1 : 0);
    v = n(x, y, 1, 30); gr ? px(1, x, y, 88 + v, 158 + v, 54 + v) : px(1, x, y, 134 + v, 96 + v, 67 + v);
    v = n(x, y, 2, 30); px(2, x, y, 134 + v, 96 + v, 67 + v);
    v = n(x, y, 3, 34); px(3, x, y, 125 + v, 125 + v, 125 + v);
    v = n(x, y, 4, 22); px(4, x, y, 219 + v, 207 + v, 140 + v);
    v = n(x, y, 5, 20); const st = x % 4 === 0 ? -22 : 0; px(5, x, y, 106 + v + st, 78 + v + st, 46 + v + st);
    const r = Math.hypot(x - 7.5, y - 7.5); v = n(x, y, 6, 14); const ring = (Math.floor(r) % 3 === 0) ? -26 : 0; px(6, x, y, 170 + v + ring, 140 + v + ring, 90 + v + ring);
    v = n(x, y, 7, 40); G.hash(x, y, 91) < 0.22 ? px(7, x, y, 0, 0, 0, 0) : px(7, x, y, 46 + v, 125 + v, 50 + v);
    v = n(x, y, 8, 14); const pl = (y % 4 === 3) ? -34 : 0; px(8, x, y, 184 + v + pl, 137 + v + pl, 79 + v + pl);
    v = n(x, y, 9, 16); px(9, x, y, 50 + v, 100 + v, 215 + v);
    v = n(x, y, 10, 40); px(10, x, y, 40 + v, 40 + v, 40 + v);
    v = n(x, y, 11, 24); const blot = G.hash(x >> 1, y >> 1, 55) < 0.3 ? -34 : 0; px(11, x, y, 138 + v + blot, 138 + v + blot, 138 + v + blot);
    const mort = y % 4 === 3 || (x + (Math.floor(y / 4) % 2) * 4) % 8 === 0; v = n(x, y, 12, 14); mort ? px(12, x, y, 205, 196, 186) : px(12, x, y, 165 + v, 82 + v, 60 + v);
    const edge = x === 0 || y === 0 || x === 15 || y === 15 || x === y || (x === 3 && y < 8);
    edge ? px(13, x, y, 190, 225, 240, 1) : px(13, x, y, 0, 0, 0, 0);
    const grid = x % 8 === 0 || y % 8 === 0; v = n(x, y, 14, 16); grid ? px(14, x, y, 190, 140, 50) : px(14, x, y, 248 + v, 228 + v, 120 + v);
  }
  return cv;
}

const m4 = {
  persp(fov, a, n, f) { const t = 1 / Math.tan(fov / 2), r = 1 / (n - f); return new Float32Array([t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * r, -1, 0, 0, 2 * f * n * r, 0]); },
  mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
  view(ex, ey, ez, yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const f = [-sy * cp, sp, -cy * cp];
    const r = [cy, 0, -sy];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const ul = Math.hypot(u[0], u[1], u[2]) || 1; u[0] /= ul; u[1] /= ul; u[2] /= ul;
    return new Float32Array([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -(r[0] * ex + r[1] * ey + r[2] * ez), -(u[0] * ex + u[1] * ey + u[2] * ez), (f[0] * ex + f[1] * ey + f[2] * ez), 1]);
  },
  trs(x, y, z, ry, sx, sy, sz) { const c = Math.cos(ry), s = Math.sin(ry); return new Float32Array([c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, x, y, z, 1]); },
};

const VS = `#version 300 es
in vec3 aP; in vec2 aUV; in vec2 aL; uniform mat4 uVP; uniform vec3 uC;
out vec2 vUV; out vec2 vL; out float vD;
void main(){ vUV=aUV; vL=aL; vD=length(aP-uC); gl_Position=uVP*vec4(aP,1.0); }`;
const FS = `#version 300 es
precision mediump float; in vec2 vUV; in vec2 vL; in float vD; uniform sampler2D uT; uniform float uDay; uniform vec3 uSky; uniform float uA; uniform vec2 uFog; out vec4 o;
void main(){ vec4 t=texture(uT,vUV); if(t.a<0.5) discard; float l=vL.x*mix(uDay,1.0,vL.y); vec3 c=t.rgb*l; float f=clamp((vD-uFog.x)/(uFog.y-uFog.x),0.0,1.0); o=vec4(mix(c,uSky,f),uA); }`;
const VS2 = `#version 300 es
in vec3 aP; in vec3 aN; uniform mat4 uVP; uniform mat4 uM; out vec3 vN;
void main(){ vN=mat3(uM)*aN; gl_Position=uVP*uM*vec4(aP,1.0); }`;
const FS2 = `#version 300 es
precision mediump float; in vec3 vN; uniform vec3 uCol; uniform float uDay; out vec4 o;
void main(){ float s=0.55+0.45*max(dot(normalize(vN),normalize(vec3(0.4,1.0,0.3))),0.0); o=vec4(uCol*s*mix(0.35,1.0,uDay),1.0); }`;

function startMC() {
  if (live) return;
  const root = el('div', { class: 'mcroot' });
  const canvas = el('canvas', { class: 'mccv' });
  const lab = el('canvas', { class: 'mclab' });
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) { toast('your browser has no webgl2, cannot run the block world', 'error'); return; }
  const hearts = el('div', { class: 'mchearts' });
  const hotbar = el('div', { class: 'mchotbar' });
  const chatlog = el('div', { class: 'mclog' });
  const chatIn = el('input', { class: 'mcchat', placeholder: 'say something and press enter', maxLength: 100 });
  const info = el('div', { class: 'mcinfo' });
  const prog = el('div', { class: 'mcprog' }, el('i'));
  const note = el('div', { class: 'mcnote' });
  const pause = el('div', { class: 'mcpause' });
  const invBox = el('div', { class: 'mcinv' });
  const loading = el('div', { class: 'mcload' }, 'connecting to the world...');
  root.append(canvas, lab, el('div', { class: 'mccross' }), prog, hearts, hotbar, chatlog, chatIn, info, note, pause, invBox, loading);
  document.body.append(root);

  const atlas = makeAtlas();
  const st = { seed: 0, spawn: null, hp: 20, inv: {}, sel: 0, verified: true, offset: 0, day: 600000, R: Math.min(7, Math.max(3, +S.prefs.mcDist || 5)), joined: false, chat: false, inv_open: false, paused: false, locked: false };
  const P = { x: 0, y: 40, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, ground: false, water: false, peak: 0 };
  const others = new Map(), mobs = new Map();
  const chunks = new Map(), editsBy = new Map(), ready = new Set(), asked = new Set();
  const keys = new Set();
  const log = [];
  let raf = 0, last = performance.now(), lastSent = 0, lastCx = 1e9, lastCz = 1e9, mining = false, mineProg = 0, mineKey = '', lastPlace = 0, lastHit = 0, lastUi = 0, ch = null;

  const prog1 = (gl2, type, src) => { const s = gl2.createShader(type); gl2.shaderSource(s, src); gl2.compileShader(s); if (!gl2.getShaderParameter(s, gl2.COMPILE_STATUS)) throw new Error(gl2.getShaderInfoLog(s)); return s; };
  const mk = (vs, fs) => { const p = gl.createProgram(); gl.attachShader(p, prog1(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, prog1(gl, gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; };
  let pr, pr2;
  try { pr = mk(VS, FS); pr2 = mk(VS2, FS2); } catch (e) { root.remove(); toast('graphics failed: ' + e.message, 'error'); return; }
  const U1 = {}, U2 = {};
  ['uVP', 'uC', 'uT', 'uDay', 'uSky', 'uA', 'uFog'].forEach((n) => { U1[n] = gl.getUniformLocation(pr, n); });
  ['uVP', 'uM', 'uCol', 'uDay'].forEach((n) => { U2[n] = gl.getUniformLocation(pr2, n); });
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const cubeV = [];
  FACES.forEach((f) => { f.c.forEach((c) => cubeV.push(c[0] - 0.5, c[1], c[2] - 0.5, f.d[0], f.d[1], f.d[2])); });
  const cubeI = []; for (let i = 0; i < 6; i++) cubeI.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  const cubeVao = gl.createVertexArray(); gl.bindVertexArray(cubeVao);
  const cb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cubeV), gl.STATIC_DRAW);
  const a0 = gl.getAttribLocation(pr2, 'aP'), a1 = gl.getAttribLocation(pr2, 'aN');
  gl.enableVertexAttribArray(a0); gl.vertexAttribPointer(a0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(a1); gl.vertexAttribPointer(a1, 3, gl.FLOAT, false, 24, 12);
  const cib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(cubeI), gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  const getB = (x, y, z) => {
    if (y < 0) return B.BEDROCK; if (y >= H) return 0;
    const c = chunks.get(ck(x >> 4, z >> 4)); if (!c || !c.d) return -1;
    return c.d[G.idx(x & 15, y, z & 15)];
  };
  const solid = (x, y, z) => { const b = getB(x, y, z); return b === -1 || (b > 0 && b !== B.WATER); };

  function applyEdit(c, x, y, z, b) { if (c.d) c.d[G.idx(x & 15, y, z & 15)] = b; }
  function dirty(cx, cz) { const c = chunks.get(ck(cx, cz)); if (c) c.dirty = true; }
  function setLocal(x, y, z, b) {
    const cx = x >> 4, cz = z >> 4, k = ck(cx, cz);
    if (!editsBy.has(k)) editsBy.set(k, []);
    editsBy.get(k).push([x, y, z, b]);
    const c = chunks.get(k);
    if (c && c.d) {
      applyEdit(c, x, y, z, b); c.dirty = true;
      if ((x & 15) === 0) dirty(cx - 1, cz); if ((x & 15) === 15) dirty(cx + 1, cz);
      if ((z & 15) === 0) dirty(cx, cz - 1); if ((z & 15) === 15) dirty(cx, cz + 1);
    }
  }

  async function fetchEdits(x0, z0, x1, z1) {
    const keysReq = []; for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) keysReq.push(ck(x, z));
    try {
      const d = await api('GET', `/api/mc/edits?x0=${x0}&z0=${z0}&x1=${x1}&z1=${z1}`, null, { quiet: true });
      for (let i = 0; i < d.e.length; i += 4) {
        const x = d.e[i], y = d.e[i + 1], z = d.e[i + 2], b = d.e[i + 3], k = ck(x >> 4, z >> 4);
        if (!editsBy.has(k)) editsBy.set(k, []);
        editsBy.get(k).push([x, y, z, b]);
        const c = chunks.get(k); if (c && c.d) { applyEdit(c, x, y, z, b); c.dirty = true; }
      }
      keysReq.forEach((k) => ready.add(k));
    } catch { keysReq.forEach((k) => asked.delete(k)); }
  }

  function stream() {
    const pcx = Math.floor(P.x) >> 4, pcz = Math.floor(P.z) >> 4;
    if (pcx !== lastCx || pcz !== lastCz) {
      lastCx = pcx; lastCz = pcz;
      const R = st.R + 1, need = [];
      for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) { const k = ck(pcx + dx, pcz + dz); if (!asked.has(k)) need.push([pcx + dx, pcz + dz]); }
      if (need.length) {
        need.forEach(([x, z]) => asked.add(ck(x, z)));
        const xs = need.map((n) => n[0]), zs = need.map((n) => n[1]);
        fetchEdits(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs));
      }
      for (const [k, c] of chunks) if (Math.abs(c.cx - pcx) > st.R + 3 || Math.abs(c.cz - pcz) > st.R + 3) { free(c); chunks.delete(k); ready.delete(k); asked.delete(k); }
    }
    let gens = 0;
    const R1 = st.R + 1;
    const order = [];
    for (let dx = -R1; dx <= R1; dx++) for (let dz = -R1; dz <= R1; dz++) order.push([dx, dz, dx * dx + dz * dz]);
    order.sort((a, b) => a[2] - b[2]);
    for (const [dx, dz] of order) {
      if (gens >= 3) break;
      const cx = pcx + dx, cz = pcz + dz, k = ck(cx, cz);
      if (chunks.has(k) || !ready.has(k)) continue;
      const d = G.genChunk(st.seed, cx, cz);
      const c = { cx, cz, d, dirty: true, o: null, w: null };
      chunks.set(k, c);
      (editsBy.get(k) || []).forEach(([x, y, z, b]) => applyEdit(c, x, y, z, b));
      gens++;
    }
    let meshes = 0;
    for (const [dx, dz] of order) {
      if (meshes >= 3) break;
      if (Math.max(Math.abs(dx), Math.abs(dz)) > st.R) continue;
      const c = chunks.get(ck(pcx + dx, pcz + dz)); if (!c || !c.dirty) continue;
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => { const n = chunks.get(ck(c.cx + a, c.cz + b)); return n && n.d; })) continue;
      mesh(c); meshes++;
    }
  }

  function free(c) { [c.o, c.w].forEach((m) => { if (m) { gl.deleteVertexArray(m.vao); gl.deleteBuffer(m.vb); gl.deleteBuffer(m.ib); } }); }

  function upload(v, ix) {
    if (!ix.length) return null;
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(ix), gl.STATIC_DRAW);
    const l0 = gl.getAttribLocation(pr, 'aP'), l1 = gl.getAttribLocation(pr, 'aUV'), l2 = gl.getAttribLocation(pr, 'aL');
    gl.enableVertexAttribArray(l0); gl.vertexAttribPointer(l0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(l1); gl.vertexAttribPointer(l1, 2, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(l2); gl.vertexAttribPointer(l2, 2, gl.FLOAT, false, 28, 20);
    gl.bindVertexArray(null);
    return { vao, vb, ib, n: ix.length };
  }

  function mesh(c) {
    c.dirty = false; free(c);
    const ov = [], oi = [], wv = [], wi = [];
    const ox = c.cx * CS, oz = c.cz * CS;
    for (let y = 0; y < H; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const b = c.d[G.idx(x, y, z)]; if (!b) continue;
      const wx = ox + x, wz = oz + z, water = b === B.WATER;
      for (let f = 0; f < 6; f++) {
        const fd = FACES[f].d;
        const nb = getB(wx + fd[0], y + fd[1], wz + fd[2]);
        if (nb === -1) continue;
        if (water ? nb !== 0 : !(nb === 0 || (G.TRANSPARENT.has(nb) && nb !== b))) continue;
        const arr = water ? wv : ov, ia = water ? wi : oi, base = arr.length / 7;
        const t = faceTile(b, f), u0 = t / 16 + 0.0004, u1 = (t + 1) / 16 - 0.0004;
        const emit = b === B.LAMP ? 1 : 0, sh = SHADE[f] * (1 + (G.hash(wx, y * 7 + f, wz) - 0.5) * 0.08);
        for (let i = 0; i < 4; i++) {
          const cc = FACES[f].c[i];
          const yy = water && cc[1] === 1 && getB(wx, y + 1, wz) !== B.WATER ? 0.88 : cc[1];
          arr.push(wx + cc[0], y + yy, wz + cc[2], UVS[i][0] ? u1 : u0, UVS[i][1] ? 0.999 : 0.001, sh, emit);
        }
        ia.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    c.o = upload(ov, oi); c.w = upload(wv, wi);
  }

  function raycast(maxd) {
    const ex = P.x, ey = P.y + 1.62, ez = P.z;
    const cp = Math.cos(P.pitch), dx = -Math.sin(P.yaw) * cp, dy = Math.sin(P.pitch), dz = -Math.cos(P.yaw) * cp;
    let x = Math.floor(ex), y = Math.floor(ey), z = Math.floor(ez);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = Math.abs(1 / (dx || 1e-9)), tdy = Math.abs(1 / (dy || 1e-9)), tdz = Math.abs(1 / (dz || 1e-9));
    let tx = (dx > 0 ? x + 1 - ex : ex - x) * tdx, ty = (dy > 0 ? y + 1 - ey : ey - y) * tdy, tz = (dz > 0 ? z + 1 - ez : ez - z) * tdz;
    let px = x, py = y, pz = z, t = 0;
    while (t <= maxd) {
      const b = getB(x, y, z);
      if (b > 0 && b !== B.WATER) return { x, y, z, px, py, pz, b, t };
      px = x; py = y; pz = z;
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; } else if (ty < tz) { y += sy; t = ty; ty += tdy; } else { z += sz; t = tz; tz += tdz; }
    }
    return null;
  }

  function collides(x, y, z) {
    const x0 = Math.floor(x - 0.3), x1 = Math.floor(x + 0.3), y0 = Math.floor(y), y1 = Math.floor(y + 1.79), z0 = Math.floor(z - 0.3), z1 = Math.floor(z + 0.3);
    for (let a = x0; a <= x1; a++) for (let b = y0; b <= y1; b++) for (let c = z0; c <= z1; c++) if (solid(a, b, c)) return true;
    return false;
  }

  function physics(dt) {
    const f = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0), s = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
    const active = st.locked && !st.chat && !st.inv_open;
    const mf = active ? f : 0, ms = active ? s : 0;
    const sp = (keys.has('shift') ? 5.8 : 4.3) * (P.water ? 0.6 : 1);
    const cy = Math.cos(P.yaw), sy = Math.sin(P.yaw);
    let wx = (-sy * mf + cy * ms), wz = (-cy * mf - sy * ms);
    const l = Math.hypot(wx, wz); if (l > 0) { wx = wx / l * sp; wz = wz / l * sp; }
    const k = Math.min(1, dt * (P.ground ? 14 : 5));
    P.vx += (wx - P.vx) * k; P.vz += (wz - P.vz) * k;
    P.water = getB(Math.floor(P.x), Math.floor(P.y + 0.5), Math.floor(P.z)) === B.WATER;
    if (P.water) { P.vy -= 10 * dt; P.vy = Math.max(P.vy, -3.2); if (active && keys.has(' ')) P.vy = 3.6; P.vy *= 1 - Math.min(1, dt * 1.5); }
    else { P.vy -= 28 * dt; P.vy = Math.max(P.vy, -55); if (active && keys.has(' ') && P.ground) { P.vy = 8.6; P.ground = false; } }
    let nx = P.x + P.vx * dt; if (!collides(nx, P.y, P.z)) P.x = nx; else P.vx = 0;
    let nz = P.z + P.vz * dt; if (!collides(P.x, P.y, nz)) P.z = nz; else P.vz = 0;
    const ny = P.y + P.vy * dt;
    if (!collides(P.x, ny, P.z)) { P.y = ny; P.ground = false; }
    else {
      if (P.vy < 0) {
        P.ground = true;
        const fall = P.peak - P.y;
        if (fall > 3.4 && !P.water) { const dmg = Math.floor((fall - 3) * 2); if (dmg > 0) sendWS({ t: 'mc_dmg', n: dmg }); }
      }
      P.vy = 0;
    }
    if (P.ground || P.water) P.peak = P.y; else if (P.y > P.peak) P.peak = P.y;
    if (P.y < -5) { P.y = 40; }
  }

  const hotItems = () => Object.keys(st.inv).map(Number).filter((b) => st.inv[b] > 0).sort((a, b) => a - b).slice(0, 9);
  const icon = (b, size) => { const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(atlas, iconTile(b) * 16, 0, 16, 16, 0, 0, size, size); c.className = 'mcicon'; return c; };

  function drawHud() {
    hearts.replaceChildren(...Array.from({ length: 10 }, (_, i) => el('span', { class: 'mcheart' + (st.hp >= (i + 1) * 2 ? ' full' : st.hp === i * 2 + 1 ? ' half' : '') })));
    const items = hotItems(); if (st.sel >= items.length) st.sel = Math.max(0, items.length - 1);
    hotbar.replaceChildren(...(items.length ? items.map((b, i) => el('div', { class: 'mcslot' + (i === st.sel ? ' on' : ''), title: G.NAMES[b] }, icon(b, 32), el('span', null, String(st.inv[b])))) : [el('div', { class: 'mcempty' }, 'hold left click on blocks to mine them')]));
    if (st.inv_open) drawInv();
  }

  function drawInv() {
    const have = Object.keys(st.inv).map(Number).sort((a, b) => a - b);
    invBox.replaceChildren(
      el('div', { class: 'ctitle' }, 'inventory'),
      el('div', { class: 'mcgrid' }, ...(have.length ? have.map((b) => el('div', { class: 'mcslot' }, icon(b, 32), el('span', null, String(st.inv[b])), el('i', null, G.NAMES[b]))) : [el('div', { class: 'muted' }, 'empty')])),
      el('div', { class: 'ctitle', style: 'margin-top:12px' }, 'crafting'),
      ...G.RECIPES.map((r) => {
        const ok = Object.keys(r.inp).every((k) => (st.inv[k] || 0) >= r.inp[k]);
        return el('div', { class: 'row gap-s', style: 'align-items:center' },
          el('span', { class: 'grow' }, Object.keys(r.inp).map((k) => `${r.inp[k]} ${G.NAMES[k]}`).join(' + ') + ' = ' + Object.keys(r.out).map((k) => `${r.out[k]} ${G.NAMES[k]}`).join(', ')),
          el('button', { class: 'btn small' + (ok ? ' primary' : ''), disabled: !ok, onclick: () => sendWS({ t: 'mc_craft', id: r.id }) }, 'craft'));
      }),
      el('div', { class: 'muted small', style: 'margin-top:10px' }, 'press e to close'));
  }

  const say = (name, text) => { log.push({ t: performance.now(), s: (name ? name + ': ' : '') + text }); if (log.length > 30) log.shift(); };
  const drawLog = () => { const now = performance.now(); chatlog.replaceChildren(...log.filter((l) => st.chat || now - l.t < 10000).slice(-7).map((l) => el('div', null, l.s))); };

  X.onMC = (e) => {
    switch (e.t) {
      case 'mc_state':
        st.seed = e.seed; st.spawn = e.spawn; st.offset = e.now - Date.now(); st.day = e.day; st.hp = e.you.hp; st.inv = e.you.inv || {}; st.verified = e.you.verified;
        P.x = e.you.x; P.y = e.you.y; P.z = e.you.z; P.peak = P.y;
        e.players.forEach((p) => others.set(p.id, { ...p, tx: p.x, ty: p.y, tz: p.z }));
        e.mobs.forEach((m) => mobs.set(m.id, { ...m, tx: m.x, ty: m.y, tz: m.z }));
        st.joined = true; drawHud(); break;
      case 'mc_join': others.set(e.id, { ...e, tx: e.x, ty: e.y, tz: e.z }); say('', e.name + ' joined'); break;
      case 'mc_leave': { const o = others.get(e.id); if (o) say('', o.name + ' left'); others.delete(e.id); break; }
      case 'mc_pos': e.p.forEach(([id, x, y, z, yaw, pitch]) => { const o = others.get(id); if (o) { o.tx = x; o.ty = y; o.tz = z; o.yaw = yaw; o.pitch = pitch; } }); break;
      case 'mc_block': setLocal(e.x, e.y, e.z, e.b); break;
      case 'mc_inv': st.inv = e.inv; drawHud(); break;
      case 'mc_hp': if (e.hp < st.hp) { root.classList.add('hurt'); setTimeout(() => root.classList.remove('hurt'), 250); } st.hp = e.hp; drawHud(); break;
      case 'mc_respawn': P.x = e.x; P.y = e.y; P.z = e.z; P.vx = P.vy = P.vz = 0; P.peak = P.y; st.hp = e.hp; drawHud(); break;
      case 'mc_say': say(e.name, e.text); break;
      case 'mc_mob': mobs.set(e.id, { id: e.id, x: e.x, y: e.y, z: e.z, yaw: e.yaw, tx: e.x, ty: e.y, tz: e.z }); break;
      case 'mc_mobs': e.m.forEach(([id, x, y, z, yaw]) => { const m = mobs.get(id); if (m) { m.tx = x; m.ty = y; m.tz = z; m.yaw = yaw; } else mobs.set(id, { id, x, y, z, yaw, tx: x, ty: y, tz: z }); }); break;
      case 'mc_mob_gone': mobs.delete(e.id); break;
    }
  };

  const lock = () => { try { canvas.requestPointerLock(); } catch {} };
  const onLock = () => {
    st.locked = document.pointerLockElement === canvas;
    if (!st.locked && !st.chat && !st.inv_open && live) pause.classList.add('on'); else pause.classList.remove('on');
  };
  document.addEventListener('pointerlockchange', onLock);

  function drawPause() {
    pause.replaceChildren(
      el('div', { class: 'ctitle' }, 'block world'),
      el('button', { class: 'btn primary wide', onclick: () => { lock(); } }, 'resume'),
      el('div', { class: 'row gap-s', style: 'align-items:center' }, el('span', { class: 'grow' }, 'render distance ' + st.R),
        el('button', { class: 'btn small', onclick: () => { st.R = Math.max(3, st.R - 1); S.prefs.mcDist = st.R; lastCx = 1e9; drawPause(); } }, '-'),
        el('button', { class: 'btn small', onclick: () => { st.R = Math.min(7, st.R + 1); S.prefs.mcDist = st.R; lastCx = 1e9; drawPause(); } }, '+')),
      el('div', { class: 'muted small' }, 'wasd move, space jump, shift sprint, left click mine or hit, right click place, 1-9 pick block, e inventory and crafting, t chat'),
      el('button', { class: 'btn wide', onclick: () => stop() }, 'leave'));
  }
  drawPause();

  const kd = (e) => {
    if (document.activeElement === chatIn) {
      if (e.key === 'Enter') { const t = chatIn.value.trim(); if (t) sendWS({ t: 'mc_say', text: t }); chatIn.value = ''; chatIn.blur(); st.chat = false; chatIn.classList.remove('on'); lock(); }
      else if (e.key === 'Escape') { chatIn.blur(); st.chat = false; chatIn.classList.remove('on'); chatIn.value = ''; }
      e.stopPropagation(); return;
    }
    const k = e.key.toLowerCase();
    if (k === 'e' && st.joined) { st.inv_open = !st.inv_open; invBox.classList.toggle('on', st.inv_open); if (st.inv_open) { document.exitPointerLock(); drawInv(); } else lock(); e.preventDefault(); return; }
    if ((k === 't' || k === 'enter') && st.locked) { st.chat = true; chatIn.classList.add('on'); document.exitPointerLock(); setTimeout(() => chatIn.focus(), 30); e.preventDefault(); return; }
    if (k >= '1' && k <= '9') { st.sel = Math.min(+k - 1, Math.max(0, hotItems().length - 1)); drawHud(); return; }
    if (['w', 'a', 's', 'd', ' ', 'shift'].includes(k)) { keys.add(k); e.preventDefault(); }
  };
  const ku = (e) => keys.delete(e.key.toLowerCase());
  const mm = (e) => { if (!st.locked) return; P.yaw -= e.movementX * 0.0024; P.pitch = Math.max(-1.55, Math.min(1.55, P.pitch - e.movementY * 0.0024)); };
  const md = (e) => {
    if (e.target !== canvas) return;
    if (!st.locked) { if (!st.chat && !st.inv_open) lock(); return; }
    if (e.button === 0) { mining = true; tryHit(); } else if (e.button === 2) { placeBlock(); lastPlace = performance.now(); }
  };
  const mu = (e) => { if (e.button === 0) { mining = false; mineProg = 0; } };
  const wh = (e) => { if (!st.locked) return; const n = hotItems().length; if (n) { st.sel = (st.sel + (e.deltaY > 0 ? 1 : -1) + n) % n; drawHud(); } };
  const ctx = (e) => e.preventDefault();
  document.addEventListener('keydown', kd, true); document.addEventListener('keyup', ku);
  document.addEventListener('mousemove', mm); document.addEventListener('mousedown', md); document.addEventListener('mouseup', mu);
  document.addEventListener('wheel', wh, { passive: true }); root.addEventListener('contextmenu', ctx);

  const dirOf = () => { const cp = Math.cos(P.pitch); return [-Math.sin(P.yaw) * cp, Math.sin(P.pitch), -Math.cos(P.yaw) * cp]; };
  function mobTarget(maxd) {
    const ex = P.x, ey = P.y + 1.62, ez = P.z, d = dirOf(); let best = null, bt = maxd;
    for (const m of mobs.values()) {
      const cx = m.x - ex, cy = m.y + 0.9 - ey, cz = m.z - ez, t = cx * d[0] + cy * d[1] + cz * d[2];
      if (t < 0 || t > bt) continue;
      const px = cx - d[0] * t, py = cy - d[1] * t, pz = cz - d[2] * t;
      if (Math.hypot(px, py, pz) < 0.75) { best = m; bt = t; }
    }
    return best ? { m: best, t: bt } : null;
  }
  function tryHit() {
    const mt = mobTarget(4), bl = raycast(6);
    if (mt && (!bl || mt.t < bl.t) && performance.now() - lastHit > 380) { lastHit = performance.now(); sendWS({ t: 'mc_hit', id: mt.m.id }); mining = false; }
  }
  function placeBlock() {
    if (!st.verified) return note0('verify your account to build');
    const items = hotItems(), b = items[st.sel]; if (!b) return;
    const r = raycast(6); if (!r) return;
    const x = r.px, y = r.py, z = r.pz;
    if (r.px === r.x && r.py === r.y && r.pz === r.z) return;
    if (Math.abs(P.x - (x + 0.5)) < 0.8 && Math.abs(P.z - (z + 0.5)) < 0.8 && P.y < y + 1 && P.y + 1.8 > y) return;
    if (y < 1 || y >= H) return;
    setLocal(x, y, z, b); st.inv[b]--; if (!st.inv[b]) delete st.inv[b]; drawHud();
    sendWS({ t: 'mc_place', x, y, z, b });
  }
  let noteT = 0; const note0 = (t) => { note.textContent = t; note.classList.add('on'); clearTimeout(noteT); noteT = setTimeout(() => note.classList.remove('on'), 2500); };

  function mineTick(dt) {
    ch = null;
    if (!st.locked) return;
    const r = raycast(6); ch = r;
    if (mining && r && r.b !== B.BEDROCK) {
      if (!st.verified) { note0('verify your account to build'); mining = false; return; }
      const key = r.x + ',' + r.y + ',' + r.z;
      if (key !== mineKey) { mineKey = key; mineProg = 0; }
      mineProg += dt / (G.HARD[r.b] || 1);
      prog.firstChild.style.width = Math.min(100, mineProg * 100) + '%'; prog.classList.add('on');
      if (mineProg >= 1) { setLocal(r.x, r.y, r.z, 0); sendWS({ t: 'mc_break', x: r.x, y: r.y, z: r.z }); mineProg = 0; mineKey = ''; }
    } else { mineProg = 0; mineKey = ''; prog.classList.remove('on'); }
  }

  const dayInfo = () => {
    const f = ((Date.now() + st.offset) % st.day) / st.day;
    let d = 1; if (f >= 0.55 && f < 0.65) d = 1 - (f - 0.55) / 0.1 * 0.78; else if (f >= 0.65 && f < 0.95) d = 0.22; else if (f >= 0.95) d = 0.22 + (f - 0.95) / 0.05 * 0.78;
    return { d, f };
  };

  function box(vp, x, y, z, ry, sx, sy, sz, col, day) {
    gl.uniformMatrix4fv(U2.uM, false, m4.trs(x, y, z, ry, sx, sy, sz)); gl.uniform3f(U2.uCol, col[0], col[1], col[2]);
    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
  }
  const hueRgb = (name) => { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360; const a = h / 60, c = 0.65, x = c * (1 - Math.abs(a % 2 - 1)), m = 0.25; const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(a) % 6]; return [t[0] + m, t[1] + m, t[2] + m]; };

  function render(now, dt) {
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); lab.width = w; lab.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
    const { d } = dayInfo();
    const sky = [0.53 * d + 0.02 * (1 - d), 0.81 * d + 0.03 * (1 - d), 0.92 * d + 0.09 * (1 - d)];
    gl.clearColor(sky[0], sky[1], sky[2], 1); gl.enable(gl.DEPTH_TEST); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const ey = P.y + 1.62, far = (st.R + 1) * CS;
    const vp = m4.mul(m4.persp(1.2, canvas.width / canvas.height, 0.08, far * 1.3), m4.view(P.x, ey, P.z, P.yaw, P.pitch));
    gl.useProgram(pr);
    gl.uniformMatrix4fv(U1.uVP, false, vp); gl.uniform3f(U1.uC, P.x, ey, P.z); gl.uniform1i(U1.uT, 0); gl.uniform1f(U1.uDay, d);
    gl.uniform3f(U1.uSky, sky[0], sky[1], sky[2]); gl.uniform2f(U1.uFog, far * 0.55, far * 0.98); gl.uniform1f(U1.uA, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const c of chunks.values()) if (c.o) { gl.bindVertexArray(c.o.vao); gl.drawElements(gl.TRIANGLES, c.o.n, gl.UNSIGNED_INT, 0); }
    gl.useProgram(pr2); gl.uniformMatrix4fv(U2.uVP, false, vp); gl.uniform1f(U2.uDay, d); gl.bindVertexArray(cubeVao);
    others.forEach((o) => {
      if (Math.hypot(o.x - P.x, o.z - P.z) < 1 && Math.abs(o.y - P.y) < 2) return;
      const col = hueRgb(o.name), ry = o.yaw || 0;
      const leg = [0.2, 0.25, 0.55], skin = [0.93, 0.76, 0.62];
      box(vp, o.x, o.y, o.z, ry, 0.5, 0.6, 0.25, leg); box(vp, o.x, o.y + 0.6, o.z, ry, 0.5, 0.7, 0.25, col); box(vp, o.x, o.y + 1.3, o.z, ry, 0.5, 0.5, 0.5, skin);
    });
    mobs.forEach((m) => {
      const ry = (m.yaw || 0) + Math.PI, z1 = [0.35, 0.6, 0.3], z2 = [0.2, 0.55, 0.55], z3 = [0.2, 0.2, 0.55];
      box(vp, m.x, m.y, m.z, ry, 0.5, 0.7, 0.25, z3); box(vp, m.x, m.y + 0.7, m.z, ry, 0.55, 0.7, 0.28, z2); box(vp, m.x, m.y + 1.4, m.z, ry, 0.5, 0.5, 0.5, z1);
      const s = Math.sin(ry), c = Math.cos(ry);
      box(vp, m.x - s * 0.45, m.y + 1.0, m.z - c * 0.45, ry, 0.5, 0.2, 0.7, z1);
    });
    gl.bindVertexArray(null);
    gl.useProgram(pr); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.uniform1f(U1.uA, 0.62);
    for (const c of chunks.values()) if (c.w) { gl.bindVertexArray(c.w.vao); gl.drawElements(gl.TRIANGLES, c.w.n, gl.UNSIGNED_INT, 0); }
    gl.depthMask(true); gl.disable(gl.BLEND); gl.bindVertexArray(null);
    const g2 = lab.getContext('2d'); g2.clearRect(0, 0, w, h); g2.font = 'bold 13px sans-serif'; g2.textAlign = 'center';
    const proj = (x, y, z) => { const c = [vp[0] * x + vp[4] * y + vp[8] * z + vp[12], vp[1] * x + vp[5] * y + vp[9] * z + vp[13], vp[3] * x + vp[7] * y + vp[11] * z + vp[15] * 1]; const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15]; if (cw <= 0.1) return null; return [(c[0] / cw * 0.5 + 0.5) * w, (1 - (c[1] / cw * 0.5 + 0.5)) * h]; };
    others.forEach((o) => { const p = proj(o.x, o.y + 2.1, o.z); if (!p) return; const dd = Math.hypot(o.x - P.x, o.z - P.z); if (dd > 40) return; g2.fillStyle = 'rgba(0,0,0,.5)'; const tw = g2.measureText(o.name).width + 10; g2.fillRect(p[0] - tw / 2, p[1] - 14, tw, 18); g2.fillStyle = '#fff'; g2.fillText(o.name, p[0], p[1]); });
    if (ch) {
      const cs = [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]].map((q) => proj(ch.x + q[0], ch.y + q[1], ch.z + q[2]));
      g2.strokeStyle = 'rgba(0,0,0,.75)'; g2.lineWidth = 2; g2.beginPath();
      [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([a, b]) => { if (cs[a] && cs[b]) { g2.moveTo(cs[a][0], cs[a][1]); g2.lineTo(cs[b][0], cs[b][1]); } });
      g2.stroke();
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (st.joined) {
      physics(dt); stream(); mineTick(dt);
      if (mining) tryHit();
      if (st.locked && performance.now() - lastPlace > 260 && placeHeld) { placeBlock(); lastPlace = performance.now(); }
      if (now - lastSent > 66) { lastSent = now; sendWS({ t: 'mc_move', x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), yaw: +P.yaw.toFixed(2), pitch: +P.pitch.toFixed(2) }); }
      others.forEach((o) => { const k = Math.min(1, dt * 12); o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; o.z += (o.tz - o.z) * k; });
      mobs.forEach((m) => { const k = Math.min(1, dt * 6); m.x += (m.tx - m.x) * k; m.y += (m.ty - m.y) * k; m.z += (m.tz - m.z) * k; });
      if (loading.parentNode && chunks.size > 12) loading.remove();
      render(now, dt);
      if (now - lastUi > 400) { lastUi = now; drawLog(); const { f } = dayInfo(); info.textContent = `${Math.floor(P.x)}, ${Math.floor(P.y)}, ${Math.floor(P.z)}  ${f >= 0.65 && f < 0.95 ? 'night' : 'day'}  ${others.size + 1} online`; }
    }
    raf = requestAnimationFrame(frame);
  }
  let placeHeld = false;
  const pd2 = (e) => { if (e.button === 2) placeHeld = true; }, pu2 = (e) => { if (e.button === 2) placeHeld = false; };
  document.addEventListener('mousedown', pd2); document.addEventListener('mouseup', pu2);

  function stop() {
    cancelAnimationFrame(raf);
    sendWS({ t: 'mc_leave' });
    ['keydown'].forEach((t) => document.removeEventListener(t, kd, true));
    document.removeEventListener('keyup', ku); document.removeEventListener('mousemove', mm); document.removeEventListener('mousedown', md); document.removeEventListener('mouseup', mu);
    document.removeEventListener('wheel', wh); document.removeEventListener('pointerlockchange', onLock); document.removeEventListener('mousedown', pd2); document.removeEventListener('mouseup', pu2);
    try { document.exitPointerLock(); } catch {}
    for (const c of chunks.values()) free(c);
    root.remove(); X.onMC = null; live = null;
  }
  live = { stop, look: (y, p) => { P.yaw = y; P.pitch = p; }, dbg: () => ({ P, st: { locked: st.locked, chat: st.chat, inv: st.inv_open, joined: st.joined }, keys: [...keys], n: chunks.size, mining, mineProg, ch: ch && [ch.x, ch.y, ch.z, ch.b], ver: st.verified }) };
  sendWS({ t: 'mc_join' });
  raf = requestAnimationFrame(frame);
}

Object.assign(window.__ext, { startMC, onMC: null, mcDbg: () => (live ? live.dbg() : null), mcLook: (y, p) => live && live.look(y, p) });
})();

(function (root) {
'use strict';
const H = 64, SEA = 26, CS = 16;
const B = { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, LOG: 5, LEAVES: 6, PLANKS: 7, WATER: 8, BEDROCK: 9, COBBLE: 10, BRICK: 11, GLASS: 12, LAMP: 13 };
const NAMES = { 1: 'grass', 2: 'dirt', 3: 'stone', 4: 'sand', 5: 'log', 6: 'leaves', 7: 'planks', 10: 'cobble', 11: 'bricks', 12: 'glass', 13: 'lamp' };
const HARD = { 1: 0.35, 2: 0.3, 3: 1.2, 4: 0.3, 5: 0.8, 6: 0.15, 7: 0.7, 10: 1.0, 11: 1.3, 12: 0.25, 13: 0.4 };
const DROP = { 1: 2, 3: 10 };
const RECIPES = [
  { id: 'planks', name: 'planks', inp: { 5: 1 }, out: { 7: 4 } },
  { id: 'bricks', name: 'bricks', inp: { 10: 4 }, out: { 11: 4 } },
  { id: 'glass', name: 'glass', inp: { 4: 2 }, out: { 12: 2 } },
  { id: 'lamp', name: 'lamp', inp: { 12: 1, 7: 1 }, out: { 13: 1 } },
];
const PLACEABLE = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13];
const TRANSPARENT = new Set([0, 8, 6, 12]);

const hash = (a, b, s) => {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(s | 0, 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const vnoise = (x, z, s) => {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi, s), b = hash(xi + 1, zi, s), c = hash(xi, zi + 1, s), d = hash(xi + 1, zi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const height = (x, z, s) => {
  const n = vnoise(x / 56, z / 56, s) * 0.55 + vnoise(x / 22, z / 22, s + 1) * 0.3 + vnoise(x / 9, z / 9, s + 2) * 0.15;
  return Math.max(4, Math.min(H - 14, Math.floor(10 + n * 38)));
};
const idx = (x, y, z) => (y * CS + z) * CS + x;

function genChunk(s, cx, cz) {
  const d = new Uint8Array(CS * H * CS);
  const ox = cx * CS, oz = cz * CS;
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const h = height(ox + x, oz + z, s), beach = h <= SEA + 1;
    for (let y = 0; y <= h; y++) {
      let b;
      if (y === 0) b = B.BEDROCK;
      else if (y < h - 3) b = B.STONE;
      else if (y < h) b = beach ? B.SAND : B.DIRT;
      else b = beach ? B.SAND : B.GRASS;
      d[idx(x, y, z)] = b;
    }
    for (let y = h + 1; y <= SEA; y++) d[idx(x, y, z)] = B.WATER;
  }
  for (let tz = oz - 2; tz < oz + CS + 2; tz++) for (let tx = ox - 2; tx < ox + CS + 2; tx++) {
    if (hash(tx, tz, s + 7) >= 0.012) continue;
    const th = height(tx, tz, s);
    if (th <= SEA + 2) continue;
    const tl = 4 + Math.floor(hash(tx, tz, s + 9) * 2);
    const put = (wx, wy, wz, b, soft) => {
      const lx = wx - ox, lz = wz - oz;
      if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || wy < 0 || wy >= H) return;
      const i = idx(lx, wy, lz);
      if (soft && d[i] !== B.AIR) return;
      d[i] = b;
    };
    for (let dy = -1; dy <= 1; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dz * dz + dy * dy * 2 > 7) continue;
      put(tx + dx, th + tl + dy, tz + dz, B.LEAVES, true);
    }
    put(tx, th + tl + 2, tz, B.LEAVES, true);
    for (let y = 1; y <= tl; y++) put(tx, th + y, tz, B.LOG, false);
  }
  return d;
}

function spawnPoint(s) {
  for (let r = 0; r < 120; r += 2) for (let a = 0; a < 8; a++) {
    const x = Math.round(Math.cos(a * 0.785) * r), z = Math.round(Math.sin(a * 0.785) * r);
    const h = height(x, z, s);
    if (h > SEA + 2) return { x: x + 0.5, y: h + 1, z: z + 0.5 };
  }
  return { x: 0.5, y: SEA + 6, z: 0.5 };
}

const api = { H, SEA, CS, B, NAMES, HARD, DROP, RECIPES, PLACEABLE, TRANSPARENT, hash, height, genChunk, spawnPoint, idx };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.__mcgen = api;
})(typeof window !== 'undefined' ? window : globalThis);

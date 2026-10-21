import * as THREE from 'three';
import { VoxelGrid, meshGrid, rng, shadeHex } from '../engine/voxel';
import { rasterText, textWidth } from '../engine/font';
import { PAL, pick } from './palette';
import type { DebrisVoxel } from './characterModels';

export interface PropModel {
  geo: THREE.BufferGeometry;
  /** Half extents of the hit box (metres), box is centred on x/z, bottom at y=0. */
  half: THREE.Vector3;
  debris: DebrisVoxel[];
}

function finish(g: VoxelGrid, size: number, stride = 2): PropModel {
  const pivot: [number, number, number] = [g.sx / 2, 0, g.sz / 2];
  const debris: DebrisVoxel[] = [];
  g.forEach(
    (x, y, z, c) => debris.push({ p: new THREE.Vector3((x - pivot[0] + 0.5) * size, (y + 0.5) * size, (z - pivot[2] + 0.5) * size), color: c }),
    stride,
  );
  return {
    geo: meshGrid(g, size, pivot),
    half: new THREE.Vector3((g.sx * size) / 2, g.sy * size, (g.sz * size) / 2),
    debris,
  };
}

export function buildBarrel(seed = 1): PropModel {
  const r = rng(seed);
  const g = new VoxelGrid(12, 13, 12);
  const base = PAL.plank[Math.floor(r() * PAL.plank.length)];
  for (let y = 0; y < 13; y++) {
    const bulge = y > 2 && y < 10 ? 0.5 : 0;
    const rad = 5 + bulge;
    for (let x = 0; x < 12; x++)
      for (let z = 0; z < 12; z++) {
        const dx = x - 5.5, dz = z - 5.5;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > rad) continue;
        const ang = Math.atan2(dz, dx);
        const stave = Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 14);
        let c = shadeHex(base, stave % 2 ? 0.92 : 1.05);
        if (y === 2 || y === 10) c = PAL.metalDark;
        if (y === 12) c = d < rad - 1 ? shadeHex(base, 0.7) : shadeHex(base, 0.85);
        g.set(x, y, z, c);
      }
  }
  return finish(g, 0.07);
}

export function buildCrate(label?: string, color = 0xa87848): PropModel {
  const n = 12;
  const g = new VoxelGrid(n, n, n);
  g.box(0, 0, 0, n - 1, n - 1, n - 1, (x, y, z) => {
    const edge = [x, y, z].filter((v) => v === 0 || v === n - 1).length >= 2;
    if (edge) return shadeHex(color, 0.6);
    return shadeHex(color, (Math.floor(y / 3) % 2 ? 0.93 : 1.03));
  });
  // diagonal braces on the sides
  for (let i = 1; i < n - 1; i++) {
    for (const z of [0, n - 1]) g.set(i, i, z, shadeHex(color, 0.7));
    for (const x of [0, n - 1]) g.set(x, i, n - 1 - i, shadeHex(color, 0.7));
  }
  if (label) {
    const w = textWidth(label);
    const ox = Math.floor((n - w) / 2);
    for (const z of [n - 1, 0])
      rasterText(label, (px, py) => {
        g.set(z === 0 ? n - 1 - (ox + px) : ox + px, 4 + py, z, 0xf8f0d0);
      });
  }
  return finish(g, 0.075);
}

export function buildTntCrate(): PropModel {
  return buildCrate('TNT', 0xc8382a);
}

export function buildHay(): PropModel {
  const g = new VoxelGrid(14, 8, 9);
  const r = rng(77);
  g.box(0, 0, 0, 13, 7, 8, () => shadeHex(PAL.hay, 0.85 + r() * 0.25));
  g.box(3, 0, 0, 3, 7, 8, 0x8a6a30);
  g.box(10, 0, 0, 10, 7, 8, 0x8a6a30);
  return finish(g, 0.1);
}

export function buildTrough(): PropModel {
  const g = new VoxelGrid(22, 7, 8);
  g.box(0, 1, 0, 21, 6, 7, PAL.plank[1]);
  g.box(1, 3, 1, 20, 6, 6, null);
  g.box(1, 3, 1, 20, 5, 6, PAL.water);
  g.box(1, 0, 1, 2, 0, 6, PAL.woodDark);
  g.box(19, 0, 1, 20, 0, 6, PAL.woodDark);
  return finish(g, 0.1);
}

/** Wagon used as cover: long axis along X. */
export function buildWagon(): PropModel {
  const g = new VoxelGrid(34, 13, 14);
  const wood = PAL.plank[0];
  g.box(2, 4, 2, 31, 11, 11, (x, y) => shadeHex(wood, y % 2 ? 0.92 : 1.04));
  g.box(3, 6, 3, 30, 11, 10, null);
  g.box(3, 6, 3, 30, 6, 10, PAL.woodDark);
  // top rails
  g.box(2, 12, 2, 31, 12, 2, PAL.woodDark);
  g.box(2, 12, 11, 31, 12, 11, PAL.woodDark);
  // wheels on both sides
  for (const cx of [7, 26])
    for (const z of [0, 1, 12, 13])
      for (let x = cx - 5; x <= cx + 5; x++)
        for (let y = 0; y <= 10; y++) {
          const d = Math.hypot(x - cx, y - 5);
          if (d > 5.3) continue;
          const rim = d > 4.2;
          const spoke = Math.abs(x - cx) < 0.6 || Math.abs(y - 5) < 0.6 || Math.abs(Math.abs(x - cx) - Math.abs(y - 5)) < 0.7;
          if (rim) g.set(x, y, z, z === 0 || z === 13 ? PAL.metalDark : PAL.woodDark);
          else if (spoke || d < 1.2) g.set(x, y, z, PAL.woodDark);
        }
  return finish(g, 0.1);
}

/** Low barricade of sandbags + planks the posse hides behind. Long axis along X. */
export function buildBarricade(width = 6): PropModel {
  const vx = Math.round(width / 0.1);
  const g = new VoxelGrid(vx, 11, 6);
  const r = rng(5);
  // sandbag rows
  for (let row = 0; row < 3; row++) {
    const y0 = row * 3;
    const off = row % 2 ? 3 : 0;
    for (let x = -off; x < vx; x += 6) {
      const tone = 0.85 + r() * 0.2;
      g.box(x + 1, y0, 0, x + 5, y0 + 2, 5, shadeHex(0xc8b080, tone));
      g.box(x + 1, y0 + 2, 0, x + 5, y0 + 2, 5, shadeHex(0xc8b080, tone * 1.08));
    }
  }
  // planks on top
  g.box(0, 9, 1, vx - 1, 10, 4, (x) => shadeHex(PAL.plank[2], Math.floor(x / 9) % 2 ? 0.9 : 1.05));
  return finish(g, 0.1, 3);
}

export function buildCactus(seed: number): PropModel {
  const r = rng(seed);
  const h = 18 + Math.floor(r() * 12);
  const g = new VoxelGrid(13, h + 1, 5);
  const col = (x: number) => (x % 2 ? PAL.cactus : PAL.cactusDark);
  g.box(5, 0, 1, 7, h, 3, (x) => col(x));
  const armY = 6 + Math.floor(r() * 6);
  g.box(1, armY, 1, 4, armY + 1, 3, (x) => col(x));
  g.box(1, armY, 1, 2, armY + 7, 3, (x) => col(x));
  const armY2 = 9 + Math.floor(r() * 6);
  g.box(8, armY2, 1, 11, armY2 + 1, 3, (x) => col(x));
  g.box(10, armY2, 1, 11, armY2 + 6, 3, (x) => col(x));
  return finish(g, 0.12);
}

/** Wooden gate frame (two posts + crossbeam). Opening along X, width in metres. */
export function buildGateFrame(width: number): PropModel {
  const s = 0.1;
  const vx = Math.round(width / s);
  const g = new VoxelGrid(vx, 34, 3);
  g.box(0, 0, 0, 2, 33, 2, PAL.woodDark);
  g.box(vx - 3, 0, 0, vx - 1, 33, 2, PAL.woodDark);
  g.box(0, 29, 0, vx - 1, 31, 2, PAL.plank[0]);
  g.box(0, 32, 1, vx - 1, 32, 1, shadeHex(PAL.plank[0], 0.7));
  return finish(g, s, 3);
}

export function buildHitchingPost(): PropModel {
  const g = new VoxelGrid(20, 10, 2);
  g.box(0, 0, 0, 1, 9, 1, PAL.woodDark);
  g.box(18, 0, 0, 19, 9, 1, PAL.woodDark);
  g.box(0, 8, 0, 19, 9, 1, PAL.plank[1]);
  return finish(g, 0.1);
}

/** Stone well with a little roof. */
export function buildWell(): PropModel {
  const g = new VoxelGrid(16, 26, 16);
  const r = rng(12);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 16; x++)
      for (let z = 0; z < 16; z++) {
        const d = Math.hypot(x - 7.5, z - 7.5);
        if (d > 7.5 || d < 5.2) continue;
        const stone = ((x + y * 3 + z * 5) % 4 === 0) ? 0x7a746c : y % 3 === 0 ? 0x8a847a : 0x9a948a;
        g.set(x, y, z, shadeHex(stone, 0.9 + r() * 0.15));
      }
  g.box(2, 0, 2, 13, 6, 13, (x, _y, z) => (Math.hypot(x - 7.5, z - 7.5) < 5.2 ? 0x1a2a3a : null));
  // posts + roof + crank
  g.box(1, 8, 7, 1, 20, 8, PAL.woodDark);
  g.box(14, 8, 7, 14, 20, 8, PAL.woodDark);
  g.box(1, 15, 7, 14, 15, 8, PAL.wood);
  g.box(7, 9, 7, 8, 14, 8, 0x8a7a5a);
  for (let i = 0; i < 6; i++) {
    g.box(0, 20 + i, 2 + i, 15, 20 + i, 2 + i, PAL.roof);
    g.box(0, 20 + i, 13 - i, 15, 20 + i, 13 - i, PAL.roof);
  }
  return finish(g, 0.1);
}

/** Water tower on stilts (big landmark, solid only at the legs). */
export function buildWaterTower(): PropModel {
  const g = new VoxelGrid(24, 64, 24);
  const legs = [
    [2, 2],
    [20, 2],
    [2, 20],
    [20, 20],
  ];
  for (const [lx, lz] of legs) g.box(lx, 0, lz, lx + 1, 38, lz + 1, PAL.woodDark);
  for (let y = 8; y < 38; y += 10) {
    g.box(2, y, 2, 21, y, 2, PAL.wood);
    g.box(2, y, 21, 21, y, 21, PAL.wood);
    g.box(2, y, 2, 2, y, 21, PAL.wood);
    g.box(21, y, 2, 21, y, 21, PAL.wood);
  }
  for (let y = 39; y < 58; y++)
    for (let x = 0; x < 24; x++)
      for (let z = 0; z < 24; z++) {
        const d = Math.hypot(x - 11.5, z - 11.5);
        if (d > 11.5) continue;
        const ang = Math.atan2(z - 11.5, x - 11.5);
        const stave = Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 24);
        let c = shadeHex(PAL.plank[1], stave % 2 ? 0.92 : 1.05);
        if (y === 42 || y === 50 || y === 56) c = PAL.metalDark;
        if (d < 10.5 && y < 57) c = 0x3a2a1a;
        g.set(x, y, z, c);
      }
  for (let i = 0; i < 6; i++)
    g.box(Math.floor(i * 1.6), 58 + i, Math.floor(i * 1.6), 23 - Math.floor(i * 1.6), 58 + i, 23 - Math.floor(i * 1.6), PAL.roof);
  const pm = finish(g, 0.15, 3);
  // only the legs block movement / bullets
  pm.half.set(1.8, 5.7, 1.8);
  return pm;
}

/** Wooden fence segment along X (length in metres). */
export function buildFence(len = 4): PropModel {
  const vx = Math.round(len / 0.1);
  const g = new VoxelGrid(vx, 11, 2);
  for (let x = 0; x < vx; x += 10) g.box(x, 0, 0, x + 1, 10, 1, PAL.woodDark);
  g.box(0, 3, 0, vx - 1, 4, 0, PAL.plank[2]);
  g.box(0, 8, 0, vx - 1, 9, 0, PAL.plank[0]);
  return finish(g, 0.1);
}

/** A stack of 2–3 crates. */
export function buildCrateStack(seed = 1): PropModel {
  const r = rng(seed);
  const n = 12;
  const g = new VoxelGrid(n * 2 + 1, n * 2, n + 1);
  const crate = (ox: number, oy: number, color: number) =>
    g.box(ox, oy, 0, ox + n - 1, oy + n - 1, n - 1, (x, y, z) => {
      const lx = x - ox, ly = y - oy;
      const edge = [lx, ly, z].filter((v) => v === 0 || v === n - 1).length >= 2;
      if (edge) return shadeHex(color, 0.6);
      if (lx === ly || lx === n - 1 - ly) return shadeHex(color, 0.75);
      return shadeHex(color, Math.floor(ly / 3) % 2 ? 0.93 : 1.03);
    });
  const c1 = pick([0xa87848, 0x9a6a3e, 0xb8885a], r);
  crate(0, 0, c1);
  crate(n + 1, 0, shadeHex(c1, 0.92));
  if (r() < 0.7) crate(Math.floor(n / 2), n, shadeHex(c1, 1.06));
  return finish(g, 0.075);
}

/** Street lamp post. */
export function buildLamp(): PropModel {
  const g = new VoxelGrid(7, 34, 7);
  g.box(3, 0, 3, 3, 28, 3, PAL.metalDark);
  g.box(2, 0, 2, 4, 1, 4, PAL.metalDark);
  g.box(1, 28, 1, 5, 32, 5, PAL.metalDark);
  g.box(2, 29, 2, 4, 31, 4, 0xffe0a0);
  g.box(2, 33, 2, 4, 33, 4, PAL.metalDark);
  const pm = finish(g, 0.1);
  pm.half.set(0.15, 3.3, 0.15);
  return pm;
}

/** Notice board with WANTED posters. */
export function buildWantedBoard(): PropModel {
  const g = new VoxelGrid(22, 22, 3);
  g.box(1, 0, 1, 2, 21, 1, PAL.woodDark);
  g.box(19, 0, 1, 20, 21, 1, PAL.woodDark);
  g.box(0, 9, 0, 21, 21, 1, PAL.wood);
  for (const [px, py] of [
    [2, 11],
    [8, 13],
    [14, 11],
  ]) {
    g.box(px, py, 0, px + 5, py + 7, 0, 0xe8d8b0);
    g.box(px + 1, py + 3, 0, px + 4, py + 5, 0, 0x5a3a2a);
    g.box(px + 1, py + 6, 0, px + 4, py + 6, 0, 0x2a1a10);
  }
  return finish(g, 0.1);
}

export function buildSandbags(width = 3): PropModel {
  return buildBarricade(width);
}

/** Desert boulder. `big` = taller than a man (blocks line of sight). */
export function buildRock(seed: number, big = false): PropModel {
  const r = rng(seed * 31 + 5);
  const sx = big ? 18 + Math.floor(r() * 6) : 10 + Math.floor(r() * 5);
  const sy = big ? 18 + Math.floor(r() * 4) : 8 + Math.floor(r() * 3);
  const sz = big ? 14 + Math.floor(r() * 5) : 9 + Math.floor(r() * 4);
  const g = new VoxelGrid(sx, sy, sz);
  const base = [0xa8826a, 0x9a7460, 0xb89478][Math.floor(r() * 3)];
  for (let y = 0; y < sy; y++)
    for (let x = 0; x < sx; x++)
      for (let z = 0; z < sz; z++) {
        const nx = (x - sx / 2 + 0.5) / (sx / 2), ny = y / sy, nz = (z - sz / 2 + 0.5) / (sz / 2);
        const bump = Math.sin(x * 1.3 + seed) * 0.08 + Math.cos(z * 1.7 + seed * 2) * 0.08;
        if (nx * nx + nz * nz + ny * ny * 1.1 > 1 + bump) continue;
        const layer = Math.floor(y / 2) % 3;
        g.set(x, y, z, shadeHex(base, (layer === 0 ? 0.9 : layer === 1 ? 1 : 1.07) * (0.95 + r() * 0.08)));
      }
  return finish(g, 0.1, 3);
}

export function buildDeadTree(seed: number): PropModel {
  const r = rng(seed * 13 + 1);
  const h = 22 + Math.floor(r() * 10);
  const g = new VoxelGrid(15, h + 2, 15);
  const col = 0x6a5440;
  g.box(7, 0, 7, 7, h, 7, col);
  g.box(6, 0, 6, 8, 3, 8, col);
  for (let b = 0; b < 4; b++) {
    const y = 8 + b * Math.floor((h - 8) / 4);
    const dx = b % 2 ? 1 : -1, dz = b % 3 ? 1 : -1;
    for (let k = 1; k < 6; k++) g.set(7 + dx * k, y + k, 7 + (b > 1 ? dz * k : 0), col);
  }
  const pm = finish(g, 0.12);
  pm.half.set(0.12, h * 0.12, 0.12);
  return pm;
}

/** Freight car standing on the rails (long axis X). */
export function buildBoxcar(seed: number): PropModel {
  const r = rng(seed);
  const L = 64, Wd = 26, Hh = 28;
  const g = new VoxelGrid(L, Hh + 2, Wd);
  const body = [0x8a3a2a, 0x6a5a3a, 0x5a6a7a][Math.floor(r() * 3)];
  // wheels and frame
  for (const wx of [8, 14, 50, 56]) for (const z of [2, Wd - 3]) g.box(wx - 2, 0, z, wx + 2, 4, z, PAL.metalDark);
  g.box(2, 5, 3, L - 3, 6, Wd - 4, PAL.metalDark);
  // body with vertical planks
  g.box(2, 7, 2, L - 3, Hh, Wd - 3, (x) => shadeHex(body, x % 3 === 0 ? 0.82 : 1));
  g.box(3, Hh + 1, 3, L - 4, Hh + 1, Wd - 4, shadeHex(body, 0.6));
  // sliding door
  g.box(26, 8, Wd - 3, 37, Hh - 2, Wd - 3, shadeHex(body, 0.7));
  g.box(26, 8, 2, 37, Hh - 2, 2, shadeHex(body, 0.7));
  return finish(g, 0.1, 3);
}

/** Straight railway track along X (decor only): sleepers + two rails. */
export function buildTrack(lengthM: number): PropModel {
  const L = Math.round(lengthM / 0.1);
  const g = new VoxelGrid(L, 2, 26);
  for (let x = 0; x < L; x += 6) g.box(x, 0, 1, x + 2, 0, 24, 0x5a4030);
  g.box(0, 1, 6, L - 1, 1, 6, 0x7a7a80);
  g.box(0, 1, 19, L - 1, 1, 19, 0x7a7a80);
  return finish(g, 0.1, 4);
}

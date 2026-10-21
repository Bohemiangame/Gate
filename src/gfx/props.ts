import * as THREE from 'three';
import { VoxelGrid, meshGrid, rng, shadeHex } from '../engine/voxel';
import { rasterText, textWidth } from '../engine/font';
import { PAL } from './palette';
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

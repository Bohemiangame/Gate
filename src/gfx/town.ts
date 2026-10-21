import * as THREE from 'three';
import { VoxelGrid, meshGrid, rng, shadeHex, voxelMaterial } from '../engine/voxel';
import { rasterText, textWidth } from '../engine/font';
import { PAL, pick } from './palette';
import { buildBarrel, buildCactus, buildCrate, buildHay, buildHitchingPost, buildTrough, PropModel } from './props';

/** Building voxel size (metres). */
const BVS = 0.125;
/** Street half-width (porch front edge). Facades sit 2 m further out. */
export const STREET_HALF = 5;
const PORCH = 16; // voxels (2 m)
const DEPTH = 32; // voxels (4 m)

type Kind = 'saloon' | 'bank' | 'hotel' | 'sheriff' | 'store' | 'barber' | 'guns' | 'post' | 'livery' | 'plain';

interface BuildingDef {
  kind: Kind;
  sign: string | null;
  width: number; // voxels
  twoStory: boolean;
}

export interface BuildingVariant {
  geo: THREE.BufferGeometry;
  widthM: number;
}

function wallColor(base: number, x: number, y: number, brick: boolean): number {
  if (brick) {
    const row = Math.floor(y / 2);
    const off = row % 2 ? 2 : 0;
    if (y % 2 === 0 || (x + off) % 4 === 0) return shadeHex(base, 0.72);
    return base;
  }
  const board = Math.floor(y / 2);
  const seg = Math.floor((x + board * 7) / 22);
  const h = ((board * 31 + seg * 17) % 7) / 7;
  const seam = y % 2 === 0 ? 0.86 : 1;
  return shadeHex(base, (0.9 + h * 0.16) * seam);
}

function buildBuilding(def: BuildingDef, seed: number): BuildingVariant {
  const r = rng(seed);
  const W = def.width;
  const H = def.twoStory ? 48 : 28;
  const F = def.kind === 'livery' ? 0 : 8 + Math.floor(r() * 7);
  const g = new VoxelGrid(W, H + F + 12, DEPTH + PORCH + 1);
  const zf = DEPTH - 1; // facade plane
  const brick = def.kind === 'bank';
  const painted = !brick && r() < 0.55;
  const base = brick ? 0xa85a3a : painted ? pick(PAL.paint, r) : pick(PAL.plank, r);
  const trim = brick ? 0xd8c8a8 : painted ? PAL.trim : shadeHex(base, 1.35);
  const wc = (x: number, y: number) => wallColor(base, x, y, brick);

  // Shell: front, sides, back, roof
  g.box(0, 2, zf - 1, W - 1, H - 1, zf, (x, y) => wc(x, y));
  g.box(0, 2, 0, 0, H - 1, zf, (_x, y, z) => wc(z, y));
  g.box(W - 1, 2, 0, W - 1, H - 1, zf, (_x, y, z) => wc(z, y));
  g.box(0, 2, 0, W - 1, H - 1, 0, (x, y) => wc(x, y));
  g.box(0, H - 1, 0, W - 1, H - 1, zf - 2, PAL.roof);
  // solid interior: no hidden inner faces get meshed
  g.box(1, 2, 1, W - 2, H - 2, zf - 2, 0x3a2a1a);
  // foundation
  g.box(0, 0, 0, W - 1, 1, zf, 0x6a5a4a);

  if (def.kind === 'livery') {
    // barn: gable roof instead of false front
    const peak = 14;
    for (let i = 0; i <= peak; i++) {
      const x0 = i, x1 = W - 1 - i;
      if (x0 > x1) break;
      g.box(x0, H + i, zf - 1, x1, H + i, zf, (x, y) => wc(x, y));
      g.box(x0, H + i, 0, x1, H + i, 0, (x, y) => wc(x, y));
      g.box(x0 - 1, H + i, -1, x0, H + i, zf + 1, PAL.roof);
      g.box(x1, H + i, -1, x1 + 1, H + i, zf + 1, PAL.roof);
    }
    // big barn door with X brace
    const dw = 18, dx = Math.floor(W / 2 - dw / 2);
    g.box(dx, 2, zf, dx + dw - 1, 22, zf, 0x7a4a2a);
    for (let i = 0; i < 20; i++) {
      g.set(dx + Math.round((i * (dw - 1)) / 19), 2 + i, zf + 1, 0xe0d0b0);
      g.set(dx + dw - 1 - Math.round((i * (dw - 1)) / 19), 2 + i, zf + 1, 0xe0d0b0);
    }
    g.box(dx - 1, 23, zf + 1, dx + dw, 23, zf + 1, 0xe0d0b0);
    g.box(dx - 1, 2, zf + 1, dx - 1, 23, zf + 1, 0xe0d0b0);
    g.box(dx + dw, 2, zf + 1, dx + dw, 23, zf + 1, 0xe0d0b0);
    // hay loft
    g.box(Math.floor(W / 2) - 4, H + 2, zf, Math.floor(W / 2) + 3, H + 8, zf, 0x2a1a10);
    g.box(Math.floor(W / 2) - 4, H + 2, zf + 1, Math.floor(W / 2) + 3, H + 3, zf + 1, PAL.hay);
  } else {
    // False front with a profile on top
    const style = Math.floor(r() * 3);
    for (let x = 0; x < W; x++) {
      let top = H + F - 1;
      if (style === 1) {
        const d = Math.min(x, W - 1 - x);
        if (d < 4) top -= 4;
      } else if (style === 2) {
        const d = Math.abs(x - (W - 1) / 2) / (W / 2);
        top = Math.round(H + F - 1 - d * 5) + 2;
      }
      g.box(x, H, zf - 1, x, top, zf, (xx, y) => wc(xx, y));
      g.set(x, top, zf + 1, trim);
      g.set(x, top + 1, zf, trim);
    }
    // corner pilasters
    g.box(0, 2, zf + 1, 1, H + F - 2, zf + 1, trim);
    g.box(W - 2, 2, zf + 1, W - 1, H + F - 2, zf + 1, trim);
  }

  // Sign board
  if (def.sign) {
    const tw = textWidth(def.sign);
    const bw = tw + 6;
    const bx = Math.floor(W / 2 - bw / 2);
    const by = def.kind === 'livery' ? 24 : H + 1;
    if (bw <= W - 4) {
      g.box(bx, by, zf + 1, bx + bw - 1, by + 8, zf + 1, PAL.sign);
      g.box(bx, by, zf + 2, bx + bw - 1, by, zf + 2, trim);
      g.box(bx, by + 8, zf + 2, bx + bw - 1, by + 8, zf + 2, trim);
      const textCol = def.kind === 'bank' ? 0xf0c840 : PAL.signText;
      rasterText(def.sign, (px, py) => g.set(bx + 3 + px, by + 2 + py, zf + 2, textCol));
    }
  }

  // Door
  if (def.kind !== 'livery') {
    const dx = Math.floor(W / 2) - 4 + (W > 56 ? Math.floor((r() - 0.5) * 10) : 0);
    g.box(dx - 1, 2, zf + 1, dx + 8, 20, zf + 1, trim);
    g.box(dx, 2, zf - 1, dx + 7, 19, zf + 1, 0x1a120c);
    if (def.kind === 'saloon') {
      // batwing doors
      g.box(dx, 7, zf + 1, dx + 3, 14, zf + 1, shadeHex(base, 1.15));
      g.box(dx + 4, 7, zf + 1, dx + 7, 14, zf + 1, shadeHex(base, 1.05));
      g.box(dx, 15, zf + 1, dx + 7, 15, zf + 1, null);
    } else {
      g.box(dx + 1, 2, zf + 1, dx + 6, 18, zf + 1, PAL.door);
      g.box(dx + 2, 11, zf + 1, dx + 5, 16, zf + 1, PAL.glass);
      g.set(dx + 5, 9, zf + 2, PAL.brass);
    }

    // Ground floor windows
    const win = (cx: number, y0: number, h: number) => {
      if (cx - 5 < 2 || cx + 4 > W - 3) return;
      g.box(cx - 5, y0 - 1, zf + 1, cx + 4, y0 + h, zf + 1, trim);
      g.box(cx - 4, y0, zf + 1, cx + 3, y0 + h - 1, zf + 1, PAL.glass);
      g.box(cx - 4, y0 + h - 2, zf + 1, cx - 3, y0 + h - 1, zf + 1, PAL.glassLight);
      if (def.kind === 'sheriff') {
        for (let x = cx - 4; x <= cx + 3; x += 2) g.box(x, y0, zf + 2, x, y0 + h - 1, zf + 2, PAL.metalDark);
      } else {
        g.box(cx, y0, zf + 1, cx, y0 + h - 1, zf + 1, trim);
        g.box(cx - 4, y0 + Math.floor(h / 2), zf + 1, cx + 3, y0 + Math.floor(h / 2), zf + 1, trim);
      }
      g.box(cx - 5, y0 - 2, zf + 2, cx + 4, y0 - 2, zf + 2, trim); // sill
    };
    win(dx - 10, 7, 10);
    win(dx + 18, 7, 10);
    if (W > 64) {
      win(dx - 24, 7, 10);
      win(dx + 32, 7, 10);
    }
    if (def.twoStory) for (let cx = 9; cx < W - 6; cx += 15) win(cx, 30, 11);

    if (def.kind === 'barber') {
      g.box(dx - 3, 6, zf + 2, dx - 3, 18, zf + 2, (_x, y) => (Math.floor(y / 2) % 2 ? 0xd8262e : 0xf8f8f8));
    }
  }

  // Porch: boardwalk, posts, roof
  const PZ0 = DEPTH, PZ1 = DEPTH + PORCH - 1;
  g.box(0, 0, PZ0 - 1, W - 1, 1, PZ1, (x, _y, z) => shadeHex(PAL.plank[3], (x % 6 === 0 ? 0.75 : 1) * (z % 2 ? 0.95 : 1.05)));
  const porchY = 22;
  const posts: number[] = [1, W - 3];
  if (W > 50) posts.push(Math.floor(W / 2) - 1);
  for (const px of posts) g.box(px, 2, PZ1 - 1, px + 1, porchY - 1, PZ1, PAL.woodDark);
  g.box(0, porchY, PZ0, W - 1, porchY + 1, PZ1, (x) => shadeHex(PAL.roof, x % 4 === 0 ? 0.85 : 1.05));
  g.box(0, porchY - 1, PZ1, W - 1, porchY - 1, PZ1, trim);
  if (def.twoStory) {
    // balcony railing on the porch roof
    for (let x = 0; x < W; x += 5) g.box(x, porchY + 2, PZ1, x, porchY + 5, PZ1, PAL.woodDark);
    g.box(0, porchY + 6, PZ1, W - 1, porchY + 6, PZ1, trim);
    g.box(0, porchY + 2, PZ0, 0, porchY + 6, PZ1, PAL.woodDark);
    g.box(W - 1, porchY + 2, PZ0, W - 1, porchY + 6, PZ1, PAL.woodDark);
  }
  // porch railing at ground level on some buildings
  if (r() < 0.4) {
    const y = 6;
    for (let x = 4; x < W - 4; x += 4) g.box(x, 2, PZ1, x, y, PZ1, PAL.woodDark);
    g.box(4, y + 1, PZ1, Math.floor(W / 2) - 6, y + 1, PZ1, PAL.plank[2]);
  }

  return { geo: meshGrid(g, BVS, [W / 2, 0, DEPTH + PORCH]), widthM: W * BVS };
}

const DEFS: BuildingDef[] = [
  { kind: 'saloon', sign: 'SALOON', width: 72, twoStory: true },
  { kind: 'bank', sign: 'BANK', width: 56, twoStory: false },
  { kind: 'hotel', sign: 'HOTEL', width: 64, twoStory: true },
  { kind: 'sheriff', sign: 'SHERIFF', width: 52, twoStory: false },
  { kind: 'store', sign: 'GENERAL STORE', width: 72, twoStory: false },
  { kind: 'barber', sign: 'BARBER', width: 44, twoStory: false },
  { kind: 'guns', sign: 'GUNS', width: 44, twoStory: false },
  { kind: 'post', sign: 'POST', width: 48, twoStory: false },
  { kind: 'livery', sign: 'LIVERY', width: 64, twoStory: false },
  { kind: 'plain', sign: null, width: 48, twoStory: true },
  { kind: 'plain', sign: 'JAIL', width: 44, twoStory: false },
  { kind: 'plain', sign: 'HOTEL', width: 56, twoStory: true },
];

let variants: BuildingVariant[] | null = null;
export function buildingVariants(): BuildingVariant[] {
  if (!variants) variants = DEFS.map((d, i) => buildBuilding(d, 100 + i * 17));
  return variants;
}

function makeStreetTexture(): THREE.CanvasTexture {
  const w = 128, h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const r = rng(9);
  const img = ctx.createImageData(w, h);
  // Canvas pixels are sRGB, so use the raw hex components (not THREE.Color, which is linear).
  const br = (PAL.dirt >> 16) & 255, bg = (PAL.dirt >> 8) & 255, bb = PAL.dirt & 255;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let f = 0.95 + r() * 0.07;
      // wheel ruts
      const ruts = [32, 44, 84, 96];
      for (const rx of ruts) if (Math.abs(x - rx) < 2) f *= 0.92;
      // occasional pebbles
      if (r() < 0.01) f *= 0.7;
      if (r() < 0.006) f *= 1.25;
      const i = (y * w + x) * 4;
      img.data[i] = Math.min(255, br * f);
      img.data[i + 1] = Math.min(255, bg * f);
      img.data[i + 2] = Math.min(255, bb * f);
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeSkyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#4a6aa8');
  grad.addColorStop(0.45, '#9ab0c8');
  grad.addColorStop(0.75, '#f0c890');
  grad.addColorStop(1, '#f0c890');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const FOG_COLOR = 0xf0c890;

let decorProps: { barrel: PropModel; crate: PropModel; hay: PropModel; trough: PropModel; hitch: PropModel; cactus: PropModel[] } | null = null;
function decor() {
  if (!decorProps)
    decorProps = {
      barrel: buildBarrel(3),
      crate: buildCrate(),
      hay: buildHay(),
      trough: buildTrough(),
      hitch: buildHitchingPost(),
      cactus: [buildCactus(1), buildCactus(2), buildCactus(3)],
    };
  return decorProps;
}

/**
 * Static street scenery from z = zStart down to z = zEnd (zEnd < zStart, players run toward -Z).
 */
export function buildStreet(zStart: number, zEnd: number, seed: number): THREE.Group {
  const group = new THREE.Group();
  const r = rng(seed);
  const vars = buildingVariants();
  const len = zStart - zEnd;

  // Street
  const tex = makeStreetTexture();
  tex.repeat.set(1, len / 20);
  const street = new THREE.Mesh(new THREE.PlaneGeometry(STREET_HALF * 2 + 0.2, len), new THREE.MeshBasicMaterial({ map: tex }));
  street.rotation.x = -Math.PI / 2;
  street.position.set(0, 0, (zStart + zEnd) / 2);
  group.add(street);
  // Surrounding desert ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, len + 200), new THREE.MeshBasicMaterial({ color: 0xc8a070 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.02, (zStart + zEnd) / 2);
  group.add(ground);

  const d = decor();
  const place = (pm: PropModel, x: number, z: number, rotY = 0) => {
    const m = new THREE.Mesh(pm.geo, voxelMaterial);
    m.position.set(x, 0, z);
    m.rotation.y = rotY;
    group.add(m);
    return m;
  };

  for (const side of [-1, 1]) {
    let z = zStart;
    let last = -1;
    while (z > zEnd - 10) {
      let idx = Math.floor(r() * vars.length);
      if (idx === last) idx = (idx + 1) % vars.length;
      last = idx;
      const v = vars[idx];
      const m = new THREE.Mesh(v.geo, voxelMaterial);
      const cz = z - v.widthM / 2;
      m.position.set(side * STREET_HALF, 0, cz);
      m.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      group.add(m);
      z -= v.widthM;
      // alley gap with a cactus or crates
      const gap = 0.6 + r() * 2.2;
      if (gap > 1.6) {
        const gz = z - gap / 2;
        if (r() < 0.5) place(d.cactus[Math.floor(r() * 3)], side * (STREET_HALF + 3), gz);
        else place(d.crate, side * (STREET_HALF + 1.2), gz, r());
      }
      z -= gap;
    }
  }

  // Street-side clutter in front of the porches (kept close to the edges so it never blocks the lane)
  for (let z = zStart - 6; z > zEnd; z -= 7 + r() * 9) {
    const side = r() < 0.5 ? -1 : 1;
    const x = side * (STREET_HALF - 0.45);
    const pick = r();
    if (pick < 0.35) place(d.barrel, x, z, r() * 6);
    else if (pick < 0.55) place(d.trough, side * (STREET_HALF - 0.5), z, Math.PI / 2);
    else if (pick < 0.75) place(d.hitch, side * (STREET_HALF - 0.3), z, Math.PI / 2);
    else if (pick < 0.88) place(d.hay, side * (STREET_HALF - 0.8), z, Math.PI / 2 + (r() - 0.5) * 0.4);
    else {
      place(d.barrel, x, z, r() * 6);
      place(d.barrel, x - side * 0.1, z - 0.9, r() * 6);
    }
  }

  return group;
}

/**
 * Distant backdrop (mesas, clouds, sun). Not affected by fog; colours are pre-hazed.
 * The group should follow the camera along Z so it never gets closer.
 */
export function buildBackdrop(): THREE.Group {
  const group = new THREE.Group();
  // Drawn first without depth so it always sits behind the town (acts as a painted background).
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthTest: false, depthWrite: false });
  const r = rng(42);
  // Mesas: flat-topped rock formations in layered bands
  const mesaCols = [0xd89a78, 0xc88a6a, 0xe0a888, 0xb87a62];
  for (let i = 0; i < 14; i++) {
    const w = 10 + Math.floor(r() * 14);
    const h = 4 + Math.floor(r() * 6);
    const g = new VoxelGrid(w, h, 4);
    const base = pick(mesaCols, r);
    for (let y = 0; y < h; y++) {
      const inset = y >= h - 2 ? 0 : Math.max(0, Math.floor((h - 2 - y) * -0.2));
      const shrink = y < h - 2 ? 0 : 0;
      const band = y % 3 === 0 ? 0.92 : 1;
      g.box(inset + shrink, y, 0, w - 1 - inset - shrink, y, 3, shadeHex(base, band));
    }
    // erode the top corners a bit
    g.box(0, h - 1, 0, 1, h - 1, 3, null);
    g.box(w - 2, h - 1, 0, w - 1, h - 1, 3, null);
    const m = new THREE.Mesh(meshGrid(g, 2.4, [w / 2, 0, 2]), mat);
    const ang = (r() - 0.5) * 1.9;
    const dist = 170 + r() * 30;
    m.position.set(Math.sin(ang) * dist, -2, -Math.cos(ang) * dist);
    m.rotation.y = -ang;
    group.add(m);
  }
  // Clouds: flat voxel slabs
  for (let i = 0; i < 9; i++) {
    const w = 6 + Math.floor(r() * 8);
    const g = new VoxelGrid(w, 2, 3);
    g.box(0, 0, 0, w - 1, 0, 2, 0xf8f0e8);
    g.box(1, 1, 0, w - 3, 1, 2, 0xffffff);
    const m = new THREE.Mesh(meshGrid(g, 2.2, [w / 2, 0, 1.5]), mat);
    const ang = (r() - 0.5) * 1.6;
    const dist = 120 + r() * 50;
    m.position.set(Math.sin(ang) * dist, 50 + r() * 35, -Math.cos(ang) * dist);
    m.rotation.y = -ang;
    group.add(m);
  }
  // Sun
  const sun = new THREE.Mesh(new THREE.CircleGeometry(9, 20), new THREE.MeshBasicMaterial({ color: 0xfff4d0, fog: false, depthTest: false, depthWrite: false }));
  sun.position.set(-40, 55, -170);
  sun.lookAt(0, 0, 0);
  group.add(sun);
  // keep everything inside the camera far plane (same angular size)
  group.scale.setScalar(0.45);
  group.traverse((o) => {
    o.renderOrder = -10;
    o.frustumCulled = false;
  });
  return group;
}

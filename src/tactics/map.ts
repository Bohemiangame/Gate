import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, voxelMaterial } from '../engine/voxel';
import { buildBuilding, BuildingDef, BuildingVariant } from '../gfx/town';
import {
  buildBarrel,
  buildCactus,
  buildCrate,
  buildCrateStack,
  buildFence,
  buildHay,
  buildHitchingPost,
  buildLamp,
  buildSandbags,
  buildTntCrate,
  buildTrough,
  buildWagon,
  buildWantedBoard,
  buildWaterTower,
  buildWell,
  buildRock,
  buildDeadTree,
  buildBoxcar,
  buildTrack,
  PropModel,
} from '../gfx/props';
import { PAL } from '../gfx/palette';

// ---------------------------------------------------------------------------
// Mission map: a patch of town (for now a plaza) with buildings around it,
// cover objects inside, cover slots around every cover and a nav grid.
// World axes: x = east, z = south (player comes from +z, bandits from -z).
// ---------------------------------------------------------------------------

export type CoverKind = 'barrel' | 'crate' | 'stack' | 'wagon' | 'hay' | 'trough' | 'sandbags' | 'fence' | 'well' | 'tower' | 'tnt' | 'rock' | 'rockBig' | 'boxcar';
export type MapKind = 'plaza' | 'desert' | 'rail';

/** Height (m) a cover protects up to. ≥ 1.6 = full cover even when standing. */
const COVER_HEIGHT: Record<CoverKind, number> = {
  barrel: 0.9,
  crate: 0.9,
  stack: 1.8,
  wagon: 1.3,
  hay: 0.8,
  trough: 0.7,
  sandbags: 1.1,
  fence: 1.1,
  well: 2.6,
  tower: 0,
  tnt: 0.9,
  rock: 0.9,
  rockBig: 2.0,
  boxcar: 2.6,
};
const COVER_HP: Record<CoverKind, number> = { barrel: 14, crate: 16, stack: 40, wagon: 45, hay: 20, trough: 25, sandbags: 60, fence: 18, well: 999, tower: 999, tnt: 1, rock: 999, rockBig: 999, boxcar: 999 };

export class CoverObj {
  alive = true;
  hp: number;
  readonly maxHp: number;
  readonly half: THREE.Vector3;
  readonly height: number;
  slots: CoverSlot[] = [];
  constructor(
    readonly id: number,
    readonly kind: CoverKind,
    readonly mesh: THREE.Mesh,
    readonly model: PropModel,
    readonly pos: THREE.Vector3,
    rotated: boolean,
  ) {
    const h = model.half;
    this.half = new THREE.Vector3(rotated ? h.z : h.x, h.y, rotated ? h.x : h.z);
    this.height = COVER_HEIGHT[kind];
    this.hp = this.maxHp = COVER_HP[kind];
  }
  get min(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x - this.half.x, 0, this.pos.z - this.half.z);
  }
  get max(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x + this.half.x, this.half.y, this.pos.z + this.half.z);
  }
  contains(x: number, z: number, pad = 0): boolean {
    return Math.abs(x - this.pos.x) <= this.half.x + pad && Math.abs(z - this.pos.z) <= this.half.z + pad;
  }
}

export class CoverSlot {
  occupant: unknown = null;
  reserved: unknown = null;
  constructor(
    readonly id: number,
    readonly pos: THREE.Vector3,
    /** Points away from the cover (towards where the unit stands). */
    readonly normal: THREE.Vector3,
    readonly cover: CoverObj,
  ) {}
  /** Does this slot protect against a shooter at `from`? */
  protects(from: THREE.Vector3): boolean {
    if (!this.cover.alive || this.cover.height <= 0) return false;
    const dx = from.x - this.pos.x;
    const dz = from.z - this.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    return (-this.normal.x * dx - this.normal.z * dz) / len > 0.35;
  }
  get free(): boolean {
    return !this.occupant && !this.reserved && this.cover.alive;
  }
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Walkability grid for A*. */
export class NavGrid {
  readonly cell = 0.5;
  readonly w: number;
  readonly h: number;
  blocked: Uint8Array;
  constructor(readonly b: Bounds) {
    this.w = Math.ceil((b.maxX - b.minX) / this.cell);
    this.h = Math.ceil((b.maxZ - b.minZ) / this.cell);
    this.blocked = new Uint8Array(this.w * this.h);
  }
  ix(x: number): number {
    return Math.max(0, Math.min(this.w - 1, Math.floor((x - this.b.minX) / this.cell)));
  }
  iz(z: number): number {
    return Math.max(0, Math.min(this.h - 1, Math.floor((z - this.b.minZ) / this.cell)));
  }
  cx(i: number): number {
    return this.b.minX + (i + 0.5) * this.cell;
  }
  cz(j: number): number {
    return this.b.minZ + (j + 0.5) * this.cell;
  }
  isBlocked(i: number, j: number): boolean {
    return i < 0 || j < 0 || i >= this.w || j >= this.h || this.blocked[i + j * this.w] === 1;
  }
  rebuild(covers: CoverObj[]): void {
    this.blocked.fill(0);
    for (const c of covers) {
      if (!c.alive) continue;
      const pad = 0.25;
      for (let j = this.iz(c.pos.z - c.half.z - pad); j <= this.iz(c.pos.z + c.half.z + pad); j++)
        for (let i = this.ix(c.pos.x - c.half.x - pad); i <= this.ix(c.pos.x + c.half.x + pad); i++) {
          if (c.contains(this.cx(i), this.cz(j), pad)) this.blocked[i + j * this.w] = 1;
        }
    }
  }
  /** Straight walk possible between two points? */
  clear(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const d = a.distanceTo(b);
    const steps = Math.ceil(d / (this.cell * 0.5));
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      if (this.isBlocked(this.ix(a.x + (b.x - a.x) * t), this.iz(a.z + (b.z - a.z) * t))) return false;
    }
    return true;
  }
  /** A* path (list of waypoints, smoothed). Falls back to a straight line. */
  path(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    if (this.clear(from, to)) return [to.clone()];
    const si = this.ix(from.x), sj = this.iz(from.z);
    let ti = this.ix(to.x), tj = this.iz(to.z);
    if (this.isBlocked(ti, tj)) {
      // nearest free cell around the target
      let best = -1, bd = Infinity;
      for (let dj = -3; dj <= 3; dj++)
        for (let di = -3; di <= 3; di++) {
          if (this.isBlocked(ti + di, tj + dj)) continue;
          const d = di * di + dj * dj;
          if (d < bd) {
            bd = d;
            best = ti + di + (tj + dj) * this.w;
          }
        }
      if (best < 0) return [to.clone()];
      ti = best % this.w;
      tj = Math.floor(best / this.w);
    }
    const N = this.w * this.h;
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const open: number[] = [];
    const f = new Float32Array(N).fill(Infinity);
    const start = si + sj * this.w;
    const goal = ti + tj * this.w;
    g[start] = 0;
    f[start] = Math.hypot(ti - si, tj - sj);
    open.push(start);
    const dirs = [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 1],
      [0, -1, 1],
      [1, 1, 1.414],
      [1, -1, 1.414],
      [-1, 1, 1.414],
      [-1, -1, 1.414],
    ];
    let iter = 0;
    while (open.length && iter++ < 6000) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
      const cur = open[bi];
      open.splice(bi, 1);
      if (cur === goal) break;
      closed[cur] = 1;
      const ci = cur % this.w, cj = Math.floor(cur / this.w);
      for (const [di, dj, c] of dirs) {
        const ni = ci + di, nj = cj + dj;
        if (this.isBlocked(ni, nj)) continue;
        if (di && dj && (this.isBlocked(ci + di, cj) || this.isBlocked(ci, cj + dj))) continue;
        const n = ni + nj * this.w;
        if (closed[n]) continue;
        const ng = g[cur] + c;
        if (ng < g[n]) {
          g[n] = ng;
          came[n] = cur;
          f[n] = ng + Math.hypot(ti - ni, tj - nj);
          if (!open.includes(n)) open.push(n);
        }
      }
    }
    if (came[goal] < 0 && goal !== start) return [to.clone()];
    const cells: THREE.Vector3[] = [];
    for (let c = goal; c !== start && c >= 0; c = came[c]) cells.push(new THREE.Vector3(this.cx(c % this.w), 0, this.cz(Math.floor(c / this.w))));
    cells.reverse();
    cells.push(to.clone());
    // string-pulling
    const out: THREE.Vector3[] = [];
    let anchor = from.clone();
    for (let k = 0; k < cells.length; k++) {
      const next = cells[k + 1];
      if (next && this.clear(anchor, next)) continue;
      out.push(cells[k]);
      anchor = cells[k];
    }
    return out.length ? out : [to.clone()];
  }
}

export interface MapData {
  group: THREE.Group;
  covers: CoverObj[];
  slots: CoverSlot[];
  bounds: Bounds;
  nav: NavGrid;
  playerSpawns: THREE.Vector3[];
  enemySpawns: THREE.Vector3[];
  /** Objective zone (centre + radius). */
  zone: { pos: THREE.Vector3; r: number };
}

const SIGNS = ['SALOON', 'BANK', 'HOTEL', 'SHERIFF', 'GENERAL STORE', 'BARBER', 'GUNS', 'POST', 'DOCTOR', 'JAIL', 'BAKERY', 'TAILOR', null, null];
const KINDS: BuildingDef['kind'][] = ['saloon', 'bank', 'hotel', 'sheriff', 'store', 'barber', 'guns', 'post', 'plain', 'plain', 'plain', 'plain', 'plain', 'livery'];

const buildingCache = new Map<number, BuildingVariant[]>();
function buildingSet(seed: number): BuildingVariant[] {
  let set = buildingCache.get(seed);
  if (set) return set;
  const r = rng(seed);
  set = [];
  for (let i = 0; i < 14; i++) {
    const kind = KINDS[i];
    const sign = SIGNS[i];
    const width = 40 + Math.floor(r() * 5) * 8;
    const stories = kind === 'livery' ? 1 : r() < 0.25 ? 3 : r() < 0.55 ? 2 : 1;
    set.push(buildBuilding({ kind, sign: kind === 'livery' ? 'LIVERY' : sign, width: Math.max(width, sign ? sign.length * 4 + 12 : 40), twoStory: stories > 1, stories, porch: r() < 0.8 }, seed * 31 + i * 7));
  }
  buildingCache.set(seed, set);
  return set;
}

const propCache = new Map<string, PropModel>();
function prop(kind: string, seed = 1): PropModel {
  const key = kind + seed;
  let m = propCache.get(key);
  if (!m) {
    const builders: Record<string, () => PropModel> = {
      barrel: () => buildBarrel(seed),
      crate: () => buildCrate(),
      stack: () => buildCrateStack(seed),
      wagon: () => buildWagon(),
      hay: () => buildHay(),
      trough: () => buildTrough(),
      sandbags: () => buildSandbags(3.2),
      fence: () => buildFence(4),
      well: () => buildWell(),
      tower: () => buildWaterTower(),
      tnt: () => buildTntCrate(),
      lamp: () => buildLamp(),
      wanted: () => buildWantedBoard(),
      hitch: () => buildHitchingPost(),
      cactus: () => buildCactus(seed),
      rock: () => buildRock(seed, false),
      rockBig: () => buildRock(seed, true),
      boxcar: () => buildBoxcar(seed),
      tree: () => buildDeadTree(seed),
      track: () => buildTrack(60),
    };
    m = builders[kind]();
    propCache.set(key, m);
  }
  return m;
}

function groundTexture(w: number, h: number, seed: number, base = [0xc9, 0x96, 0x5e], tracks = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const r = rng(seed);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let f = 0.95 + r() * 0.07;
      // large soft patches
      f *= 0.96 + 0.06 * Math.sin(x * 0.07 + Math.sin(y * 0.05) * 2) * Math.cos(y * 0.06);
      if (r() < 0.012) f *= 0.72;
      if (r() < 0.006) f *= 1.22;
      const i = (y * w + x) * 4;
      img.data[i] = Math.min(255, base[0] * f);
      img.data[i + 1] = Math.min(255, base[1] * f);
      img.data[i + 2] = Math.min(255, base[2] * f);
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  // wagon tracks crossing the plaza
  ctx.strokeStyle = tracks ? 'rgba(120,80,40,0.18)' : 'rgba(0,0,0,0)';
  ctx.lineWidth = 2;
  for (const off of [-10, 10, -30, 30]) {
    ctx.beginPath();
    ctx.moveTo(w / 2 + off, 0);
    ctx.bezierCurveTo(w / 2 + off * 1.4, h * 0.35, w / 2 + off * 0.6, h * 0.65, w / 2 + off, h);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Plaza mission map. `X`/`Z` = half size of the open area.
 */
export function generatePlaza(seed: number, scene: THREE.Object3D, X = 12, Z = 14): MapData {
  return generateMap('plaza', seed, scene, X, Z);
}

export const MAP_NAMES: Record<MapKind, string> = { plaza: 'Námestie', desert: 'Pustatina', rail: 'Železnica' };
export const MAP_GOALS: Record<MapKind, string> = { plaza: 'Vyčisti námestie od bandy', desert: 'Prepadnutie v pustatine – ubráň sa', rail: 'Zachráň stanicu pred bandou' };

/** When true, scenery is kept as separate named objects (for exporting the map to a 3D editor). */
export const mapExport = { separate: false };

export function generateMap(kind: MapKind, seed: number, scene: THREE.Object3D, X = 12, Z = 14): MapData {
  const r = rng(seed);
  const group = new THREE.Group();
  scene.add(group);
  const bounds: Bounds = { minX: -X, maxX: X, minZ: -Z, maxZ: Z };

  // ground
  const gtex = groundTexture(256, 288, seed, kind === 'desert' ? [0xd8, 0xb0, 0x7a] : [0xc9, 0x96, 0x5e], kind === 'plaza');
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(X * 2, Z * 2), new THREE.MeshBasicMaterial({ map: gtex }));
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshBasicMaterial({ color: kind === 'desert' ? 0xd2aa74 : PAL.dirt }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.02;
  group.add(outer);

  // ---- static scenery (merged) ----
  const statics: THREE.BufferGeometry[] = [];
  const tmp = new THREE.Object3D();
  const addStatic = (geo: THREE.BufferGeometry, x: number, z: number, rotY: number, name = 'decor') => {
    if (mapExport.separate) {
      const m = new THREE.Mesh(geo, voxelMaterial);
      m.name = name;
      m.position.set(x, 0, z);
      m.rotation.y = rotY;
      group.add(m);
      return;
    }
    tmp.position.set(x, 0, z);
    tmp.rotation.set(0, rotY, 0);
    tmp.updateMatrix();
    statics.push(geo.clone().applyMatrix4(tmp.matrix));
  };
  const vars = buildingSet(seed);
  let vi = Math.floor(r() * vars.length);
  /** Fill one side with buildings from a to b along its axis, leaving a gap [g0,g1] for a street. */
  const side = (axis: 'x' | 'z', fixed: number, rot: number, a: number, b: number, gap: [number, number] | null) => {
    let p = a;
    while (p < b - 2) {
      if (gap && p >= gap[0] - 0.5 && p < gap[1]) {
        p = gap[1];
        continue;
      }
      const v = vars[vi++ % vars.length];
      let wM = v.widthM;
      if (gap && p < gap[0] && p + wM > gap[0]) {
        // doesn't fit before the gap: fence the rest
        const len = gap[0] - p;
        if (len > 1) for (let q = p; q < gap[0] - 0.5; q += 4) addStatic(prop('fence').geo, axis === 'x' ? q + 2 : fixed, axis === 'x' ? fixed : q + 2, axis === 'x' ? 0 : Math.PI / 2, 'decor_fence');
        p = gap[0];
        continue;
      }
      if (p + wM > b + 3) {
        wM = b - p;
        if (wM < 3) break;
      }
      const c = p + v.widthM / 2;
      addStatic(v.geo, axis === 'x' ? c : fixed, axis === 'x' ? fixed : c, rot, `building_${(vi - 1) % vars.length}`);
      p += v.widthM + (r() < 0.3 ? 1 + r() * 1.5 : 0);
    }
  };
  if (kind === 'plaza') {
    side('x', -Z, 0, -X - 8, X + 8, [-3.5, 3.5]); // north, facing south; bandit street gap
    side('x', Z, Math.PI, -X - 8, X + 8, [-3.5, 3.5]); // south, facing north; our entry
    side('z', -X, Math.PI / 2, -Z + 1, Z - 1, r() < 0.6 ? [-2.5 + (r() - 0.5) * 8, 2.5 + (r() - 0.5) * 8] : null); // west
    side('z', X, -Math.PI / 2, -Z + 1, Z - 1, r() < 0.6 ? [-2.5, 2.5] : null); // east
    // decor that doesn't block (lamps, boards, hitching posts, cacti in the side streets)
    for (let k = 0; k < 8; k++) {
      const sx = (r() < 0.5 ? -1 : 1) * (X - 0.6);
      const sz = (r() - 0.5) * (Z * 1.6);
      addStatic(prop(r() < 0.5 ? 'lamp' : 'hitch').geo, sx, sz, Math.PI / 2);
    }
    addStatic(prop('wanted').geo, -4.6, Z - 0.8, Math.PI, 'decor_wanted');
    for (let k = 0; k < 6; k++) addStatic(prop('cactus', k + 1).geo, (r() - 0.5) * 8, -Z - 6 - r() * 10, r() * 6);
  } else if (kind === 'desert') {
    // open land: cacti, dead trees and rocks around (decor), a few inside (no cover)
    for (let k = 0; k < 40; k++) {
      const a = r() * Math.PI * 2;
      const d = 15 + r() * 25;
      const px = Math.cos(a) * d * 1.1, pz = Math.sin(a) * d;
      const t = r();
      addStatic(prop(t < 0.45 ? 'cactus' : t < 0.7 ? 'tree' : 'rockBig', 1 + (k % 5)).geo, px, pz, r() * 6);
    }
    for (let k = 0; k < 5; k++) addStatic(prop('cactus', 10 + k).geo, (r() - 0.5) * X * 1.8, (r() - 0.5) * Z * 1.8, r() * 6);
  } else {
    // railway: station + buildings in the south, tracks across, open prairie north
    side('x', Z, Math.PI, -X - 8, X + 8, [-3.5, 3.5]);
    addStatic(prop('track').geo, 0, -3, 0);
    for (let k = 0; k < 12; k++) addStatic(prop(r() < 0.5 ? 'cactus' : 'tree', 1 + (k % 5)).geo, (r() - 0.5) * 50, -Z - 3 - r() * 16, r() * 6);
  }

  const merged = statics.length ? mergeGeometries(statics, false) : null;
  for (const s of statics) s.dispose();
  if (merged) group.add(new THREE.Mesh(merged, voxelMaterial));

  // ---- covers ----
  const covers: CoverObj[] = [];
  let id = 0;
  const place = (kind: CoverKind, x: number, z: number, rotated: boolean, seedK = 1) => {
    const m = prop(kind, seedK);
    const mesh = new THREE.Mesh(m.geo, voxelMaterial);
    mesh.name = `cover_${kind}`;
    mesh.position.set(x, 0, z);
    mesh.rotation.y = rotated ? Math.PI / 2 : 0;
    group.add(mesh);
    const c = new CoverObj(id++, kind, mesh, m, mesh.position, rotated);
    // reject overlaps
    for (const o of covers) {
      if (Math.abs(o.pos.x - x) < o.half.x + c.half.x + 1.2 && Math.abs(o.pos.z - z) < o.half.z + c.half.z + 1.2) {
        group.remove(mesh);
        return null;
      }
    }
    covers.push(c);
    return c;
  };

  // landmark
  if (kind === 'plaza') {
    if (r() < 0.5) place('well', (r() - 0.5) * 3, (r() - 0.5) * 3, false);
    else place('tower', (r() < 0.5 ? -1 : 1) * (X - 5), -Z * 0.2, false);
  } else if (kind === 'rail') {
    // freight cars on the track with gaps to run through
    let x = -X - 2 + r() * 3;
    while (x < X) {
      place('boxcar', x + 3.2, -3, false, 1 + Math.floor(r() * 3));
      x += 6.4 + 3 + r() * 3;
    }
    place('tower', X - 1.5, -Z + 2.5, false);
  } else {
    place('wagon', (r() - 0.5) * 4, (r() - 0.5) * 4, r() < 0.5);
  }

  const weights: [CoverKind, number][] = kind === 'desert'
    ? [
        ['rock', 4],
        ['rockBig', 2],
        ['wagon', 0.6],
        ['hay', 0.6],
        ['barrel', 0.6],
      ]
    : kind === 'rail'
      ? [
          ['crate', 2],
          ['stack', 2.5],
          ['barrel', 2],
          ['sandbags', 1],
          ['hay', 0.6],
        ]
      : [
    ['barrel', 3],
    ['crate', 2],
    ['stack', 2],
    ['wagon', 1.5],
    ['hay', 1.5],
    ['trough', 1.2],
          ['sandbags', 1],
          ['fence', 1],
        ];
  const total = weights.reduce((a, [, w]) => a + w, 0);
  const pickKind = (): CoverKind => {
    let q = r() * total;
    for (const [k, w] of weights) if ((q -= w) <= 0) return k;
    return 'barrel';
  };
  const step = 4.3;
  for (let z = -Z + 3; z <= Z - 3; z += step)
    for (let x = -X + 2.5; x <= X - 2.5; x += step) {
      const px = x + (r() - 0.5) * 2.4;
      const pz = z + (r() - 0.5) * 2.4;
      if (pz > Z - 4 && Math.abs(px) < 5) continue; // our spawn
      if (pz < -Z + 3 && Math.abs(px) < 4) continue; // bandit spawn
      if (r() < 0.12) continue;
      const kind = pickKind();
      const c = place(kind, px, pz, ['wagon', 'trough', 'hay', 'sandbags', 'fence'].includes(kind) ? r() < 0.75 : r() < 0.5, 1 + Math.floor(r() * 3));
      // barrels like company
      if (c && kind === 'barrel' && r() < 0.6) place('barrel', px + 0.95, pz + (r() - 0.5) * 0.3, false, 2);
    }
  // a couple of TNT crates in the bandit half
  for (let k = 0; k < 2; k++) place('tnt', (r() - 0.5) * X * 1.4, -Z * 0.35 - r() * Z * 0.4, false);

  // ---- slots ----
  const slots: CoverSlot[] = [];
  let sid = 0;
  for (const c of covers) {
    if (c.height <= 0 || c.kind === 'tnt') continue;
    for (const [nx, nz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const along = nx ? c.half.z : c.half.x;
      const out = nx ? c.half.x : c.half.z;
      const n = Math.max(1, Math.floor((along * 2) / 0.85));
      for (let k = 0; k < n; k++) {
        const t = n === 1 ? 0 : -along + 0.42 + (k * (along * 2 - 0.84)) / (n - 1);
        const p = new THREE.Vector3(c.pos.x + nx * (out + 0.42) + (nz ? t : 0), 0, c.pos.z + nz * (out + 0.42) + (nx ? t : 0));
        if (p.x < -X + 0.5 || p.x > X - 0.5 || p.z < -Z + 0.5 || p.z > Z - 0.5) continue;
        if (covers.some((o) => o !== c && o.alive && o.contains(p.x, p.z, 0.3))) continue;
        const s = new CoverSlot(sid++, p, new THREE.Vector3(nx, 0, nz), c);
        c.slots.push(s);
        slots.push(s);
      }
    }
  }

  const nav = new NavGrid(bounds);
  nav.rebuild(covers);

  const playerSpawns = [new THREE.Vector3(0, 0, Z - 1.5), new THREE.Vector3(-2.5, 0, Z - 1.5), new THREE.Vector3(2.5, 0, Z - 1.5)];
  const enemySpawns = [new THREE.Vector3(0, 0, -Z + 0.8), new THREE.Vector3(-2, 0, -Z + 0.8), new THREE.Vector3(2, 0, -Z + 0.8)];
  return { group, covers, slots, bounds, nav, playerSpawns, enemySpawns, zone: { pos: new THREE.Vector3(0, 0, 0), r: 6 } };
}

import * as THREE from 'three';

/**
 * Dense voxel grid. A cell holds 0 (empty) or an sRGB colour + 1 (so black is still "filled").
 * Models are authored in integer voxel coordinates and turned into a single BufferGeometry
 * with greedy meshing (adjacent faces of the same colour are merged into one quad).
 */
export class VoxelGrid {
  readonly data: Int32Array;
  constructor(
    readonly sx: number,
    readonly sy: number,
    readonly sz: number,
  ) {
    this.data = new Int32Array(sx * sy * sz);
  }

  inside(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  set(x: number, y: number, z: number, color: number | null): void {
    x = Math.round(x);
    y = Math.round(y);
    z = Math.round(z);
    if (!this.inside(x, y, z)) return;
    this.data[x + this.sx * (y + this.sy * z)] = color === null ? 0 : color + 1;
  }

  /** Raw cell value: 0 = empty, otherwise colour + 1. */
  raw(x: number, y: number, z: number): number {
    if (!this.inside(x, y, z)) return 0;
    return this.data[x + this.sx * (y + this.sy * z)];
  }

  filled(x: number, y: number, z: number): boolean {
    return this.raw(x, y, z) !== 0;
  }

  /** Inclusive box fill. `color` may be a function for patterns (planks, noise). */
  box(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    color: number | null | ((x: number, y: number, z: number) => number | null),
  ): this {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1);
    const ay = Math.min(y0, y1), by = Math.max(y0, y1);
    const az = Math.min(z0, z1), bz = Math.max(z0, z1);
    for (let z = az; z <= bz; z++)
      for (let y = ay; y <= by; y++)
        for (let x = ax; x <= bx; x++) {
          const c = typeof color === 'function' ? color(x, y, z) : color;
          this.set(x, y, z, c);
        }
    return this;
  }

  /** Iterate filled cells (used for debris when a model breaks apart). */
  forEach(fn: (x: number, y: number, z: number, color: number) => void, stride = 1): void {
    for (let z = 0; z < this.sz; z += stride)
      for (let y = 0; y < this.sy; y += stride)
        for (let x = 0; x < this.sx; x += stride) {
          const v = this.data[x + this.sx * (y + this.sy * z)];
          if (v) fn(x, y, z, v - 1);
        }
  }
}

// Baked directional shading per face (+x,-x,+y,-y,+z,-z). Gives the flat retro look
// with MeshBasicMaterial, so no lights are needed at runtime.
const SHADE = [0.82, 0.74, 1.0, 0.5, 0.92, 0.68];

const tmpColor = new THREE.Color();

/**
 * Greedy-mesh a grid into a geometry.
 * @param size     size of one voxel in metres
 * @param pivot    grid coordinate that becomes the geometry origin
 */
export function meshGrid(grid: VoxelGrid, size: number, pivot: [number, number, number] = [0, 0, 0]): THREE.BufferGeometry {
  const dims = [grid.sx, grid.sy, grid.sz];
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const x = [0, 0, 0];
  const q = [0, 0, 0];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    q[0] = q[1] = q[2] = 0;
    q[d] = 1;
    const mask = new Int32Array(dims[u] * dims[v]);

    for (x[d] = -1; x[d] < dims[d]; ) {
      let n = 0;
      for (x[v] = 0; x[v] < dims[v]; x[v]++)
        for (x[u] = 0; x[u] < dims[u]; x[u]++) {
          const a = x[d] >= 0 ? grid.raw(x[0], x[1], x[2]) : 0;
          const b = x[d] < dims[d] - 1 ? grid.raw(x[0] + q[0], x[1] + q[1], x[2] + q[2]) : 0;
          if (!!a === !!b) mask[n++] = 0;
          else if (a) mask[n++] = a;
          else mask[n++] = -b;
        }
      x[d]++;

      n = 0;
      for (let j = 0; j < dims[v]; j++) {
        for (let i = 0; i < dims[u]; ) {
          const c = mask[n];
          if (!c) {
            i++;
            n++;
            continue;
          }
          let w = 1;
          while (i + w < dims[u] && mask[n + w] === c) w++;
          let h = 1;
          outer: for (; j + h < dims[v]; h++) {
            for (let k = 0; k < w; k++) if (mask[n + k + h * dims[u]] !== c) break outer;
          }

          const p = [0, 0, 0];
          p[d] = x[d];
          p[u] = i;
          p[v] = j;
          const du = [0, 0, 0];
          const dv = [0, 0, 0];
          du[u] = w;
          dv[v] = h;

          const base = positions.length / 3;
          const corners = [
            [p[0], p[1], p[2]],
            [p[0] + du[0], p[1] + du[1], p[2] + du[2]],
            [p[0] + du[0] + dv[0], p[1] + du[1] + dv[1], p[2] + du[2] + dv[2]],
            [p[0] + dv[0], p[1] + dv[1], p[2] + dv[2]],
          ];
          for (const cr of corners)
            positions.push((cr[0] - pivot[0]) * size, (cr[1] - pivot[1]) * size, (cr[2] - pivot[2]) * size);

          const positive = c > 0;
          tmpColor.setHex(Math.abs(c) - 1);
          const s = SHADE[d * 2 + (positive ? 0 : 1)];
          for (let k = 0; k < 4; k++) colors.push(tmpColor.r * s, tmpColor.g * s, tmpColor.b * s);

          if (positive) indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          else indices.push(base, base + 2, base + 1, base, base + 3, base + 2);

          for (let l = 0; l < h; l++) for (let k = 0; k < w; k++) mask[n + k + l * dims[u]] = 0;
          i += w;
          n += w;
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** Deterministic PRNG so procedural content is stable between runs (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Darken/lighten an sRGB hex colour by factor f (component-wise multiply, clamped). */
export function shadeHex(hex: number, f: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return (r << 16) | (g << 8) | b;
}

/** Shared material for all voxel meshes (colours + baked shading are in the vertices). */
export const voxelMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
/** White flash used when something is hit. */
export const flashMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });

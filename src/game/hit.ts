import * as THREE from 'three';

/** Ray vs axis-aligned box (slab method). Returns distance along the ray or -1. */
export function rayBox(o: THREE.Vector3, d: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3): number {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (const a of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < min[a] || o[a] > max[a]) return -1;
    } else {
      let t1 = (min[a] - o[a]) / d[a];
      let t2 = (max[a] - o[a]) / d[a];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  if (tmax < 0) return -1;
  return tmin >= 0 ? tmin : 0;
}

export type HitPart = 'head' | 'body' | 'object';

export interface Hittable {
  alive: boolean;
  /** Fill boxes for this frame; return false when it can't be hit right now. */
  boxes(out: { min: THREE.Vector3; max: THREE.Vector3; part: HitPart }[]): void;
}

export interface RayHit {
  target: Hittable;
  part: HitPart;
  dist: number;
  point: THREE.Vector3;
}

const scratch: { min: THREE.Vector3; max: THREE.Vector3; part: HitPart }[] = [];
for (let i = 0; i < 4; i++) scratch.push({ min: new THREE.Vector3(), max: new THREE.Vector3(), part: 'body' });
const boxBuf: { min: THREE.Vector3; max: THREE.Vector3; part: HitPart }[] = [];

/** Closest hit along a ray among targets. `grow` enlarges boxes (aim assist). */
export function raycast(o: THREE.Vector3, d: THREE.Vector3, targets: Iterable<Hittable>, maxDist = 200, grow = 0): RayHit | null {
  let best: RayHit | null = null;
  const gmin = new THREE.Vector3();
  const gmax = new THREE.Vector3();
  for (const t of targets) {
    if (!t.alive) continue;
    boxBuf.length = 0;
    t.boxes(boxBuf);
    for (const b of boxBuf) {
      gmin.copy(b.min).subScalar(grow);
      gmax.copy(b.max).addScalar(grow);
      const dist = rayBox(o, d, gmin, gmax);
      if (dist < 0 || dist > maxDist) continue;
      // prefer head when head and body overlap at nearly the same distance
      if (!best || dist < best.dist - 0.05 || (Math.abs(dist - best.dist) <= 0.05 && b.part === 'head' && best.target === t)) {
        best = { target: t, part: b.part, dist, point: o.clone().addScaledVector(d, dist) };
      }
    }
  }
  return best;
}

export function makeBox(min: THREE.Vector3, max: THREE.Vector3, part: HitPart = 'object') {
  return { min, max, part };
}
void scratch;

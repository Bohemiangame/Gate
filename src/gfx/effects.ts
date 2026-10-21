import * as THREE from 'three';
import type { DebrisVoxel } from './characterModels';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/** Pooled voxel debris / dust particles rendered as one InstancedMesh. */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private spin: Float32Array;
  private grav: Float32Array;
  private next = 0;

  constructor(private capacity = 1600) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    tmpM.makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, tmpM);
      this.mesh.setColorAt(i, tmpC.set(0xffffff));
    }
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, color: number, size: number, life: number, gravity = 9.8): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.spin[i] = (Math.random() - 0.5) * 12;
    this.grav[i] = gravity;
    this.mesh.setColorAt(i, tmpC.setHex(color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Break a model into flying voxels. `matrix` maps model space → world. */
  burst(debris: DebrisVoxel[], matrix: THREE.Matrix4, origin: THREE.Vector3, force = 3.5, voxel = 0.07, max = 260): void {
    const step = Math.max(1, Math.ceil(debris.length / max));
    for (let k = 0; k < debris.length; k += step) {
      const d = debris[k];
      tmpV.copy(d.p).applyMatrix4(matrix);
      const dir = tmpS.copy(tmpV).sub(origin);
      dir.y = Math.abs(dir.y) + 0.3;
      dir.normalize().multiplyScalar(force * (0.5 + Math.random()));
      dir.x += (Math.random() - 0.5) * 1.5;
      dir.z += (Math.random() - 0.5) * 1.5;
      this.spawn(tmpV, dir, d.color, voxel * (step > 1 ? 1.25 : 1), 1.1 + Math.random() * 0.7);
    }
  }

  dust(p: THREE.Vector3, count = 6, color = 0xd8b88a, spread = 0.6): void {
    for (let k = 0; k < count; k++) {
      tmpV.set(p.x + (Math.random() - 0.5) * spread, p.y + Math.random() * 0.2, p.z + (Math.random() - 0.5) * spread);
      tmpS.set((Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 1.2, (Math.random() - 0.5) * 1.2);
      this.spawn(tmpV, tmpS, color, 0.1 + Math.random() * 0.1, 0.5 + Math.random() * 0.4, 0.5);
    }
  }

  update(dt: number): void {
    const n = this.capacity;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const o = i * 3;
      if (this.life[i] <= 0) {
        tmpM.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, tmpM);
        continue;
      }
      this.vel[o + 1] -= this.grav[i] * dt;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      if (this.pos[o + 1] < this.size[i] / 2) {
        this.pos[o + 1] = this.size[i] / 2;
        this.vel[o + 1] *= -0.3;
        this.vel[o] *= 0.6;
        this.vel[o + 2] *= 0.6;
        this.spin[i] *= 0.5;
      }
      const t = this.life[i] / this.maxLife[i];
      const s = this.size[i] * Math.min(1, t * 3);
      tmpQ.setFromAxisAngle(UP, (this.maxLife[i] - this.life[i]) * this.spin[i]);
      tmpS.set(s, s, s);
      tmpV.set(this.pos[o], this.pos[o + 1], this.pos[o + 2]);
      tmpM.compose(tmpV, tmpQ, tmpS);
      this.mesh.setMatrixAt(i, tmpM);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Bullet tracers: short-lived glowing streaks (pooled stretched boxes). */
export class Tracers {
  readonly group = new THREE.Group();
  private items: { mesh: THREE.Mesh; life: number }[] = [];
  private next = 0;

  constructor(capacity = 64) {
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    for (let i = 0; i < capacity; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.items.push({ mesh, life: 0 });
    }
  }

  fire(from: THREE.Vector3, to: THREE.Vector3, color = 0xfff0a0, width = 0.035): void {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    const len = from.distanceTo(to);
    it.mesh.position.copy(from);
    it.mesh.lookAt(to);
    it.mesh.scale.set(width, width, len);
    (it.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    (it.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
    it.mesh.visible = true;
    it.life = 0.09;
  }

  update(dt: number): void {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      const m = it.mesh.material as THREE.MeshBasicMaterial;
      m.opacity = Math.max(0, it.life / 0.09);
      if (it.life <= 0) it.mesh.visible = false;
    }
  }
}

function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Muzzle flashes and explosion flashes (pooled additive sprites). */
export class Flashes {
  readonly group = new THREE.Group();
  private items: { s: THREE.Sprite; life: number; max: number; grow: number }[] = [];
  private next = 0;

  constructor(capacity = 40) {
    const tex = radialTexture('rgba(255,250,210,1)', 'rgba(255,160,40,0)');
    for (let i = 0; i < capacity; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.visible = false;
      this.group.add(s);
      this.items.push({ s, life: 0, max: 1, grow: 0 });
    }
  }

  spawn(p: THREE.Vector3, size = 0.35, life = 0.05, grow = 0): void {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    it.s.position.copy(p);
    it.s.scale.setScalar(size);
    it.s.material.rotation = Math.random() * 6;
    it.s.visible = true;
    it.life = it.max = life;
    it.grow = grow;
  }

  update(dt: number): void {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.grow) it.s.scale.addScalar(it.grow * dt);
      it.s.material.opacity = Math.max(0, it.life / it.max);
      if (it.life <= 0) it.s.visible = false;
    }
  }
}

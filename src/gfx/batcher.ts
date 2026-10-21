import * as THREE from 'three';
import { voxelMaterial } from '../engine/voxel';
import { characters, shadowGeo } from './character';

const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
const WHITE = new THREE.Color(1, 1, 1);
const FLASH = new THREE.Color(5, 5, 5); // multiplies vertex colours → near white

interface Pool {
  mesh: THREE.InstancedMesh;
  count: number;
  cap: number;
}

/**
 * Draws all characters with one InstancedMesh per distinct part geometry
 * (≈ a few dozen draw calls instead of ~10 per character).
 */
export class CharacterBatcher {
  private pools = new Map<THREE.BufferGeometry, Pool>();
  constructor(private scene: THREE.Scene) {}

  /** Pool for `geo` with room for one more instance. */
  private pool(geo: THREE.BufferGeometry): Pool {
    let p = this.pools.get(geo);
    if (p && p.count < p.cap) return p;
    const cap = Math.max(16, (p?.cap ?? 8) * 2);
    const mesh = new THREE.InstancedMesh(geo, geo === shadowGeo ? shadowMat : voxelMaterial, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    if (geo === shadowGeo) mesh.renderOrder = -1;
    else mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    if (p) {
      // keep the instances already written this frame
      (mesh.instanceMatrix.array as Float32Array).set(p.mesh.instanceMatrix.array as Float32Array);
      if (p.mesh.instanceColor && mesh.instanceColor) (mesh.instanceColor.array as Float32Array).set(p.mesh.instanceColor.array as Float32Array);
      this.scene.remove(p.mesh);
      p.mesh.dispose();
    }
    this.scene.add(mesh);
    const np: Pool = { mesh, count: p?.count ?? 0, cap };
    this.pools.set(geo, np);
    return np;
  }

  dispose(): void {
    for (const p of this.pools.values()) {
      this.scene.remove(p.mesh);
      p.mesh.dispose();
    }
    this.pools.clear();
  }

  sync(): void {
    for (const p of this.pools.values()) p.count = 0;
    for (const c of characters) {
      if (!c.root.visible || !attached(c.root)) continue;
      c.root.updateMatrixWorld(true);
      const col = c.flashT > 0 ? FLASH : WHITE;
      for (const part of c.parts) {
        const p = this.pool(part.geometry);
        p.mesh.setMatrixAt(p.count, part.matrixWorld);
        p.mesh.setColorAt(p.count, col);
        p.count++;
      }
      const sp = this.pool(shadowGeo);
      sp.mesh.setMatrixAt(sp.count, c.shadow.matrixWorld);
      sp.count++;
    }
    for (const p of this.pools.values()) {
      p.mesh.count = p.count;
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
    }
  }
}

function attached(o: THREE.Object3D): boolean {
  let n: THREE.Object3D | null = o;
  while (n) {
    if ((n as THREE.Scene).isScene) return true;
    n = n.parent;
  }
  return false;
}

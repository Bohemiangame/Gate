import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { generateMap, mapExport, MapKind } from './map';
import { makeCharacter } from '../gfx/models';
import { voxelMaterial } from '../engine/voxel';

/**
 * ?tactics&export&map=plaza&seed=7 – builds one map with every object separate and named,
 * exposes window.exportGLB() (base64 .glb) and renders a top-down plan with a 1 m grid.
 */
export function startExport(view: { scene: THREE.Scene; renderer: THREE.WebGLRenderer }, params: URLSearchParams): void {
  mapExport.separate = true;
  const kind = (params.get('map') ?? 'plaza') as MapKind;
  const seed = parseInt(params.get('seed') ?? '7', 10);
  const root = new THREE.Group();
  root.name = `map_${kind}_${seed}`;
  const map = generateMap(kind, seed, root);
  // spawn markers + a reference man (1.86 m) for scale
  for (const [i, p] of map.playerSpawns.entries()) {
    const o = new THREE.Object3D();
    o.name = `spawn_player_${i}`;
    o.position.copy(p);
    root.add(o);
  }
  for (const [i, p] of map.enemySpawns.entries()) {
    const o = new THREE.Object3D();
    o.name = `spawn_enemy_${i}`;
    o.position.copy(p);
    root.add(o);
  }
  const ref = makeCharacter('sheriff', 0, 'revolver');
  const man = new THREE.Group();
  man.name = 'reference_man_1_86m';
  for (const part of ref.parts) {
    ref.root.updateMatrixWorld(true);
    const m = new THREE.Mesh(part.geometry, voxelMaterial);
    m.applyMatrix4(part.matrixWorld);
    man.add(m);
  }
  man.position.set(0, 0, map.bounds.maxZ - 3);
  root.add(man);
  ref.dispose();
  view.scene.add(root);

  (window as unknown as { exportGLB: () => Promise<string> }).exportGLB = () =>
    new Promise((resolve, reject) => {
      new GLTFExporter().parse(
        root,
        (res) => {
          const bytes = new Uint8Array(res as ArrayBuffer);
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          resolve(btoa(bin));
        },
        (err) => reject(err),
        { binary: true, onlyVisible: true },
      );
    });

  // top-down plan: orthographic camera + 1 m grid (5 m lines brighter)
  const b = map.bounds;
  const pad = 9;
  const w = b.maxX - b.minX + pad * 2, h = b.maxZ - b.minZ + pad * 2;
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 100);
  cam.position.set(0, 50, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  const g1 = new THREE.GridHelper(80, 80, 0x000000, 0x000000);
  (g1.material as THREE.Material).opacity = 0.18;
  (g1.material as THREE.Material).transparent = true;
  g1.position.y = 0.06;
  const g5 = new THREE.GridHelper(80, 16, 0x000000, 0x000000);
  (g5.material as THREE.Material).opacity = 0.45;
  (g5.material as THREE.Material).transparent = true;
  g5.position.y = 0.07;
  view.scene.add(g1, g5);
  view.scene.fog = null;
  const px = 24; // pixels per metre
  view.renderer.setPixelRatio(1);
  view.renderer.setSize(w * px, h * px, false);
  const cv = view.renderer.domElement;
  cv.style.width = `${w * px}px`;
  cv.style.height = `${h * px}px`;
  view.renderer.render(view.scene, cam);
  (window as unknown as { planInfo: unknown }).planInfo = { w, h, px, bounds: b };
}

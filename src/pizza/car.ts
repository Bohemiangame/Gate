import * as THREE from 'three';
import { signTexture } from './textures';

export type CarType = 'hatch' | 'sedan' | 'van' | 'taxi' | 'pizza';

export interface CarModel {
  group: THREE.Group;
  wheels: THREE.Object3D[];
  frontWheels: THREE.Object3D[];
  brake: THREE.MeshStandardMaterial;
  length: number;
  width: number;
}

const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2a3e, roughness: 0.15, metalness: 0.4, emissive: 0x0a1424 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 0.3, metalness: 0.8 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.7 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 3 });
const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14).rotateZ(Math.PI / 2);
const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.25, 8).rotateZ(Math.PI / 2);

const SPECS: Record<CarType, { L: number; W: number; belt: number; roof: number; cabinFrom: number; cabinTo: number; hood: number; box?: boolean }> = {
  hatch: { L: 3.9, W: 1.75, belt: 0.98, roof: 1.47, cabinFrom: -1.65, cabinTo: 1.05, hood: 0.92 },
  pizza: { L: 3.9, W: 1.75, belt: 0.98, roof: 1.47, cabinFrom: -1.65, cabinTo: 1.05, hood: 0.92 },
  sedan: { L: 4.6, W: 1.8, belt: 0.96, roof: 1.42, cabinFrom: -1.3, cabinTo: 1.1, hood: 0.9 },
  taxi: { L: 4.6, W: 1.8, belt: 0.96, roof: 1.42, cabinFrom: -1.3, cabinTo: 1.1, hood: 0.9 },
  van: { L: 5.0, W: 1.95, belt: 1.15, roof: 2.15, cabinFrom: -2.45, cabinTo: 1.55, hood: 1.1, box: true },
};

/** Side profile → extruded body. Shape X = length (front at +X), Y = height. */
function bodyGeometry(s: (typeof SPECS)[CarType]): THREE.BufferGeometry {
  const h = s.L / 2;
  const sh = new THREE.Shape();
  sh.moveTo(-h, 0.32);
  sh.lineTo(-h, s.belt - 0.12);
  sh.quadraticCurveTo(-h, s.belt, -h + 0.18, s.belt);
  sh.lineTo(s.cabinTo, s.belt);
  sh.quadraticCurveTo(h - 0.35, s.hood, h - 0.06, s.hood - 0.14);
  sh.lineTo(h, 0.5);
  sh.quadraticCurveTo(h, 0.3, h - 0.2, 0.28);
  sh.lineTo(-h + 0.15, 0.28);
  sh.lineTo(-h, 0.32);
  const g = new THREE.ExtrudeGeometry(sh, { depth: s.W - 0.12, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -(s.W - 0.12) / 2);
  return g;
}

function cabinGeometry(s: (typeof SPECS)[CarType]): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  if (s.box) {
    sh.moveTo(s.cabinFrom, s.belt - 0.02);
    sh.lineTo(s.cabinFrom, s.roof);
    sh.lineTo(s.cabinTo - 0.5, s.roof);
    sh.lineTo(s.cabinTo, s.belt - 0.02);
  } else {
    sh.moveTo(s.cabinFrom, s.belt - 0.02);
    sh.lineTo(s.cabinFrom + 0.3, s.roof - 0.05);
    sh.quadraticCurveTo(s.cabinFrom + 0.4, s.roof, s.cabinFrom + 0.6, s.roof);
    sh.lineTo(s.cabinTo - 0.75, s.roof);
    sh.lineTo(s.cabinTo, s.belt - 0.02);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: s.W - 0.36, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -(s.W - 0.36) / 2);
  return g;
}

const geoCache = new Map<CarType, { body: THREE.BufferGeometry; cabin: THREE.BufferGeometry }>();

export function buildCar(type: CarType, color: number): CarModel {
  const s = SPECS[type];
  let gc = geoCache.get(type);
  if (!gc) {
    gc = { body: bodyGeometry(s), cabin: cabinGeometry(s) };
    geoCache.set(type, gc);
  }
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.45 });
  const brake = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a10, emissiveIntensity: 1.2 });
  // inner group in "profile space" (length along X), rotated so the car faces -Z
  const inner = new THREE.Group();
  inner.add(new THREE.Mesh(gc.body, paint));
  const cabin = new THREE.Mesh(gc.cabin, glassMat);
  inner.add(cabin);
  // roof panel in body colour
  const roofLen = s.box ? s.cabinTo - 0.5 - s.cabinFrom : s.cabinTo - 0.75 - (s.cabinFrom + 0.55);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(roofLen, 0.07, s.W - 0.3), paint);
  roof.position.set(s.box ? (s.cabinFrom + s.cabinTo - 0.5) / 2 : (s.cabinFrom + 0.55 + s.cabinTo - 0.75) / 2, s.roof + 0.03, 0);
  inner.add(roof);
  if (s.box) {
    // van: body-coloured box sides behind the front windows
    const side = new THREE.Mesh(new THREE.BoxGeometry(s.cabinTo - 1.1 - s.cabinFrom, s.roof - s.belt, s.W - 0.32), paint);
    side.position.set((s.cabinFrom + s.cabinTo - 1.1) / 2, (s.roof + s.belt) / 2, 0);
    inner.add(side);
  }
  // bumpers
  const h = s.L / 2;
  for (const x of [h + 0.02, -h - 0.02]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, s.W - 0.1), darkMat);
    b.position.set(x, 0.38, 0);
    inner.add(b);
  }
  // lights
  for (const z of [-(s.W / 2 - 0.3), s.W / 2 - 0.3]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.34), headMat);
    hl.position.set(h + 0.01, s.hood - 0.28, z);
    inner.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.32), brake);
    tl.position.set(-h - 0.01, s.belt - 0.22, z);
    inner.add(tl);
  }
  // wheels
  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];
  const wx = h - 0.78;
  for (const x of [wx, -wx])
    for (const z of [-(s.W / 2 - 0.12), s.W / 2 - 0.12]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.33, z);
      const axle = new THREE.Group();
      axle.rotation.y = Math.PI / 2; // cylinder axis along Z (profile space)
      const roll = new THREE.Group(); // rotates about the axle (local X) when driving
      roll.add(new THREE.Mesh(wheelGeo, tireMat), new THREE.Mesh(rimGeo, rimMat));
      axle.add(roll);
      pivot.add(axle);
      inner.add(pivot);
      wheels.push(roll);
      if (x > 0) frontWheels.push(pivot);
    }
  // roof signs
  if (type === 'pizza' || type === 'taxi') {
    const t = type === 'pizza' ? signTexture('PIZZA', '#e8402a', '#fff4d0') : signTexture('TAXI', '#f0c020', '#1a1a1a');
    const m = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 1.6 });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.9), [darkMat, darkMat, darkMat, darkMat, m, m]);
    sign.rotation.y = Math.PI / 2;
    sign.position.set(-0.1, s.roof + 0.22, 0);
    inner.add(sign);
  }
  inner.rotation.y = Math.PI / 2; // +X (front) → -Z
  const group = new THREE.Group();
  group.add(inner);
  return { group, wheels, frontWheels, brake, length: s.L, width: s.W };
}

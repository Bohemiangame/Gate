import * as THREE from 'three';
import { VoxelGrid, meshGrid, rng, shadeHex } from '../engine/voxel';
import { PAL, pick } from './palette';

/** Body voxel size: a character is ~31 voxels tall = ~1.86 m. */
export const VS = 0.06;
/** Guns use finer voxels so barrels/cylinders stay readable. */
export const GVS = 0.04;

export type Faction = 'posse' | 'bandit' | 'boss';
export type WeaponKind = 'revolver' | 'rifle' | 'shotgun' | 'dynamite' | 'gatling';
export const WEAPONS: WeaponKind[] = ['revolver', 'rifle', 'shotgun', 'dynamite', 'gatling'];

export interface DebrisVoxel {
  p: THREE.Vector3; // model space (rest pose)
  color: number;
}

export interface CharacterModel {
  faction: Faction;
  torso: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  armL: THREE.BufferGeometry;
  armR: THREE.BufferGeometry;
  thigh: THREE.BufferGeometry;
  shin: THREE.BufferGeometry;
  debris: DebrisVoxel[];
}

export interface GunModel {
  geo: THREE.BufferGeometry;
  /** Muzzle position in gun-local space (before the gun's rotation in the hand). */
  muzzle: THREE.Vector3;
  debris: DebrisVoxel[];
}

interface Look {
  skin: number;
  shirt: number;
  pants: number;
  hat: number;
  vest: number | null;
  coat: number | null;
  bandana: boolean;
  mustache: boolean;
  star: boolean;
  bandolier: boolean;
  hair: number;
  eyepatch: boolean;
  hatTall: boolean;
}

function lookFor(faction: Faction, seed: number): Look {
  const r = rng(seed * 7919 + 13);
  const skin = pick(PAL.skin, r);
  const hair = pick([0x2a1a10, 0x4a2e1a, 0x6a4a2a, 0x8a6a3a, 0x1a1210], r);
  if (faction === 'posse') {
    return {
      skin,
      hair,
      shirt: pick(PAL.posseShirt, r),
      pants: pick(PAL.pants, r),
      hat: pick(PAL.posseHat, r),
      vest: r() < 0.6 ? pick(PAL.posseVest, r) : null,
      coat: null,
      bandana: false,
      mustache: r() < 0.45,
      star: seed % 4 === 0,
      bandolier: false,
      eyepatch: false,
      hatTall: r() < 0.3,
    };
  }
  if (faction === 'boss') {
    return {
      skin: PAL.skin[1],
      hair: 0x1a1210,
      shirt: 0x6a1a1a,
      pants: 0x2a2420,
      hat: 0x141210,
      vest: null,
      coat: 0x1e1a1a,
      bandana: false,
      mustache: true,
      star: false,
      bandolier: true,
      eyepatch: true,
      hatTall: true,
    };
  }
  return {
    skin,
    hair,
    shirt: pick(PAL.banditShirt, r),
    pants: pick([0x3a3028, 0x4a3a2e, 0x2e2a28], r),
    hat: pick(PAL.banditHat, r),
    vest: null,
    coat: pick(PAL.banditCoat, r),
    bandana: true,
    mustache: false,
    star: false,
    bandolier: r() < 0.5,
    eyepatch: false,
    hatTall: r() < 0.4,
  };
}

function collect(grid: VoxelGrid, size: number, offset: THREE.Vector3, out: DebrisVoxel[], stride = 2): void {
  grid.forEach(
    (x, y, z, c) => {
      out.push({ p: new THREE.Vector3(x * size + offset.x, y * size + offset.y, z * size + offset.z), color: c });
    },
    stride,
  );
}

/**
 * Build a character model. Coordinates: facing +Z, character's right hand on -X.
 * Pivots: torso = waist, head = neck, arms = shoulder, thigh = hip, shin = knee.
 */
export function buildCharacter(faction: Faction, seed: number): CharacterModel {
  const L = lookFor(faction, seed);
  const debris: DebrisVoxel[] = [];

  // ---------- Torso: 8 x (3 tail + 9) x 5. Waist at y=3. ----------
  const torso = new VoxelGrid(8, 12, 5);
  const T0 = 3; // waist row
  torso.box(0, T0, 0, 7, T0 + 8, 4, L.shirt);
  // shoulders slightly darker at top-back for depth
  torso.box(0, T0 + 8, 0, 7, T0 + 8, 1, shadeHex(L.shirt, 0.85));
  if (L.coat !== null) {
    const coat = L.coat;
    // long coat: everything coat except an open strip at the front
    torso.box(0, T0, 0, 7, T0 + 8, 4, coat);
    torso.box(3, T0 + 2, 4, 4, T0 + 8, 4, L.shirt);
    // lapels
    torso.box(2, T0 + 5, 4, 2, T0 + 8, 4, shadeHex(coat, 1.3));
    torso.box(5, T0 + 5, 4, 5, T0 + 8, 4, shadeHex(coat, 1.3));
    // tails hanging over the thighs (back + sides)
    torso.box(0, 0, 0, 7, T0 - 1, 1, coat);
    torso.box(0, 0, 0, 0, T0 - 1, 3, coat);
    torso.box(7, 0, 0, 7, T0 - 1, 3, coat);
  }
  if (L.vest !== null) {
    const v = L.vest;
    torso.box(0, T0 + 2, 0, 7, T0 + 8, 0, v); // back
    torso.box(0, T0 + 2, 0, 0, T0 + 8, 4, v); // sides
    torso.box(7, T0 + 2, 0, 7, T0 + 8, 4, v);
    torso.box(0, T0 + 2, 4, 2, T0 + 7, 4, v); // front panels
    torso.box(5, T0 + 2, 4, 7, T0 + 7, 4, v);
  }
  // collar / neck
  torso.box(3, T0 + 8, 2, 4, T0 + 8, 3, L.skin);
  // belt + buckle + holster
  torso.box(0, T0, 0, 7, T0 + 1, 4, PAL.belt);
  torso.box(3, T0, 4, 4, T0 + 1, 4, PAL.buckle);
  torso.box(0, T0 - 2, 2, 0, T0 + 1, 3, PAL.woodDark);
  if (L.bandolier) {
    // diagonal ammo belt across the chest, front + back
    for (let i = 0; i < 8; i++) {
      const y = T0 + 1 + i;
      const x = 7 - i;
      torso.set(x, y, 4, i % 2 ? PAL.brass : PAL.belt);
      torso.set(x, y, 0, PAL.belt);
    }
  }
  if (L.star) {
    // sheriff star on the left chest (+X side)
    torso.box(5, T0 + 5, 4, 5, T0 + 6, 4, PAL.star);
    torso.set(6, T0 + 6, 4, PAL.star);
    torso.set(4, T0 + 5, 4, PAL.star);
  }

  // ---------- Head: 12 x 11 x 12 (with hat). Neck at y=0. ----------
  const head = new VoxelGrid(12, 12, 12);
  head.box(3, 0, 3, 8, 5, 8, L.skin);
  // hair at the back / sides under the hat
  head.box(3, 2, 3, 8, 5, 3, L.hair);
  head.box(3, 3, 3, 3, 5, 6, L.hair);
  head.box(8, 3, 3, 8, 5, 6, L.hair);
  // ears
  head.set(2, 3, 5, shadeHex(L.skin, 0.9));
  head.set(9, 3, 5, shadeHex(L.skin, 0.9));
  // eyes + brows (face is the z=8 side; character's right = low x)
  head.set(4, 3, 8, PAL.eye);
  head.set(7, 3, 8, PAL.eye);
  head.box(4, 4, 8, 4, 4, 8, shadeHex(L.hair, 1.2));
  head.box(7, 4, 8, 7, 4, 8, shadeHex(L.hair, 1.2));
  // nose
  head.box(5, 2, 9, 6, 2, 9, shadeHex(L.skin, 0.92));
  if (L.eyepatch) {
    head.set(4, 3, 8, 0x0a0a0a);
    head.box(3, 4, 8, 8, 4, 8, 0x0a0a0a);
  }
  if (L.mustache) head.box(4, 1, 9, 7, 1, 9, shadeHex(L.hair, 1.1));
  if (L.bandana) {
    head.box(3, 0, 8, 8, 2, 8, PAL.bandana);
    head.box(2, 0, 4, 2, 2, 8, PAL.bandanaDark);
    head.box(9, 0, 4, 9, 2, 8, PAL.bandanaDark);
    head.box(5, 0, 9, 6, 2, 9, PAL.bandana); // covers the nose
    head.set(5, 1, 10, PAL.bandanaDark);
  } else {
    head.box(5, 0, 8, 6, 0, 8, shadeHex(L.skin, 0.8)); // mouth/chin shadow
  }
  // hat: brim (rounded corners, curled sides), crown with band and pinch
  for (let x = 0; x < 12; x++)
    for (let z = 0; z < 12; z++) {
      const dx = Math.abs(x - 5.5);
      const dz = Math.abs(z - 5.5);
      if (dx + dz > 9.5) continue;
      head.set(x, 6, z, L.hat);
    }
  head.box(0, 7, 3, 0, 7, 8, L.hat);
  head.box(11, 7, 3, 11, 7, 8, L.hat);
  const crownTop = L.hatTall ? 10 : 9;
  head.box(3, 7, 3, 8, crownTop, 8, L.hat);
  head.box(3, 7, 3, 8, 7, 8, faction === 'boss' ? 0xc0c0c8 : PAL.hatBand);
  head.box(4, crownTop, 4, 7, crownTop, 7, null);
  head.box(4, crownTop, 4, 7, crownTop, 4, L.hat);
  head.box(4, crownTop, 7, 7, crownTop, 7, L.hat);
  head.box(5, crownTop, 5, 6, crownTop, 6, shadeHex(L.hat, 0.7));

  // ---------- Arms: 2 x 9 x 2, shoulder at top ----------
  const sleeve = L.coat ?? L.shirt;
  const arm = (gunHand: boolean): VoxelGrid => {
    const g = new VoxelGrid(2, 9, 2);
    g.box(0, 2, 0, 1, 8, 1, sleeve);
    g.box(0, 2, 0, 1, 2, 1, shadeHex(sleeve, 0.8)); // cuff
    g.box(0, 0, 0, 1, 1, 1, L.skin);
    if (faction !== 'posse' && gunHand) g.box(0, 1, 0, 1, 1, 1, 0x3a2a20); // glove
    return g;
  };
  const armLG = arm(false);
  const armRG = arm(true);

  // ---------- Legs: thigh 3x6x3 (hip at top), shin 3x6x4 (knee at top, boot toe +z) ----------
  const thigh = new VoxelGrid(3, 6, 3);
  thigh.box(0, 0, 0, 2, 5, 2, L.pants);
  thigh.box(0, 0, 2, 2, 0, 2, shadeHex(L.pants, 0.85));
  const shin = new VoxelGrid(3, 6, 4);
  shin.box(0, 3, 0, 2, 5, 2, L.pants);
  shin.box(0, 0, 0, 2, 3, 2, PAL.boot);
  shin.box(0, 0, 3, 2, 1, 3, PAL.boot);
  shin.box(0, 0, 0, 2, 0, 3, PAL.bootSole);
  shin.set(1, 4, 2, shadeHex(L.pants, 0.85));

  // Debris samples in model space (rest pose: hips at y=12)
  collect(torso, VS, new THREE.Vector3(-4 * VS, (12 - T0) * VS, -2.5 * VS), debris);
  collect(head, VS, new THREE.Vector3(-6 * VS, 21 * VS, -6 * VS), debris);
  collect(armLG, VS, new THREE.Vector3(4 * VS, 12 * VS, -1 * VS), debris, 1);
  collect(armRG, VS, new THREE.Vector3(-6 * VS, 12 * VS, -1 * VS), debris, 1);
  for (const sx of [-3.5, 0.5]) {
    collect(thigh, VS, new THREE.Vector3(sx * VS, 6 * VS, -1.5 * VS), debris);
    collect(shin, VS, new THREE.Vector3(sx * VS, 0, -1.5 * VS), debris);
  }

  return {
    faction,
    torso: meshGrid(torso, VS, [4, T0, 2.5]),
    head: meshGrid(head, VS, [6, 0, 6]),
    armL: meshGrid(armLG, VS, [1, 9, 1]),
    armR: meshGrid(armRG, VS, [1, 9, 1]),
    thigh: meshGrid(thigh, VS, [1.5, 6, 1.5]),
    shin: meshGrid(shin, VS, [1.5, 6, 1.5]),
    debris,
  };
}

/** Guns are modelled with the barrel along +Z and the grip going down (-Y); pivot = where the hand holds. */
export function buildGun(kind: WeaponKind): GunModel {
  let g: VoxelGrid;
  let pivot: [number, number, number];
  let muzzle: THREE.Vector3;
  const M = PAL.metal, MD = PAL.metalDark, ML = PAL.metalLight, W = PAL.wood, WD = PAL.woodDark;
  switch (kind) {
    case 'revolver': {
      g = new VoxelGrid(3, 8, 13);
      g.box(1, 4, 5, 1, 4, 12, MD); // barrel
      g.box(1, 5, 12, 1, 5, 12, ML); // front sight
      g.box(1, 3, 6, 1, 3, 9, M); // ejector rod
      g.box(0, 3, 3, 2, 5, 5, M); // cylinder
      g.box(0, 4, 3, 2, 4, 5, ML);
      g.box(1, 3, 1, 1, 5, 2, MD); // frame
      g.box(1, 6, 1, 1, 6, 1, MD); // hammer
      g.box(1, 0, 0, 1, 3, 2, W); // grip
      g.box(0, 0, 0, 2, 1, 1, WD);
      g.box(1, 2, 3, 1, 2, 4, MD); // trigger guard
      pivot = [1.5, 3, 2];
      muzzle = new THREE.Vector3(0, 4.5 - 3, 13 - 2).multiplyScalar(GVS);
      break;
    }
    case 'rifle': {
      g = new VoxelGrid(3, 7, 28);
      g.box(1, 0, 0, 1, 3, 2, W); // butt
      g.box(1, 1, 3, 1, 3, 7, W); // stock
      g.box(1, 2, 8, 1, 4, 12, MD); // receiver
      g.box(0, 3, 9, 2, 4, 11, M);
      g.box(1, 0, 9, 1, 1, 11, MD); // lever
      g.box(1, 4, 13, 1, 4, 27, MD); // barrel
      g.box(1, 3, 13, 1, 3, 22, W); // forend
      g.box(1, 3, 23, 1, 3, 26, M); // mag tube
      g.box(1, 5, 26, 1, 5, 26, ML); // sight
      pivot = [1.5, 2, 10];
      muzzle = new THREE.Vector3(0, 4.5 - 2, 28 - 10).multiplyScalar(GVS);
      break;
    }
    case 'shotgun': {
      g = new VoxelGrid(3, 6, 26);
      g.box(1, 0, 0, 1, 3, 2, WD);
      g.box(1, 1, 3, 1, 3, 7, WD);
      g.box(0, 2, 8, 2, 4, 11, M);
      g.box(0, 3, 12, 1, 4, 25, MD); // double barrel
      g.box(2, 3, 12, 2, 3, 18, W);
      g.box(0, 2, 12, 1, 2, 17, W);
      g.box(1, 1, 9, 1, 1, 10, MD);
      pivot = [1.5, 2, 10];
      muzzle = new THREE.Vector3(0, 4 - 2, 26 - 10).multiplyScalar(GVS);
      break;
    }
    case 'dynamite': {
      g = new VoxelGrid(5, 5, 9);
      g.box(0, 0, 0, 4, 2, 6, PAL.dynamite);
      g.box(1, 3, 0, 3, 3, 6, PAL.dynamite);
      g.box(0, 0, 2, 4, 3, 3, 0x1a1a1a); // band
      g.box(2, 2, 7, 2, 2, 8, PAL.fuse);
      g.set(2, 3, 8, 0xffd040);
      pivot = [2.5, 1, 2];
      muzzle = new THREE.Vector3(0, 0, 8 - 2).multiplyScalar(GVS);
      break;
    }
    case 'gatling': {
      g = new VoxelGrid(9, 10, 30);
      g.box(2, 1, 0, 6, 5, 9, MD); // body
      g.box(1, 2, 2, 7, 4, 7, M);
      g.box(3, 6, 3, 5, 9, 7, PAL.brass); // drum mag
      g.box(3, 7, 3, 5, 8, 7, shadeHex(PAL.brass, 0.8));
      for (const [bx, by] of [
        [3, 2],
        [5, 2],
        [2, 3],
        [6, 3],
        [3, 4],
        [5, 4],
      ])
        g.box(bx, by, 10, bx, by, 29, MD);
      g.box(2, 1, 12, 6, 5, 12, M);
      g.box(2, 1, 22, 6, 5, 22, M);
      g.box(4, 0, 4, 4, 0, 6, W); // grip
      g.box(8, 3, 5, 8, 5, 5, ML); // crank
      pivot = [4.5, 2, 6];
      muzzle = new THREE.Vector3(0, 3 - 2, 30 - 6).multiplyScalar(GVS);
      break;
    }
  }
  const debris: DebrisVoxel[] = [];
  collect(g, GVS, new THREE.Vector3(-pivot[0] * GVS, -pivot[1] * GVS, -pivot[2] * GVS), debris, 2);
  return { geo: meshGrid(g, GVS, pivot), muzzle, debris };
}

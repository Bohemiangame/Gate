import * as THREE from 'three';
import { VoxelGrid, meshGrid, rng, shadeHex, voxelMaterial } from '../engine/voxel';
import { rasterText, textWidth } from '../engine/font';
import { PAL } from '../gfx/palette';
import { gunModel, makeCharacter } from '../gfx/models';
import type { Character } from '../gfx/character';
import { Label } from '../gfx/label';

export type ShopKind = 'guns' | 'store' | 'saloon' | 'doctor' | 'sheriff';

const IV = 0.1; // interior voxel size
const W = 64, H = 32, D = 40; // room 6.4 x 3.2 x 4 m

export interface Interior {
  group: THREE.Group;
  keeper: Character;
  extras: Character[];
  /** Where the camera looks (centre of the counter area). */
  focus: THREE.Vector3;
  /** Price tag sprites positioned on items (updated by the shop UI). */
  tags: Label[];
}

function plank(x: number, z: number, tones: number[]): number {
  const len = 14 + ((z * 5) % 7);
  const off = (z * 11) % len;
  const joint = (x + off) % len === 0;
  const t = tones[(z * 3 + Math.floor((x + off) / len)) % tones.length];
  return joint ? shadeHex(t, 0.6) : t;
}

/** Room shell: floor, back wall, side walls, ceiling beams. Front is open towards the camera. */
function room(g: VoxelGrid, wall: number, floorTones: number[], seed: number): void {
  const r = rng(seed);
  g.box(0, 0, 0, W - 1, 0, D - 1, (x, _y, z) => plank(x, z, floorTones));
  // back wall (z = 0) with vertical boards
  g.box(0, 1, 0, W - 1, H - 1, 1, (x) => shadeHex(wall, x % 4 === 0 ? 0.82 : 0.96 + ((x * 7) % 5) * 0.015));
  // wainscot
  g.box(0, 1, 2, W - 1, 8, 2, (x) => shadeHex(wall, x % 3 === 0 ? 0.6 : 0.7));
  g.box(0, 9, 2, W - 1, 9, 2, shadeHex(wall, 1.2));
  // side walls
  g.box(0, 1, 0, 1, H - 1, D - 1, (_x, y, z) => shadeHex(wall, (z % 4 === 0 ? 0.78 : 0.9) * (y < 9 ? 0.8 : 1)));
  g.box(W - 2, 1, 0, W - 1, H - 1, D - 1, (_x, y, z) => shadeHex(wall, (z % 4 === 0 ? 0.78 : 0.9) * (y < 9 ? 0.8 : 1)));
  // ceiling beams
  for (let z = 4; z < D; z += 9) g.box(0, H - 2, z, W - 1, H - 1, z + 1, PAL.woodDark);
  // a window in the left wall
  g.box(0, 13, 14, 1, 21, 22, PAL.glassLight);
  g.box(0, 17, 14, 1, 17, 22, PAL.woodDark);
  void r;
}

function shelf(g: VoxelGrid, x0: number, x1: number, y: number): void {
  g.box(x0, y, 2, x1, y, 5, PAL.woodDark);
  g.box(x0, y - 2, 2, x0, y, 3, PAL.woodDark);
  g.box(x1, y - 2, 2, x1, y, 3, PAL.woodDark);
}

function counter(g: VoxelGrid, x0: number, x1: number, z0: number, z1: number, top: number, front: number): void {
  g.box(x0, 1, z0, x1, 10, z1, (x) => shadeHex(front, x % 5 === 0 ? 0.75 : 1));
  g.box(x0 - 1, 11, z0 - 1, x1 + 1, 11, z1 + 1, top);
  g.box(x0, 1, z1 + 1, x1, 2, z1 + 1, shadeHex(front, 0.6));
}

function sign(g: VoxelGrid, text: string, y: number, color = PAL.signText): void {
  const tw = textWidth(text);
  const bx = Math.floor(W / 2 - tw / 2) - 2;
  g.box(bx, y, 2, bx + tw + 3, y + 8, 2, PAL.sign);
  rasterText(text, (px, py) => g.set(bx + 2 + px, y + 2 + py, 3, color));
}

function bottles(g: VoxelGrid, x0: number, x1: number, y: number, r: () => number): void {
  for (let x = x0; x < x1; x += 2) {
    const c = [0x3a6a3a, 0x6a3a1a, 0x2a4a6a, 0x8a6a2a, 0x5a2a4a][Math.floor(r() * 5)];
    const h = 2 + Math.floor(r() * 2);
    g.box(x, y + 1, 4, x, y + h, 4, c);
    g.set(x, y + h + 1, 4, shadeHex(c, 1.3));
  }
}

function boxes(g: VoxelGrid, x0: number, x1: number, y: number, r: () => number, cols: number[]): void {
  for (let x = x0; x < x1 - 2; x += 4) {
    const c = cols[Math.floor(r() * cols.length)];
    const h = 2 + Math.floor(r() * 2);
    g.box(x, y + 1, 3, x + 2, y + h, 5, c);
    g.box(x, y + h, 3, x + 2, y + h, 3, shadeHex(c, 1.25));
  }
}

function table(g: VoxelGrid, cx: number, cz: number): void {
  g.box(cx - 4, 7, cz - 4, cx + 4, 7, cz + 4, PAL.plank[0]);
  g.box(cx, 1, cz, cx, 6, cz, PAL.woodDark);
  g.box(cx - 2, 1, cz - 2, cx + 2, 1, cz + 2, PAL.woodDark);
  for (const [dx, dz] of [
    [-6, 0],
    [6, 0],
  ]) {
    g.box(cx + dx - 1, 4, cz + dz - 1, cx + dx + 1, 4, cz + dz + 1, PAL.wood);
    g.box(cx + dx, 1, cz + dz, cx + dx, 3, cz + dz, PAL.woodDark);
  }
}

export function buildInterior(kind: ShopKind, parent: THREE.Object3D, extraCount = 0): Interior {
  const r = rng(kind.length * 97 + 3);
  const g = new VoxelGrid(W, H, D);
  const group = new THREE.Group();
  parent.add(group);
  const tags: Label[] = [];
  const keeperVariant = { guns: 0, store: 1, saloon: 2, doctor: 3, sheriff: 4 }[kind];
  const extras: Character[] = [];
  const addGun = (w: 'rifle' | 'shotgun' | 'revolver' | 'dynamite', x: number, y: number, z: number, rotY: number, rotZ = 0, scale = 1) => {
    const m = new THREE.Mesh(gunModel(w).geo, voxelMaterial);
    m.position.set((x - W / 2) * IV, y * IV, (z - D / 2) * IV);
    m.rotation.set(0, rotY, rotZ);
    m.scale.setScalar(scale);
    group.add(m);
  };

  switch (kind) {
    case 'guns': {
      room(g, 0x7a5a3a, [0x6a4a30, 0x5a3e28, 0x7a5638], 1);
      sign(g, 'GUNS', 23);
      // wall racks
      g.box(6, 11, 2, 26, 12, 3, PAL.woodDark);
      g.box(38, 11, 2, 58, 12, 3, PAL.woodDark);
      shelf(g, 6, 26, 8);
      shelf(g, 38, 58, 8);
      counter(g, 14, 50, 22, 26, 0x5a3a20, 0x8a5a32);
      boxes(g, 8, 24, 8, r, [0x8a6a3a, 0x6a7a4a, 0xa87848]);
      boxes(g, 40, 56, 8, r, [0x8a6a3a, 0xc83a2a, 0xa87848]);
      // barrel of rifles in the corner
      g.box(54, 1, 30, 59, 7, 35, PAL.plank[1]);
      break;
    }
    case 'store': {
      room(g, 0x8a7a5a, [0x9a8a70, 0x8a7a62, 0xa89878], 2);
      sign(g, 'GENERAL STORE', 24);
      for (const y of [8, 14, 20]) {
        shelf(g, 4, 28, y);
        shelf(g, 36, 60, y);
        boxes(g, 5, 27, y, r, [0xc89a5a, 0x5a8a8a, 0xb85a3a, 0xe8d8a8, 0x6a8a4a]);
        bottles(g, 37, 59, y, r);
      }
      counter(g, 12, 52, 22, 26, 0x6a4a2a, 0x9a6a3e);
      // sacks and a barrel in front
      g.box(4, 1, 30, 9, 5, 35, 0xd8c8a0);
      g.box(54, 1, 30, 59, 8, 35, PAL.plank[2]);
      break;
    }
    case 'saloon': {
      room(g, 0x8a3a2a, [0x5a3a24, 0x4a3020, 0x6a4428], 3);
      sign(g, 'SALOON', 25, 0xf0c840);
      // mirror + bottle shelves behind the bar
      g.box(20, 12, 2, 44, 20, 2, 0x8aa0b0);
      g.box(19, 11, 2, 45, 11, 3, PAL.brass);
      g.box(19, 21, 2, 45, 21, 3, PAL.brass);
      shelf(g, 4, 18, 13);
      shelf(g, 46, 60, 13);
      bottles(g, 5, 17, 13, r);
      bottles(g, 47, 59, 13, r);
      shelf(g, 4, 18, 18);
      bottles(g, 5, 17, 18, r);
      counter(g, 6, 58, 12, 16, 0x3a2010, 0x6a3a20);
      g.box(6, 1, 17, 58, 1, 17, PAL.brass);
      table(g, 14, 30);
      table(g, 50, 30);
      break;
    }
    case 'doctor': {
      room(g, 0xd8d0c0, [0x9a8a76, 0x8a7a68, 0xa89a84], 4);
      sign(g, 'DOCTOR', 24);
      // cabinet with bottles
      g.box(40, 1, 2, 60, 20, 6, 0xe8e0d0);
      for (const y of [7, 12, 17]) {
        g.box(41, y, 6, 59, y, 6, 0xb8b0a0);
        bottles(g, 42, 58, y, r);
      }
      // two beds
      for (const bz of [12, 28]) {
        g.box(4, 1, bz, 24, 5, bz + 8, 0x6a4a2a);
        g.box(5, 6, bz + 1, 23, 6, bz + 7, 0xf0f0f0);
        g.box(5, 7, bz + 1, 8, 7, bz + 7, 0xffffff);
      }
      counter(g, 30, 50, 24, 27, 0x5a3a20, 0x8a6a4a);
      break;
    }
    case 'sheriff': {
      room(g, 0x9a7a52, [0x7a5a3a, 0x6a4a30, 0x8a6a48], 5);
      sign(g, 'SHERIFF', 25, 0xffd84a);
      // wanted posters
      for (const px of [6, 14, 46, 54]) {
        g.box(px, 13, 2, px + 5, 20, 2, 0xe8d8b0);
        g.box(px + 1, 16, 2, px + 4, 18, 2, 0x5a3a2a);
      }
      // jail bars on the right
      for (let x = 44; x < 62; x += 2) g.box(x, 1, 30, x, 24, 30, PAL.metalDark);
      g.box(44, 24, 30, 61, 25, 30, PAL.metalDark);
      // desk
      counter(g, 16, 40, 20, 26, 0x4a2a14, 0x7a4a28);
      g.box(20, 12, 21, 24, 12, 24, 0xe8e0d0); // papers
      g.box(32, 12, 22, 33, 14, 23, PAL.brass); // lamp
      g.box(4, 11, 2, 12, 12, 3, PAL.woodDark); // gun rack
      break;
    }
  }

  const mesh = new THREE.Mesh(meshGrid(g, IV, [W / 2, 0, D / 2]), voxelMaterial);
  group.add(mesh);

  // keeper behind the counter
  const keeper = makeCharacter('town', keeperVariant, 'revolver');
  keeper.gun.visible = false;
  const keeperZ = kind === 'saloon' ? 8 : kind === 'sheriff' ? 14 : 16;
  keeper.root.position.set(0, 0, (keeperZ - D / 2) * IV);
  keeper.root.rotation.y = 0;
  keeper.pose = 'idle';
  group.add(keeper.root);

  // items shown on the walls / counter
  if (kind === 'guns') {
    addGun('rifle', 10, 15, 3, Math.PI / 2, -0.2, 1.4);
    addGun('rifle', 16, 15, 3, Math.PI / 2, -0.2, 1.4);
    addGun('shotgun', 42, 15, 3, Math.PI / 2, -0.2, 1.4);
    addGun('shotgun', 48, 15, 3, Math.PI / 2, -0.2, 1.4);
    addGun('revolver', 24, 12, 24, 0.4, 0, 1.6);
    addGun('revolver', 40, 12, 24, -0.6, 0, 1.6);
    addGun('rifle', 56, 9, 32, 0, -1.4, 1.2);
    tags.push(tagAt(group, 'PUŠKA', -1.9, 1.95, -1.6), tagAt(group, 'BROKOVNICA', 1.4, 1.95, -1.6));
  } else if (kind === 'sheriff') {
    addGun('rifle', 7, 13, 3, Math.PI / 2, -0.1, 1.3);
    addGun('shotgun', 10, 13, 3, Math.PI / 2, -0.1, 1.3);
  } else if (kind === 'store') {
    addGun('dynamite', 56, 9, 33, 0, 0, 1.6);
  }

  // extra people (saloon candidates, wounded men at the doctor)
  for (let i = 0; i < extraCount; i++) {
    if (kind === 'saloon') {
      const c = makeCharacter('posse', i * 3 + 1, 'revolver');
      const spots = [
        [-2.4, 0.6],
        [-0.9, 0.9],
        [2.6, 0.7],
      ];
      c.root.position.set(spots[i % 3][0], 0, spots[i % 3][1]);
      c.root.rotation.y = 0.3 - i * 0.25;
      c.pose = 'idle';
      group.add(c.root);
      extras.push(c);
    } else if (kind === 'doctor') {
      const c = makeCharacter('posse', i * 2, 'revolver');
      c.gun.visible = false;
      const bz = i === 0 ? 16 : 32;
      c.root.position.set((14 - W / 2) * IV, 0.75, (bz - D / 2) * IV);
      c.root.rotation.set(0, -Math.PI / 2, 0);
      c.body.rotation.x = -Math.PI / 2;
      c.pose = 'idle';
      group.add(c.root);
      extras.push(c);
    }
  }

  return { group, keeper, extras, focus: new THREE.Vector3(0, 1.3, -0.2), tags };
}

function tagAt(group: THREE.Group, text: string, x: number, y: number, z: number): Label {
  const l = new Label(text, 0.34, { color: '#3a2010', bg: 'rgba(240,226,190,0.95)', stroke: 'rgba(0,0,0,0)', px: 36 });
  l.sprite.position.set(x, y, z);
  group.add(l.sprite);
  return l;
}

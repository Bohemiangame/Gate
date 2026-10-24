import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../engine/voxel';
import { asphaltTexture, facadeTextures, FacadeStyle, grassTexture, neonTexture, pavingTexture, radialTexture } from './textures';
import { buildCar } from './car';

// ---------------------------------------------------------------------------
// Night city on a grid. Roads run along x = const and z = const lines every CELL metres.
// ---------------------------------------------------------------------------
export const CELL = 56;
export const ROAD_W = 10; // asphalt width (2 lanes)
export const WALK = 3; // sidewalk width
export const LANE = 2.5; // lane centre offset from the road centre (right-hand traffic)

export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Lot {
  cx: number;
  cz: number;
  w: number;
  d: number;
  /** Door on the sidewalk + the street it faces. */
  door: THREE.Vector3;
  street: string;
  number: number;
  kind: 'building' | 'park' | 'parking' | 'pizzeria';
  name?: string;
}

export interface City {
  group: THREE.Group;
  n: number;
  half: number;
  colliders: Collider[];
  lots: Lot[];
  pizzeria: Lot;
  /** Road line coordinates (same for x and z). */
  lines: number[];
  streetNamesX: string[]; // streets running along Z at x = lines[i]
  streetNamesZ: string[]; // streets running along X at z = lines[j]
  lampPools: THREE.InstancedMesh;
  signals: THREE.InstancedMesh;
  update(dt: number, time: number): void;
  /** Traffic light phase at intersection (i,j): true = traffic along X may go. */
  greenX(i: number, j: number, time: number): boolean;
}

const STREETS_X = ['Lipová', 'Hlavná', 'Dunajská', 'Mostová', 'Kamenná', 'Nová', 'Sadová', 'Hviezdna', 'Prístavná', 'Tichá', 'Polárna', 'Zlatá'];
const STREETS_Z = ['Obchodná', 'Námestie', 'Nábrežná', 'Kvetná', 'Tehelná', 'Vysoká', 'Južná', 'Svetlá', 'Neónová', 'Riečna', 'Krátka', 'Parková'];
const NEON_TEXTS = ['HOTEL', 'BAR', 'SUSHI', 'CINEMA', 'DINER', '24/7', 'MOTEL', 'CLUB', 'TACOS', 'RAMEN', 'OPEN', 'ARCADE', 'NOODLES', 'KARAOKE', 'GYM', 'BOWLING', 'JAZZ', 'CAFE', 'BURGER', 'LIQUOR'];
const NEON_COLORS = ['#ff3a9a', '#3af0ff', '#b46aff', '#ff8a2a', '#5aff7a', '#ffe23a', '#ff4a4a'];

/** Quad-based building shell with metre-based UVs so windows keep their real size. */
function shell(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, tileW: number, tileH: number, uOff: number, vOff: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const face = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number) => {
    const base = pos.length / 3;
    const len = Math.hypot(bx - ax, bz - az);
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
    const u0 = uOff, u1 = uOff + len / tileW, v0 = vOff + y0 / tileH, v1 = vOff + y1 / tileH;
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    for (let k = 0; k < 4; k++) nrm.push(nx, 0, nz);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  face(x0, z1, x1, z1, 0, 1); // +z
  face(x1, z1, x1, z0, 1, 0); // +x
  face(x1, z0, x0, z0, 0, -1); // -z
  face(x0, z0, x0, z1, -1, 0); // -x
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function boxAt(w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
}

/** Planar UVs in metres (for ground textures). */
function worldUV(g: THREE.BufferGeometry, scale: number): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  const uv: number[] = [];
  for (let i = 0; i < p.count; i++) uv.push(p.getX(i) / scale, p.getZ(i) / scale);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

export function buildCity(seed: number, n = 9): City {
  const r = rng(seed);
  const group = new THREE.Group();
  const half = (n * CELL) / 2;
  const lines: number[] = [];
  for (let k = 0; k <= n; k++) lines.push(k * CELL - half);

  // ---- materials ----
  const styles: FacadeStyle[] = ['glass', 'concrete', 'brick', 'dark'];
  const facades = styles.flatMap((st, si) =>
    [0, 1].map((v) => {
      const t = facadeTextures(st, seed * 7 + si * 13 + v * 101);
      return { style: st, tileW: t.tileW, tileH: t.tileH, mat: new THREE.MeshLambertMaterial({ map: t.map, emissive: 0xffffff, emissiveMap: t.emissive, emissiveIntensity: 0.85 }) };
    }),
  );
  const shopTex = facadeTextures('glass', seed + 999);
  const shopMat = new THREE.MeshLambertMaterial({ map: shopTex.map, emissive: 0xffe0b0, emissiveMap: shopTex.emissive, emissiveIntensity: 1.4 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x24242c });
  const roofDetailMat = new THREE.MeshLambertMaterial({ color: 0x3a3a44 });
  const walkTex = pavingTexture();
  const walkMat = new THREE.MeshLambertMaterial({ map: walkTex, color: 0x9a9aa8 });
  const asphalt = asphaltTexture();
  asphalt.repeat.set(1, 1);
  const roadMat = new THREE.MeshLambertMaterial({ map: asphalt, color: 0x8a8a96 });
  const grassMat = new THREE.MeshLambertMaterial({ map: grassTexture() });
  const lotMat = new THREE.MeshLambertMaterial({ map: asphalt, color: 0x6a6a74 });
  const markMat = new THREE.MeshBasicMaterial({ color: 0xd8d8d0 });
  const yellowMat = new THREE.MeshBasicMaterial({ color: 0xe8b830 });
  const treeMat = new THREE.MeshLambertMaterial({ color: 0x1e4a2a });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3a2a20 });
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2a2a30 });

  // ---- ground ----
  const ground = new THREE.Mesh(worldUV(new THREE.PlaneGeometry(n * CELL + 400, n * CELL + 400).rotateX(-Math.PI / 2), 8), roadMat);
  group.add(ground);

  // ---- road markings (merged) ----
  const marks: THREE.BufferGeometry[] = [];
  const yellow: THREE.BufferGeometry[] = [];
  const iw = ROAD_W / 2 + WALK; // half width of the intersection box
  for (const a of lines)
    for (let k = 0; k < n; k++) {
      const s0 = lines[k] + iw + 1.5, s1 = lines[k + 1] - iw - 1.5;
      // dashed centre line along both orientations
      for (let s = s0; s < s1 - 2; s += 6) {
        yellow.push(new THREE.PlaneGeometry(0.18, 3).rotateX(-Math.PI / 2).translate(a, 0.02, s + 1.5));
        yellow.push(new THREE.PlaneGeometry(3, 0.18).rotateX(-Math.PI / 2).translate(s + 1.5, 0.02, a));
      }
      // edge lines
      for (const off of [-ROAD_W / 2 + 0.3, ROAD_W / 2 - 0.3]) {
        marks.push(new THREE.PlaneGeometry(0.14, s1 - s0).rotateX(-Math.PI / 2).translate(a + off, 0.02, (s0 + s1) / 2));
        marks.push(new THREE.PlaneGeometry(s1 - s0, 0.14).rotateX(-Math.PI / 2).translate((s0 + s1) / 2, 0.02, a + off));
      }
    }
  // crosswalks
  for (const a of lines)
    for (const b of lines)
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const cx = a + dx * (iw - 0.2), cz = b + dz * (iw - 0.2);
        for (let k = -4; k <= 4; k++) {
          if (dx) marks.push(new THREE.PlaneGeometry(2.2, 0.5).rotateX(-Math.PI / 2).translate(cx, 0.021, cz + k * 1.0));
          else marks.push(new THREE.PlaneGeometry(0.5, 2.2).rotateX(-Math.PI / 2).translate(cx + k * 1.0, 0.021, cz));
        }
      }
  group.add(new THREE.Mesh(mergeGeometries(marks)!, markMat), new THREE.Mesh(mergeGeometries(yellow)!, yellowMat));

  // ---- blocks ----
  const colliders: Collider[] = [];
  const lots: Lot[] = [];
  const lampSpots: THREE.Vector3[] = [];
  const signs: { tex: THREE.Texture; aspect: number; pos: THREE.Vector3; rotY: number; h: number; color: string }[] = [];
  const parked: { x: number; z: number; rot: number }[] = [];
  const blockSize = CELL - ROAD_W; // includes sidewalks
  const inner = blockSize - 2 * WALK;
  const center = (n - 1) / 2;
  let pizzeria: Lot | null = null;

  for (let bi = 0; bi < n; bi++)
    for (let bj = 0; bj < n; bj++) {
      const bx = lines[bi] + CELL / 2, bz = lines[bj] + CELL / 2;
      const geo = new Map<THREE.Material, THREE.BufferGeometry[]>();
      const add = (m: THREE.Material, g: THREE.BufferGeometry) => {
        if (!geo.has(m)) geo.set(m, []);
        geo.get(m)!.push(g);
      };
      // sidewalk slab (raised)
      add(walkMat, worldUV(boxAt(blockSize, 0.15, blockSize, bx, 0.075, bz), 2));
      // lamps along the curb
      for (let s = -blockSize / 2 + 4; s <= blockSize / 2 - 4; s += 13) {
        lampSpots.push(new THREE.Vector3(bx + s, 0, bz - blockSize / 2 + 0.6), new THREE.Vector3(bx + s, 0, bz + blockSize / 2 - 0.6));
        lampSpots.push(new THREE.Vector3(bx - blockSize / 2 + 0.6, 0, bz + s), new THREE.Vector3(bx + blockSize / 2 - 0.6, 0, bz + s));
      }
      const dist = Math.hypot(bi - center, bj - center) / (center * 1.42);
      const maxFloors = Math.max(3, Math.round(34 * Math.pow(1 - dist, 1.6) + 3));
      // lot pattern
      const pat = r();
      const sub: [number, number, number, number][] = []; // cx, cz, w, d (relative to block centre)
      const q = inner / 2;
      if (pat < 0.18 && dist < 0.55) sub.push([0, 0, inner, inner]);
      else if (pat < 0.45) {
        sub.push([0, -q / 2 - 0.5, inner, q - 1], [-q / 2 - 0.5, q / 2 + 0.5, q - 1, q - 1], [q / 2 + 0.5, q / 2 + 0.5, q - 1, q - 1]);
      } else if (pat < 0.65) sub.push([-q / 2 - 0.5, 0, q - 1, inner], [q / 2 + 0.5, 0, q - 1, inner]);
      else sub.push([-q / 2 - 0.5, -q / 2 - 0.5, q - 1, q - 1], [q / 2 + 0.5, -q / 2 - 0.5, q - 1, q - 1], [-q / 2 - 0.5, q / 2 + 0.5, q - 1, q - 1], [q / 2 + 0.5, q / 2 + 0.5, q - 1, q - 1]);

      for (const [ox, oz, w, d] of sub) {
        const cx = bx + ox, cz = bz + oz;
        // which street does the lot face? the nearest block edge
        const ex = ox / (inner / 2), ez = oz / (inner / 2);
        let door: THREE.Vector3;
        let street: string;
        let num: number;
        if (Math.abs(ez) >= Math.abs(ex)) {
          const sideZ = ez >= 0 ? 1 : -1;
          const lineIdx = bj + (sideZ > 0 ? 1 : 0);
          door = new THREE.Vector3(cx, 0, bz + sideZ * (blockSize / 2 - 1.2));
          street = STREETS_Z[lineIdx % STREETS_Z.length];
          num = 1 + bi * 4 + Math.floor((ox + inner / 2) / 10) * 2 + (sideZ > 0 ? 0 : 1);
        } else {
          const sideX = ex >= 0 ? 1 : -1;
          const lineIdx = bi + (sideX > 0 ? 1 : 0);
          door = new THREE.Vector3(bx + sideX * (blockSize / 2 - 1.2), 0, cz);
          street = STREETS_X[lineIdx % STREETS_X.length];
          num = 1 + bj * 4 + Math.floor((oz + inner / 2) / 10) * 2 + (sideX > 0 ? 0 : 1);
        }
        const lotR = r();
        const isPizzeria = !pizzeria && bi === Math.floor(center) && bj === Math.floor(center) + 1;
        let kind: Lot['kind'] = isPizzeria ? 'pizzeria' : lotR < 0.07 ? 'park' : lotR < 0.12 && dist > 0.3 ? 'parking' : 'building';
        if (kind === 'park') {
          add(grassMat, worldUV(boxAt(w, 0.2, d, cx, 0.1, cz), 3));
          for (let k = 0; k < Math.floor((w * d) / 60); k++) {
            const tx = cx + (r() - 0.5) * (w - 3), tz = cz + (r() - 0.5) * (d - 3);
            const th = 3 + r() * 3;
            add(trunkMat, new THREE.CylinderGeometry(0.15, 0.2, th * 0.4, 6).translate(tx, th * 0.2, tz));
            add(treeMat, new THREE.ConeGeometry(1.4 + r(), th, 7).translate(tx, th * 0.4 + th / 2, tz));
            colliders.push({ minX: tx - 0.4, maxX: tx + 0.4, minZ: tz - 0.4, maxZ: tz + 0.4 });
          }
        } else if (kind === 'parking') {
          add(lotMat, worldUV(boxAt(w, 0.16, d, cx, 0.08, cz), 8));
          for (let k = 0; k < 6; k++) if (r() < 0.6) parked.push({ x: cx + (k % 3 - 1) * 3.2, z: cz + (k < 3 ? -3 : 3), rot: k < 3 ? 0 : Math.PI });
        } else {
          // building
          const floors = kind === 'pizzeria' ? 2 : Math.max(2, Math.round(maxFloors * (0.35 + r() * 0.65)));
          const h = floors * 3.2 + 1;
          const style: FacadeStyle = kind === 'pizzeria' ? 'brick' : floors > 16 ? (r() < 0.75 ? 'glass' : 'dark') : floors > 7 ? (r() < 0.5 ? 'concrete' : r() < 0.5 ? 'dark' : 'glass') : r() < 0.65 ? 'brick' : 'concrete';
          const fv = facades.filter((f) => f.style === style)[Math.floor(r() * 2)];
          const inset = 0.6;
          const x0 = cx - w / 2 + inset, x1 = cx + w / 2 - inset, z0 = cz - d / 2 + inset, z1 = cz + d / 2 - inset;
          const shopFloor = floors <= 8 || r() < 0.4;
          const uo = Math.floor(r() * 4), vo = Math.floor(r() * 4) / 4;
          if (shopFloor) add(shopMat, shell(x0, x1, z0, z1, 0, 4, 9, 4.2, uo * 0.33, 0));
          if (floors > 16 && r() < 0.7) {
            // podium + tower with setback
            const pf = 4 + Math.floor(r() * 4);
            const ph = pf * 3.2 + 1;
            add(fv.mat, shell(x0, x1, z0, z1, shopFloor ? 4 : 0, ph, fv.tileW, fv.tileH, uo, vo));
            add(roofMat, boxAt(x1 - x0, 0.3, z1 - z0, cx, ph + 0.15, cz));
            const s = Math.min(w, d) * (0.15 + r() * 0.12);
            add(fv.mat, shell(x0 + s, x1 - s, z0 + s, z1 - s, ph, h, fv.tileW, fv.tileH, uo, vo));
            add(roofMat, boxAt(x1 - x0 - 2 * s, 0.4, z1 - z0 - 2 * s, cx, h + 0.2, cz));
            // crown + antenna
            add(roofDetailMat, boxAt((x1 - x0 - 2 * s) * 0.6, 3, (z1 - z0 - 2 * s) * 0.6, cx, h + 1.9, cz));
            add(poleMat, new THREE.CylinderGeometry(0.15, 0.25, 12, 6).translate(cx, h + 9, cz));
          } else {
            add(fv.mat, shell(x0, x1, z0, z1, shopFloor ? 4 : 0, h, fv.tileW, fv.tileH, uo, vo));
            add(roofMat, boxAt(x1 - x0, 0.4, z1 - z0, cx, h + 0.2, cz));
            // parapet + rooftop units
            add(roofDetailMat, boxAt(x1 - x0, 0.8, 0.3, cx, h + 0.4, z0 + 0.15));
            add(roofDetailMat, boxAt(x1 - x0, 0.8, 0.3, cx, h + 0.4, z1 - 0.15));
            for (let k = 0; k < 3; k++) if (r() < 0.7) add(roofDetailMat, boxAt(1.6 + r() * 2, 1.2, 1.6 + r() * 2, cx + (r() - 0.5) * (w - 6), h + 0.8, cz + (r() - 0.5) * (d - 6)));
            if (r() < 0.3) add(roofDetailMat, new THREE.CylinderGeometry(1.4, 1.4, 2.8, 10).translate(cx + (r() - 0.5) * (w - 6), h + 2.8, cz + (r() - 0.5) * (d - 6)));
          }
          colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });
          // neon sign on the street side
          const facingZ = Math.abs(door.z - cz) > Math.abs(door.x - cx);
          const text = kind === 'pizzeria' ? 'PIZZA' : NEON_TEXTS[Math.floor(r() * NEON_TEXTS.length)];
          if (kind === 'pizzeria' || r() < 0.55) {
            const color = kind === 'pizzeria' ? '#ff5a2a' : NEON_COLORS[Math.floor(r() * NEON_COLORS.length)];
            const nt = neonTexture(text, color);
            const sh = kind === 'pizzeria' ? 1.8 : 1.1 + r() * 0.8;
            const y = 5 + r() * Math.min(10, h - 7);
            const pos = facingZ ? new THREE.Vector3(cx, kind === 'pizzeria' ? 5.5 : y, door.z > cz ? z1 + 0.08 : z0 - 0.08) : new THREE.Vector3(door.x > cx ? x1 + 0.08 : x0 - 0.08, kind === 'pizzeria' ? 5.5 : y, cz);
            const rotY = facingZ ? (door.z > cz ? 0 : Math.PI) : door.x > cx ? Math.PI / 2 : -Math.PI / 2;
            signs.push({ tex: nt.tex, aspect: nt.aspect, pos, rotY, h: sh, color });
          }
        }
        const lot: Lot = { cx, cz, w, d, door, street, number: num, kind, name: kind === 'pizzeria' ? 'Pizzeria' : undefined };
        lots.push(lot);
        if (kind === 'pizzeria') pizzeria = lot;
      }
      // merge this block per material
      const blockGroup = new THREE.Group();
      for (const [m, list] of geo) {
        const merged = mergeGeometries(list);
        for (const g of list) g.dispose();
        if (merged) blockGroup.add(new THREE.Mesh(merged, m));
      }
      group.add(blockGroup);
    }

  // ---- neon signs ----
  for (const s of signs) {
    const m = new THREE.MeshBasicMaterial({ map: s.tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(2.2, 2.2, 2.2), toneMapped: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.h * s.aspect, s.h), m);
    mesh.position.copy(s.pos);
    mesh.rotation.y = s.rotY;
    group.add(mesh);
    // soft coloured light spilling onto the street
    const spill = new THREE.Mesh(
      new THREE.PlaneGeometry(s.h * s.aspect * 1.6, 6).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: radialTexture(), color: new THREE.Color(s.color).multiplyScalar(0.35), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    const out = new THREE.Vector3(Math.sin(s.rotY), 0, Math.cos(s.rotY));
    spill.position.set(s.pos.x + out.x * 3, 0.17, s.pos.z + out.z * 3);
    spill.rotation.y = s.rotY;
    group.add(spill);
  }

  // ---- street lamps (instanced) ----
  const poleGeo = mergeGeometries([new THREE.CylinderGeometry(0.08, 0.12, 6, 6).translate(0, 3, 0), new THREE.BoxGeometry(0.1, 0.1, 1.4).translate(0, 5.95, 0.6)])!;
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampSpots.length);
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.12, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 1.4, 1.0), toneMapped: false }), lampSpots.length);
  const pools = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,190,110,0.55)', 'rgba(255,190,110,0)'), color: 0x9a8a80, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    lampSpots.length,
  );
  const tmpM = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  lampSpots.forEach((p, i) => {
    // arm points towards the road
    const toRoad = new THREE.Vector3();
    const gx = ((p.x + half) % CELL + CELL) % CELL, gz = ((p.z + half) % CELL + CELL) % CELL;
    if (Math.min(gx, CELL - gx) < Math.min(gz, CELL - gz)) toRoad.set(gx < CELL / 2 ? -1 : 1, 0, 0);
    else toRoad.set(0, 0, gz < CELL / 2 ? -1 : 1);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(toRoad.x, toRoad.z));
    tmpM.compose(new THREE.Vector3(p.x, 0.15, p.z), q, new THREE.Vector3(1, 1, 1));
    poles.setMatrixAt(i, tmpM);
    tmpM.compose(new THREE.Vector3(p.x + toRoad.x * 1.2, 5.9, p.z + toRoad.z * 1.2), q, new THREE.Vector3(1, 1, 1));
    heads.setMatrixAt(i, tmpM);
    tmpM.compose(new THREE.Vector3(p.x + toRoad.x * 1.8, 0.03, p.z + toRoad.z * 1.8), q, new THREE.Vector3(1, 1, 1));
    pools.setMatrixAt(i, tmpM);
  });
  pools.renderOrder = 1;
  group.add(poles, heads, pools);

  // ---- traffic lights at every intersection (instanced heads, colour updated each frame) ----
  const sigSpots: { x: number; z: number; i: number; j: number; axisX: boolean }[] = [];
  lines.forEach((a, i) =>
    lines.forEach((b, j) => {
      const o = ROAD_W / 2 + 0.8;
      sigSpots.push({ x: a + o, z: b + o, i, j, axisX: false }, { x: a - o, z: b - o, i, j, axisX: false }, { x: a - o, z: b + o, i, j, axisX: true }, { x: a + o, z: b - o, i, j, axisX: true });
    }),
  );
  const sigPoles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.08, 3.6, 6).translate(0, 1.8, 0), poleMat, sigSpots.length);
  const signals = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), new THREE.MeshBasicMaterial({ toneMapped: false }), sigSpots.length);
  sigSpots.forEach((s, k) => {
    tmpM.makeTranslation(s.x, 0.15, s.z);
    sigPoles.setMatrixAt(k, tmpM);
    tmpM.makeTranslation(s.x, 3.6, s.z);
    signals.setMatrixAt(k, tmpM);
    signals.setColorAt(k, new THREE.Color(0, 3, 1));
  });
  group.add(sigPoles, signals);

  // ---- parked cars ----
  const parkedColors = [0x8a1a1a, 0x1a3a8a, 0xb0b0b8, 0x1a1a1e, 0x2a6a3a, 0xc8c0b0];
  for (const p of parked) {
    const car = buildCar(r() < 0.2 ? 'van' : 'sedan', parkedColors[Math.floor(r() * parkedColors.length)]);
    car.group.position.set(p.x, 0.16, p.z);
    car.group.rotation.y = p.rot + Math.PI / 2;
    car.brake.emissiveIntensity = 0.1;
    group.add(car.group);
    colliders.push({ minX: p.x - 1.2, maxX: p.x + 1.2, minZ: p.z - 2.4, maxZ: p.z + 2.4 });
  }

  // ---- distant skyline ring so the world doesn't end ----
  const ring: THREE.BufferGeometry[] = [];
  const darkF = facades.find((f) => f.style === 'dark')!;
  for (let k = 0; k < 70; k++) {
    const a = (k / 70) * Math.PI * 2;
    const R = half + 70 + r() * 60;
    const w = 20 + r() * 30, h = 30 + r() * 120;
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    ring.push(shell(x - w / 2, x + w / 2, z - w / 2, z + w / 2, 0, h, darkF.tileW, darkF.tileH, r() * 4, 0));
  }
  group.add(new THREE.Mesh(mergeGeometries(ring)!, darkF.mat));
  // city boundary walls (invisible colliders)
  colliders.push({ minX: -half - 50, maxX: -half - 5, minZ: -half - 50, maxZ: half + 50 }, { minX: half + 5, maxX: half + 50, minZ: -half - 50, maxZ: half + 50 }, { minX: -half - 50, maxX: half + 50, minZ: -half - 50, maxZ: -half - 5 }, { minX: -half - 50, maxX: half + 50, minZ: half + 5, maxZ: half + 50 });

  const PHASE = 9; // seconds per green phase
  const greenX = (i: number, j: number, time: number) => Math.floor((time + (i * 3 + j * 5) % PHASE) / PHASE) % 2 === 0;
  const RED = new THREE.Color(3, 0.2, 0.15), GREEN = new THREE.Color(0.2, 3, 0.8);

  return {
    group,
    n,
    half,
    colliders,
    lots,
    pizzeria: pizzeria!,
    lines,
    streetNamesX: lines.map((_, i) => STREETS_X[i % STREETS_X.length]),
    streetNamesZ: lines.map((_, j) => STREETS_Z[j % STREETS_Z.length]),
    lampPools: pools,
    signals,
    greenX,
    update(_dt: number, time: number) {
      sigSpots.forEach((s, k) => {
        const g = greenX(s.i, s.j, time);
        signals.setColorAt(k, (s.axisX ? g : !g) ? GREEN : RED);
      });
      if (signals.instanceColor) signals.instanceColor.needsUpdate = true;
    },
  };
}

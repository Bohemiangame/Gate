import * as THREE from 'three';
import type { View } from '../engine/view';
import { CharacterBatcher } from '../gfx/batcher';
import { Flashes, Particles, Tracers } from '../gfx/effects';
import { buildBackdrop } from '../gfx/town';
import type { WeaponKind } from '../gfx/characterModels';
import { audio, vibrate } from '../audio';
import { raycast, Hittable, HitPart } from '../game/hit';
import { CoverObj, CoverSlot, generateMap, MapData, MapKind, MAP_GOALS } from './map';
import { TB } from './tbalance';
import { GroupId, Unit } from './units';
import { TacticsHud } from './thud';

export interface SquadMember {
  memberId: number;
  group: 'A' | 'B';
  name: string;
  weapon: WeaponKind;
  variant: number;
  reserve: number;
}

export interface MissionResult {
  won: boolean;
  kills: number;
  time: number;
  fallen: number[];
  wounded: number[];
  /** Rounds left (magazine + reserve) per member id; -1 = sheriff. */
  ammoLeft: Map<number, number>;
  killsBy: Map<number, number>;
}

export interface MissionDef {
  name: string;
  seed: number;
  mapKind?: MapKind;
  squads: SquadMember[];
  sheriff: { weapon: WeaponKind; hp: number; reserve: number; acc: number; reload: number };
  waves: { at: number; n: number; weapons?: WeaponKind[] }[];
  enemyHp: number;
  onEnd?: (r: MissionResult) => void;
}

/** Mission N of the campaign (difficulty grows with N). */
export function missionWaves(n: number): { waves: MissionDef['waves']; enemyHp: number } {
  const waves: MissionDef['waves'] = [];
  const count = 3 + Math.floor(n / 2);
  for (let i = 0; i < count; i++) {
    const size = 3 + Math.floor((n + i) / 3);
    const weapons: WeaponKind[] = [];
    for (let k = 0; k < size; k++) weapons.push(Math.random() < 0.15 + n * 0.06 ? 'rifle' : Math.random() < n * 0.04 ? 'shotgun' : 'revolver');
    waves.push({ at: i * 22, n: size, weapons });
  }
  return { waves, enemyHp: 3 + Math.floor(n / 3) };
}

export const DEFAULT_MISSION: MissionDef = {
  name: 'Námestie',
  seed: 7,
  squads: [
    { memberId: 1, group: 'A', name: 'Jake', weapon: 'rifle', variant: 0, reserve: 20 },
    { memberId: 2, group: 'A', name: 'Billy', weapon: 'revolver', variant: 1, reserve: 24 },
    { memberId: 3, group: 'A', name: 'Hank', weapon: 'revolver', variant: 2, reserve: 24 },
    { memberId: 4, group: 'B', name: 'Wyatt', weapon: 'shotgun', variant: 0, reserve: 12 },
    { memberId: 5, group: 'B', name: 'Cole', weapon: 'revolver', variant: 1, reserve: 24 },
    { memberId: 6, group: 'B', name: 'Eli', weapon: 'revolver', variant: 2, reserve: 24 },
  ],
  sheriff: { weapon: 'revolver', hp: 5, reserve: 36, acc: 0, reload: 0 },
  ...missionWaves(1),
};

const NAMES = ['Jake', 'Billy', 'Hank', 'Wyatt', 'Cole', 'Eli', 'Jesse', 'Luke', 'Sam', 'Tom', 'Walt', 'Ned', 'Abe', 'Gus', 'Roy', 'Clay'];

type Box = { min: THREE.Vector3; max: THREE.Vector3; part: HitPart };
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const GROUP_COLOR: Record<GroupId, number> = { S: 0xffd040, A: 0x4a8aff, B: 0x3ad88a, E: 0xff4a3a };

export class Mission {
  readonly scene: THREE.Scene;
  readonly root = new THREE.Group();
  readonly map: MapData;
  readonly hud: TacticsHud;
  readonly particles = new Particles(1400);
  readonly tracers = new Tracers(60);
  readonly flashes = new Flashes(40);
  private batcher: CharacterBatcher;
  units: Unit[] = [];
  sheriff: Unit;
  names = new Map<Unit, string>();
  private memberOf = new Map<Unit, number>();
  private killsBy = new Map<number, number>();
  private backdrop: THREE.Group;
  private disposed = false;

  phase: 'play' | 'won' | 'lost' = 'play';
  time = 0;
  private waveIdx = 0;
  kills = 0;
  fallen: string[] = [];
  wounded: string[] = [];
  fallenIds: number[] = [];
  woundedIds: number[] = [];
  /** Doctor upgrades raise the chance that a fallen man is only wounded. */
  woundedBonus = 0;

  // squads follow the sheriff
  private squadT = 0;
  private lastSheriffSlot: CoverSlot | null = null;
  private rushT = 10;
  private rings = new Map<Unit, THREE.Mesh>();
  private marker: THREE.Mesh;
  private markerT = 0;

  // sheriff aim: screen-space cursor moved by the left pad, FIRE = one shot per tap
  private aimId: number | null = null;
  private aimLast = new THREE.Vector2();
  private padCenter = new THREE.Vector2();
  /** Cursor in CSS pixels. */
  readonly cursor = new THREE.Vector2(window.innerWidth / 2, window.innerHeight * 0.4);
  private crossMesh: THREE.Mesh;
  private aimLine: THREE.Mesh;
  private lock: Unit | null = null;
  private lockHead = false;
  private readonly aimPoint = new THREE.Vector3();
  private fireQueued = false;
  /** Seconds the sheriff stays leaned out after a shot. */
  private exposedT = 0;
  private sheriffReloadT = 0;

  // camera
  private camTarget = new THREE.Vector3(0, 0, 6);
  private pan = new THREE.Vector3();
  private mapId: number | null = null;
  private mapStart = new THREE.Vector2();
  private mapLast = new THREE.Vector2();
  private mapMoved = false;

  constructor(
    readonly view: View,
    ui: HTMLElement,
    readonly def: MissionDef = DEFAULT_MISSION,
  ) {
    this.scene = view.scene;
    view.vfov = TB.camFov;
    view.setPixelSize(TB.pixelSize);
    view.outline = true;
    view.camera.far = 200;
    view.camera.updateProjectionMatrix();
    this.scene.fog = new THREE.Fog(0xf0c890, 60, 150);
    this.batcher = new CharacterBatcher(this.scene);
    const backdrop = buildBackdrop();
    backdrop.scale.setScalar(0.9);
    backdrop.position.set(0, 0, 10);
    this.backdrop = backdrop;
    this.scene.add(backdrop, this.root, this.particles.mesh, this.tracers.group, this.flashes.group);
    this.map = generateMap(def.mapKind ?? 'plaza', def.seed, this.root);
    this.hud = new TacticsHud(ui);

    // markers
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    this.marker.position.y = 0.04;
    this.crossMesh = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }));
    this.crossMesh.renderOrder = 30;
    this.crossMesh.visible = false;
    this.aimLine = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5), new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.5, depthTest: false }));
    this.aimLine.renderOrder = 29;
    this.aimLine.visible = false;
    this.root.add(this.marker, this.crossMesh, this.aimLine);

    // our side
    const sp = this.map.playerSpawns;
    this.sheriff = this.addUnit('player', 'S', def.sheriff.weapon, 0, sp[0], def.sheriff.hp, def.sheriff.reserve);
    this.names.set(this.sheriff, 'Šerif');
    this.memberOf.set(this.sheriff, -1);
    let ia = 0, ib = 0;
    for (const m of def.squads) {
      const i = m.group === 'A' ? ia++ : ib++;
      const base = m.group === 'A' ? sp[1] : sp[2];
      const u = this.addUnit('player', m.group, m.weapon, m.variant, base.clone().add(new THREE.Vector3((m.group === 'A' ? -1 : 1) * i * 0.8, 0, i * 0.5)), TB.posseHp, m.reserve);
      this.names.set(u, m.name);
      this.memberOf.set(u, m.memberId);
    }
    void NAMES;
    const Z = this.map.bounds.maxZ;
    this.moveSheriffTo(new THREE.Vector3(0, 0, Z - 5));
    this.squadT = 0.2;
    this.bindInput(view.renderer.domElement);
    this.hud.showBanner(`${def.name.toUpperCase()}<br><small>${MAP_GOALS[def.mapKind ?? 'plaza']}</small>`, '', 2.4);
  }

  private addUnit(side: 'player' | 'enemy', g: GroupId, w: WeaponKind, variant: number, pos: THREE.Vector3, hp: number, reserve: number): Unit {
    const u = new Unit(side, g, w, variant, hp, reserve);
    u.c.root.position.copy(pos);
    u.c.root.rotation.y = side === 'player' ? Math.PI : 0;
    this.root.add(u.c.root);
    if (u.warn) this.root.add(u.warn.sprite);
    if (side === 'player') {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.46, 18).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: GROUP_COLOR[g], transparent: true, opacity: 0.6, depthWrite: false }));
      ring.position.y = 0.03;
      this.root.add(ring);
      this.rings.set(u, ring);
    }
    this.units.push(u);
    return u;
  }

  // =====================================================================
  // Orders
  // =====================================================================
  private enemyCentroid(): THREE.Vector3 {
    const c = new THREE.Vector3();
    let n = 0;
    for (const u of this.units) if (u.alive && u.side === 'enemy') {
      c.add(u.pos);
      n++;
    }
    return n ? c.divideScalar(n) : new THREE.Vector3(0, 0, this.map.bounds.minZ);
  }

  orderMove(g: GroupId, point: THREE.Vector3): void {
    const squad = this.units.filter((u) => u.alive && u.group === g);
    if (!squad.length) return;
    const threat = this.enemyCentroid();
    for (const u of squad) u.leaveSlot();
    const cand = this.map.slots
      .filter((s) => s.free && s.pos.distanceTo(point) < 5.5)
      .map((s) => ({ s, score: s.pos.distanceTo(point) - (s.protects(threat) ? 3 : 0) }))
      .sort((a, b) => a.score - b.score);
    squad.forEach((u, i) => {
      const s = cand[i]?.s ?? null;
      const dest = s ? s.pos.clone() : point.clone().add(new THREE.Vector3(Math.cos(i * 2.1) * 1.2 * i, 0, Math.sin(i * 2.1) * 1.2 * i));
      this.clampToMap(dest);
      if (s) cand.splice(cand.findIndex((c) => c.s === s), 1);
      u.goTo(this.map.nav.path(u.pos, dest), s);
    });
  }

  /** Sheriff runs to the free cover slot nearest to `p` (or to `p` itself). */
  private moveSheriffTo(p: THREE.Vector3, slot?: CoverSlot | null): void {
    const s = this.sheriff;
    const threat = this.enemyCentroid();
    let best = slot ?? null;
    if (!best) {
      let bd = 3.2;
      for (const sl of this.map.slots) {
        if (!(sl.free || sl.occupant === s || sl.reserved === s)) continue;
        const d = sl.pos.distanceTo(p) - (sl.protects(threat) ? 0.6 : 0);
        if (d < bd) {
          bd = d;
          best = sl;
        }
      }
    }
    const dest = best ? best.pos.clone() : p.clone();
    this.clampToMap(dest);
    s.goTo(this.map.nav.path(s.pos, dest), best);
    this.exposedT = 0;
    this.marker.position.set(dest.x, 0.04, dest.z);
    (this.marker.material as THREE.MeshBasicMaterial).color.setHex(GROUP_COLOR.S);
    this.markerT = 1;
    this.squadT = 0.15; // squads react right away
  }

  /** Slide along the current cover: next slot on the same side, left (-1) or right (+1) on screen. */
  private slideNeighbour(dir: -1 | 1): CoverSlot | null {
    const s = this.sheriff;
    const cur = s.slot;
    if (!cur || s.moving) return null;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.view.camera.quaternion).setY(0).normalize();
    let best: CoverSlot | null = null;
    let bd = Infinity;
    for (const sl of cur.cover.slots) {
      if (sl === cur || !(sl.free || sl.reserved === s)) continue;
      const off = sl.pos.clone().sub(cur.pos);
      const side = off.dot(right);
      if (side * dir <= 0.2) continue;
      const d = off.length();
      if (d < bd) {
        bd = d;
        best = sl;
      }
    }
    return best;
  }

  /** Squads A (left) and B (right) take covers around the sheriff, facing the bandits. */
  private squadFollow(): void {
    const s = this.sheriff;
    if (!s.alive) return;
    const anchor = s.slot ? s.slot.pos : s.path.length ? s.path[s.path.length - 1] : s.pos;
    const threat = this.enemyCentroid();
    const fwd = threat.clone().sub(anchor).setY(0);
    if (fwd.lengthSq() < 0.01) fwd.set(0, 0, -1);
    fwd.normalize();
    const left = new THREE.Vector3(fwd.z, 0, -fwd.x); // 90° to the left of "forward"
    for (const g of ['A', 'B'] as const) {
      const squad = this.units.filter((u) => u.alive && u.group === g);
      if (!squad.length) continue;
      const side = g === 'A' ? 1 : -1;
      const ok = squad.every((u) => {
        const dest = u.slot ? u.slot.pos : u.pos;
        const d = dest.distanceTo(anchor);
        return d > 1.5 && d < 8 && (!u.slot || u.slot.protects(threat)) && (u.slot || u.moving);
      });
      if (ok && this.lastSheriffSlot === s.slot) continue;
      const centre = anchor.clone().addScaledVector(left, side * 3.6).addScaledVector(fwd, -0.5);
      for (const u of squad) u.leaveSlot();
      const cand = this.map.slots
        .filter((sl) => sl.free && sl.pos.distanceTo(anchor) > 1.4 && sl.pos.distanceTo(centre) < 5)
        .map((sl) => ({ sl, score: sl.pos.distanceTo(centre) - (sl.protects(threat) ? 3 : 0) }))
        .sort((a, b) => a.score - b.score);
      squad.forEach((u, i) => {
        const pick = cand[i]?.sl ?? null;
        const dest = pick ? pick.pos.clone() : centre.clone().addScaledVector(left, side * i * 0.9);
        this.clampToMap(dest);
        if (u.pos.distanceTo(dest) < 0.3 && u.slot === pick) return;
        u.goTo(this.map.nav.path(u.pos, dest), pick);
      });
    }
    this.lastSheriffSlot = s.slot;
  }

  private clampToMap(p: THREE.Vector3): void {
    const b = this.map.bounds;
    p.x = THREE.MathUtils.clamp(p.x, b.minX + 0.5, b.maxX - 0.5);
    p.z = THREE.MathUtils.clamp(p.z, b.minZ + 0.5, b.maxZ - 0.5);
  }

  // =====================================================================
  // Input
  // =====================================================================
  private bindInput(canvas: HTMLElement): void {
    const pad = this.hud.aimPad;
    pad.addEventListener('pointerdown', (e) => {
      if (this.disposed) return;
      e.stopPropagation();
      e.preventDefault();
      audio.unlock();
      if (this.aimId !== null) return;
      this.aimId = e.pointerId;
      try {
        pad.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const r = pad.getBoundingClientRect();
      this.padCenter.set(r.left + r.width / 2, r.top + r.height / 2);
      this.aimLast.set(e.clientX, e.clientY);
    });
    pad.addEventListener('pointermove', (e) => {
      if (this.disposed || e.pointerId !== this.aimId) return;
      const dx = e.clientX - this.aimLast.x;
      const dy = e.clientY - this.aimLast.y;
      this.aimLast.set(e.clientX, e.clientY);
      this.cursor.x = THREE.MathUtils.clamp(this.cursor.x + dx * TB.aimPadGain, 0, window.innerWidth);
      this.cursor.y = THREE.MathUtils.clamp(this.cursor.y + dy * TB.aimPadGain, 0, window.innerHeight);
      const kx = THREE.MathUtils.clamp(e.clientX - this.padCenter.x, -40, 40);
      const ky = THREE.MathUtils.clamp(e.clientY - this.padCenter.y, -40, 40);
      this.hud.setPad(true, kx, ky);
    });
    const padUp = (e: PointerEvent) => {
      if (e.pointerId !== this.aimId) return;
      this.aimId = null;
      this.hud.setPad(false, 0, 0);
    };
    pad.addEventListener('pointerup', padUp);
    pad.addEventListener('pointercancel', padUp);

    const fire = this.hud.fireBtn;
    fire.addEventListener('pointerdown', (e) => {
      if (this.disposed) return;
      e.stopPropagation();
      e.preventDefault();
      audio.unlock();
      this.fireQueued = true;
      this.hud.firePressed(true);
    });
    const fireUp = () => this.hud.firePressed(false);
    fire.addEventListener('pointerup', fireUp);
    fire.addEventListener('pointercancel', fireUp);
    fire.addEventListener('pointerleave', fireUp);

    for (const [btn, dir] of [
      [this.hud.slideL, -1],
      [this.hud.slideR, 1],
    ] as const)
      btn.addEventListener('pointerdown', (e) => {
        if (this.disposed) return;
        e.stopPropagation();
        e.preventDefault();
        const sl = this.slideNeighbour(dir);
        if (sl) this.moveSheriffTo(sl.pos, sl);
      });

    canvas.addEventListener('pointerdown', (e) => {
      if (this.disposed) return;
      audio.unlock();
      if (e.pointerType === 'mouse') {
        // PC: left click = shoot, right click = move
        if (e.button === 0) this.fireQueued = true;
        else if (e.button === 2) this.tap(e.clientX, e.clientY);
        return;
      }
      if (this.mapId !== null) return;
      this.mapId = e.pointerId;
      this.mapStart.set(e.clientX, e.clientY);
      this.mapLast.set(e.clientX, e.clientY);
      this.mapMoved = false;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.disposed) return;
      if (e.pointerType === 'mouse') {
        this.cursor.set(e.clientX, e.clientY);
        return;
      }
      if (e.pointerId !== this.mapId) return;
      if (Math.hypot(e.clientX - this.mapStart.x, e.clientY - this.mapStart.y) > 12) this.mapMoved = true;
      if (this.mapMoved) {
        const k = this.view.camera.position.distanceTo(this.camTarget) / window.innerHeight;
        this.pan.x -= (e.clientX - this.mapLast.x) * k * 1.1;
        this.pan.z -= (e.clientY - this.mapLast.y) * k * 1.5;
        this.pan.x = THREE.MathUtils.clamp(this.pan.x, -10, 10);
        this.pan.z = THREE.MathUtils.clamp(this.pan.z, -14, 8);
      }
      this.mapLast.set(e.clientX, e.clientY);
    });
    const mapUp = (e: PointerEvent) => {
      if (this.disposed || e.pointerId !== this.mapId) return;
      this.mapId = null;
      if (!this.mapMoved && this.phase === 'play') this.tap(e.clientX, e.clientY);
    };
    canvas.addEventListener('pointerup', mapUp);
    canvas.addEventListener('pointercancel', () => (this.mapId = null));
    window.addEventListener('keydown', (e) => {
      if (this.disposed) return;
      if (e.key === ' ') this.fireQueued = true;
      if (e.key === 'a' || e.key === 'ArrowLeft') {
        const sl = this.slideNeighbour(-1);
        if (sl) this.moveSheriffTo(sl.pos, sl);
      }
      if (e.key === 'd' || e.key === 'ArrowRight') {
        const sl = this.slideNeighbour(1);
        if (sl) this.moveSheriffTo(sl.pos, sl);
      }
    });
  }

  private screenToGround(x: number, y: number): THREE.Vector3 | null {
    ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, this.view.camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(ground, p) ? p : null;
  }

  /** Tap on the map = sheriff runs to the nearest cover there. */
  private tap(x: number, y: number): void {
    const p = this.screenToGround(x, y);
    if (!p || !this.sheriff.alive) return;
    this.clampToMap(p);
    this.moveSheriffTo(p);
    audio.play('click');
  }

  // =====================================================================
  // Combat
  // =====================================================================
  private nearestEnemy(from: THREE.Vector3): Unit | null {
    let best: Unit | null = null;
    let bd = Infinity;
    for (const u of this.units) {
      if (!u.alive || u.side !== 'enemy') continue;
      const d = u.pos.distanceTo(from);
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  }

  /** Full-height cover between a and b blocks the line of sight. */
  private losBlocked(a: THREE.Vector3, b: THREE.Vector3, ignore: (CoverObj | undefined)[]): boolean {
    for (const c of this.map.covers) {
      if (!c.alive || c.height < 1.6 || ignore.includes(c)) continue;
      if (segAabb2D(a, b, c)) return true;
    }
    return false;
  }

  private pickTarget(u: Unit): Unit | null {
    let best: Unit | null = null;
    let bs = Infinity;
    for (const t of this.units) {
      if (!t.alive || t.side === u.side) continue;
      const d = t.pos.distanceTo(u.pos);
      if (d > u.w.range) continue;
      if (this.losBlocked(u.pos, t.pos, [u.slot?.cover, t.slot?.cover])) continue;
      const s = d - (t.exposed ? 5 : 0) - (t === u.target ? 2 : 0) - (t.group === 'S' ? 1.5 : 0);
      if (s < bs) {
        bs = s;
        best = t;
      }
    }
    return best;
  }

  private hitChance(u: Unit, t: Unit): number {
    const d = u.pos.distanceTo(t.pos);
    const rangeK = 1 - (1 - TB.rangeFalloff) * Math.min(1, d / u.w.range);
    let mod = 1;
    if (t.moving) mod = TB.movingMul;
    else if (t.protectedFrom(u.pos)) mod = t.state === 'peek' || t.state === 'warn' ? TB.coverPeekMul : TB.coverHiddenMul;
    return u.w.acc * rangeK * mod;
  }

  private muzzle(u: Unit, out: THREE.Vector3): THREE.Vector3 {
    u.c.root.updateMatrixWorld(true);
    return u.c.getMuzzleWorld(out);
  }

  /** Auto-resolved shot (posse squads and bandits). */
  private shoot(u: Unit, t: Unit): void {
    u.c.fire();
    const m = this.muzzle(u, new THREE.Vector3());
    this.flashes.spawn(m, 0.4, 0.05);
    audio.play(u.side === 'enemy' ? 'enemyShot' : u.weapon === 'rifle' ? 'rifle' : u.weapon === 'shotgun' ? 'shotgun' : 'revolver', 0.05);
    const p = this.hitChance(u, t);
    let hits = 0;
    for (let k = 0; k < u.w.pellets; k++) if (Math.random() < p) hits++;
    const body = t.pos.clone().setY(t.exposed ? 1.1 : 0.7);
    if (hits) {
      this.tracers.fire(m, body, u.side === 'enemy' ? 0xffb060 : 0xfff0a0);
      this.damage(t, hits * u.w.dmg, u);
    } else if (t.protectedFrom(u.pos) && t.slot) {
      const cp = t.slot.cover.pos.clone().setY(Math.min(t.slot.cover.height, 0.8));
      cp.x += (Math.random() - 0.5) * 0.6;
      this.tracers.fire(m, cp, u.side === 'enemy' ? 0xffb060 : 0xfff0a0);
      this.coverDamage(t.slot.cover, 1, cp);
    } else {
      body.x += (Math.random() - 0.5) * 1.6;
      body.z += (Math.random() - 0.5) * 1.6;
      body.y = 0.05;
      this.tracers.fire(m, body, u.side === 'enemy' ? 0xffb060 : 0xfff0a0);
      this.particles.dust(body, 3);
    }
  }

  private damage(t: Unit, dmg: number, by: Unit | null, head = false): void {
    if (!t.alive) return;
    t.hp -= dmg;
    t.c.flash();
    this.floatAt(t.pos.clone().setY(2), head ? 'HEADSHOT!' : `-${dmg}`, head ? 'head' : t.side === 'player' ? 'bad' : 'dmg');
    if (t.side === 'player') {
      vibrate(t.group === 'S' ? 80 : 30);
      if (t.group === 'S') audio.play('hurt');
    } else audio.play(head ? 'headshot' : 'hit', 0.05);
    if (t.hp <= 0) {
      this.kill(t);
      const id = by ? this.memberOf.get(by) : undefined;
      if (id !== undefined && t.side === 'enemy') this.killsBy.set(id, (this.killsBy.get(id) ?? 0) + 1);
    }
  }

  private kill(t: Unit): void {
    t.alive = false;
    t.leaveSlot();
    t.path = [];
    t.c.root.updateMatrixWorld(true);
    this.particles.burst(t.c.model.debris, t.c.root.matrixWorld, t.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 3, 0.065, 180);
    this.root.remove(t.c.root);
    t.c.dispose();
    if (t.warn) t.warn.sprite.visible = false;
    const ring = this.rings.get(t);
    if (ring) this.root.remove(ring);
    audio.play('die', 0.02);
    if (t.side === 'enemy') {
      this.kills++;
      return;
    }
    const name = this.names.get(t) ?? '?';
    if (t.group === 'S') {
      this.lose();
      return;
    }
    const mid = this.memberOf.get(t) ?? 0;
    if (Math.random() < TB.woundedChance + this.woundedBonus) {
      this.wounded.push(name);
      this.woundedIds.push(mid);
      this.floatAt(t.pos.clone().setY(2.2), `${name}: ZRANENÝ`, 'bad');
    } else {
      this.fallen.push(name);
      this.fallenIds.push(mid);
      this.floatAt(t.pos.clone().setY(2.2), `${name} PADOL`, 'bad');
    }
  }

  private coverDamage(c: CoverObj, n: number, at: THREE.Vector3): void {
    if (!c.alive || c.hp > 900) return;
    c.hp -= n;
    if (Math.random() < 0.5) this.particles.dust(at, 2, 0xa87848, 0.15);
    if (c.hp > 0) return;
    c.alive = false;
    c.mesh.updateMatrixWorld(true);
    this.particles.burst(c.model.debris, c.mesh.matrixWorld, c.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), c.kind === 'tnt' ? 7 : 3, 0.08, 150);
    this.root.remove(c.mesh);
    audio.play('wood');
    this.map.nav.rebuild(this.map.covers);
    if (c.kind === 'tnt') this.explode(c.pos.clone().setY(0.5), 3.6, 6);
  }

  private explode(p: THREE.Vector3, r: number, dmg: number): void {
    this.flashes.spawn(p, r * 1.4, 0.35, r * 2);
    for (let k = 0; k < 24; k++) this.particles.dust(p, 1, k % 3 ? 0x6a6058 : 0xe8a040, r * 0.6);
    this.view.shake(0.5, 0.35);
    audio.play('explode');
    vibrate(80);
    for (const u of this.units) if (u.alive && u.pos.distanceTo(p) < r) this.damage(u, dmg, null);
    for (const c of this.map.covers) if (c.alive && c.pos.distanceTo(p) < r) this.coverDamage(c, 30, c.pos.clone());
  }

  // =====================================================================
  // Units
  // =====================================================================
  private moveUnit(u: Unit, dt: number): boolean {
    if (!u.path.length) return false;
    const next = u.path[0];
    const dx = next.x - u.pos.x;
    const dz = next.z - u.pos.z;
    const d = Math.hypot(dx, dz);
    const step = TB.runSpeed * dt;
    if (d <= step) {
      u.pos.set(next.x, 0, next.z);
      u.path.shift();
      if (!u.path.length && u.slot) {
        if (u.slot.reserved === u) u.slot.reserved = null;
        if (u.slot.occupant && u.slot.occupant !== u) u.slot = null;
        else u.slot.occupant = u;
        u.timer = 0.3 + Math.random() * 0.5;
      }
    } else {
      u.pos.x += (dx / d) * step;
      u.pos.z += (dz / d) * step;
    }
    u.c.root.rotation.y = Math.atan2(dx, dz);
    u.c.pose = 'run';
    return true;
  }

  private face(u: Unit, p: THREE.Vector3): void {
    u.c.root.rotation.y = Math.atan2(p.x - u.pos.x, p.z - u.pos.z);
  }

  private startReload(u: Unit): void {
    if (u.reserve <= 0 || u.mag >= u.w.mag) return;
    u.state = 'reload';
    u.reloadT = u.w.reload;
    if (u.warn) u.warn.sprite.visible = false;
  }

  private updateAuto(u: Unit, dt: number): void {
    if (this.moveUnit(u, dt)) return;
    if (u.side === 'enemy') this.enemyThink(u, dt);
    if (u.moving) return;

    if (u.state === 'reload') {
      u.c.pose = 'reload';
      u.reloadT -= dt;
      if (u.reloadT <= 0) {
        const need = u.w.mag - u.mag;
        const take = Math.min(need, u.reserve);
        u.mag += take;
        u.reserve -= take;
        u.state = 'cover';
        u.timer = 0.2;
        audio.play('reload', 0.1);
      }
      return;
    }
    if (u.mag === 0) {
      if (u.reserve > 0) this.startReload(u);
      else u.c.pose = 'crouch';
      return;
    }
    u.targetT -= dt;
    if (u.targetT <= 0 || (u.target && !u.target.alive)) {
      u.targetT = 0.4;
      u.target = this.pickTarget(u);
    }
    const t = u.target;
    if (u.stance === 'hold' || !t) {
      u.state = 'cover';
      u.c.pose = u.inCover ? 'crouch' : 'idle';
      if (u.warn) u.warn.sprite.visible = false;
      if (!t && u.mag < u.w.mag) this.startReload(u);
      return;
    }
    this.face(u, t.pos);
    u.c.aimPitch = 0;
    const open = !u.inCover;
    switch (u.state) {
      case 'cover':
        u.c.pose = open ? 'aim' : 'crouch';
        u.timer -= dt;
        if (u.timer <= 0) {
          if (u.side === 'enemy') {
            // coordination: only a couple of bandits shoot at the same time
            const active = this.units.filter((e) => e.alive && e.side === 'enemy' && (e.state === 'warn' || e.state === 'peek')).length;
            if (active >= TB.maxEnemyShooters) {
              u.timer = 0.3 + Math.random() * 0.4;
              break;
            }
            u.state = 'warn';
            u.timer = TB.enemyTelegraph;
          } else {
            u.state = 'peek';
            u.shotsLeft = TB.shotsPerPeek;
            u.fireT = 0.15;
          }
        }
        break;
      case 'warn':
        u.c.pose = 'aim';
        u.timer -= dt;
        if (u.timer <= 0) {
          u.state = 'peek';
          u.shotsLeft = TB.shotsPerPeek;
          u.fireT = 0;
        }
        break;
      case 'peek':
        u.c.pose = 'aim';
        u.fireT -= dt;
        if (u.fireT <= 0 && u.shotsLeft > 0 && u.mag > 0) {
          this.shoot(u, t);
          u.mag--;
          u.shotsLeft--;
          u.fireT = u.w.interval * (0.85 + Math.random() * 0.3);
        }
        if (u.shotsLeft <= 0 || u.mag === 0) {
          u.state = 'cover';
          u.timer = TB.peekDelayMin + Math.random() * (TB.peekDelayMax - TB.peekDelayMin);
          if (u.mag <= 1) this.startReload(u);
        }
        break;
    }
  }

  /** Bandit decisions: pick and change cover. */
  private enemyThink(u: Unit, dt: number): void {
    u.repoT -= dt;
    u.stayT += dt;
    const players = this.units.filter((p) => p.alive && p.side === 'player');
    if (!players.length) return;
    let near = players[0];
    for (const p of players) if (p.pos.distanceTo(u.pos) < near.pos.distanceTo(u.pos)) near = p;
    const pc = new THREE.Vector3();
    for (const p of players) pc.add(p.pos);
    pc.divideScalar(players.length);
    // re-think only after a minimum stay (no running back and forth); cover gone = leave now
    const lost = !u.slot || !u.slot.cover.alive;
    const exposed = !lost && !u.slot!.protects(pc) && !u.slot!.protects(near.pos);
    const rusher = u.rush;
    if (!(lost || u.repoT <= 0 || (exposed && u.stayT > TB.enemyMinStay))) return;
    if (u.state === 'peek' || u.state === 'warn') return;
    u.repoT = TB.enemyReposition * (0.7 + Math.random() * 0.6);
    u.stayT = 0;
    u.rush = false;
    let best: CoverSlot | null = null;
    let bs = -Infinity;
    for (const s of this.map.slots) {
      if (!(s.free || s.occupant === u || s.reserved === u)) continue;
      const dp = s.pos.distanceTo(pc);
      const want = rusher ? TB.enemyRushDist : TB.enemyPreferDist;
      let score = (s.protects(near.pos) ? 10 : -8) + (s.protects(pc) ? 4 : 0) - Math.abs(dp - want) * 0.8 - s.pos.distanceTo(u.pos) * (rusher ? 0.05 : 0.35) + Math.random() * 1.5;
      if (s === u.slot) score += 3; // prefer to stay
      if (s.pos.z > pc.z - 4) score -= 20;
      if (score > bs) {
        bs = score;
        best = s;
      }
    }
    if (best && best !== u.slot) {
      u.goTo(this.map.nav.path(u.pos, best.pos), best);
      if (u.warn) u.warn.sprite.visible = false;
    }
  }

  /** What the screen cursor points at: a bandit's head/body (with snapping) or the ground. */
  private updateAimTarget(): void {
    const cam = this.view.camera;
    let lock: Unit | null = null;
    let head = false;
    let bd = TB.aimSnapPx;
    const hp = new THREE.Vector3();
    const toScreen = (v: THREE.Vector3) => {
      const q = v.clone().project(cam);
      return new THREE.Vector2(((q.x + 1) / 2) * window.innerWidth, ((1 - q.y) / 2) * window.innerHeight);
    };
    for (const u of this.units) {
      if (!u.alive || u.side !== 'enemy') continue;
      u.c.headCenter(hp);
      const hs = toScreen(hp);
      const body = u.pos.clone().setY(u.exposed ? 1.0 : 0.65);
      const bs = toScreen(body);
      const dh = hs.distanceTo(this.cursor);
      const db = bs.distanceTo(this.cursor);
      if (dh < TB.headSnapPx && dh < bd) {
        bd = dh;
        lock = u;
        head = true;
      } else if (db < bd) {
        bd = db;
        lock = u;
        head = false;
      }
    }
    this.lock = lock;
    this.lockHead = head;
    if (lock) {
      if (head) lock.c.headCenter(this.aimPoint);
      else this.aimPoint.copy(lock.pos).setY(lock.exposed ? 1.0 : 0.65);
    } else {
      const g = this.screenToGround(this.cursor.x, this.cursor.y);
      if (g) this.aimPoint.copy(g).setY(0.6);
    }
    this.hud.setCursor(this.cursor.x, this.cursor.y, lock ? (head ? 'head' : 'lock') : '', this.phase === 'play');
  }

  private updateSheriff(dt: number, realDt: number): void {
    const s = this.sheriff;
    if (!s.alive) return;
    this.updateAimTarget();
    this.crossMesh.visible = false;
    s.fireT -= realDt;
    if (this.moveUnit(s, dt)) {
      this.aimLine.visible = false;
      this.fireQueued = false;
      return;
    }
    const aimPoint = this.aimPoint;
    if (this.fireQueued) {
      this.fireQueued = false;
      if (s.fireT <= 0 && s.mag > 0) {
        this.exposedT = TB.sheriffExposeTime;
        s.state = 'peek';
        s.c.pose = 'aim';
        this.face(s, aimPoint);
        s.c.update(0.001);
        const m = this.muzzle(s, new THREE.Vector3());
        this.sheriffShoot(m, aimPoint);
        s.mag--;
        s.fireT = s.w.interval;
        this.sheriffReloadT = -TB.sheriffReloadDelay;
      } else if (s.mag === 0) audio.play('empty', 0.2);
    }
    this.exposedT -= realDt;
    if (this.exposedT > 0) {
      s.state = 'peek';
      s.c.pose = 'aim';
      this.face(s, aimPoint);
      s.c.aimPitch = Math.atan2(aimPoint.y - 1.45, Math.hypot(aimPoint.x - s.pos.x, aimPoint.z - s.pos.z));
      const m = this.muzzle(s, new THREE.Vector3());
      this.aimLine.visible = true;
      this.aimLine.position.copy(m);
      this.aimLine.lookAt(aimPoint);
      this.aimLine.scale.set(0.035, 0.035, m.distanceTo(aimPoint));
      return;
    }
    this.aimLine.visible = false;
    s.state = 'cover';
    // face the cursor target while hidden so the lean-out is quick
    if (this.lock) this.face(s, aimPoint);
    if (s.mag < s.w.mag && s.reserve > 0) {
      this.sheriffReloadT += dt;
      if (this.sheriffReloadT > 0) s.c.pose = 'reload';
      if (this.sheriffReloadT > (s.w.reload / s.w.mag) * (1 - 0.15 * this.def.sheriff.reload)) {
        this.sheriffReloadT = 0;
        s.mag++;
        s.reserve--;
        audio.play('reload', 0.08);
      }
    } else s.c.pose = s.inCover ? 'crouch' : 'idle';
  }

  private sheriffShoot(m: THREE.Vector3, aimPoint: THREE.Vector3): void {
    const s = this.sheriff;
    s.c.fire();
    this.flashes.spawn(m, 0.45, 0.05);
    audio.play('revolver', 0.04);
    const dir = aimPoint.clone().sub(m).normalize();
    const spread = TB.sheriffAccSpread * (1 - 0.2 * this.def.sheriff.acc);
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.normalize();
    const targets: Hittable[] = [];
    for (const u of this.units) {
      if (!u.alive || u.side !== 'enemy') continue;
      targets.push({
        alive: true,
        unit: u,
        boxes: (out: Box[]) => unitBoxes(u, out),
      } as Hittable & { unit: Unit });
    }
    for (const c of this.map.covers) {
      if (!c.alive || c === s.slot?.cover || c.height <= 0) continue;
      targets.push({
        alive: true,
        cover: c,
        boxes: (out: Box[]) => out.push({ min: c.min, max: new THREE.Vector3(c.pos.x + c.half.x, Math.max(0.3, Math.min(c.height, c.half.y)), c.pos.z + c.half.z), part: 'object' }),
      } as Hittable & { cover: CoverObj });
    }
    const hit = raycast(m, dir, targets, 40);
    const end = hit ? hit.point : m.clone().addScaledVector(dir, 30);
    this.tracers.fire(m, end);
    if (!hit) return;
    const t = hit.target as Hittable & { unit?: Unit; cover?: CoverObj };
    if (t.unit) {
      const head = hit.part === 'head';
      this.damage(t.unit, s.w.dmg * (head ? 2 : 1), s, head);
    } else if (t.cover) this.coverDamage(t.cover, 1, hit.point);
  }

  // =====================================================================
  // Waves & loop
  // =====================================================================
  private spawnWaves(): void {
    while (this.waveIdx < this.def.waves.length) {
      const w = this.def.waves[this.waveIdx];
      const enemiesLeft = this.units.some((u) => u.alive && u.side === 'enemy');
      // the next wave comes on time, or early when the plaza is empty
      if (this.time < w.at && (enemiesLeft || this.time < 5)) break;
      this.waveIdx++;
      for (let i = 0; i < w.n; i++) {
        const sp = this.map.enemySpawns[i % this.map.enemySpawns.length].clone();
        sp.z -= 1.5 + Math.floor(i / 3) * 1.2;
        const weapon = w.weapons?.[i] ?? 'revolver';
        const u = this.addUnit('enemy', 'E', weapon, i + this.waveIdx * 3, sp, this.def.enemyHp, 18);
        u.repoT = 0;
        u.timer = 1 + Math.random();
      }
      if (this.waveIdx > 1) this.hud.showBanner(`POSILY BANDY! (${this.waveIdx}/${this.def.waves.length})`, 'bad', 1.6);
    }
  }

  update(rawDt: number): void {
    this.hud.setRotateHint(window.innerHeight > window.innerWidth);
    const dt = rawDt * (this.phase === 'play' ? 1 : 0.4);
    if (this.phase === 'play') {
      this.time += dt;
      this.spawnWaves();
      this.squadT -= dt;
      if (this.squadT <= 0) {
        this.squadT = 2;
        this.squadFollow();
      }
      // now and then a bandit rushes closer (exposed while running)
      this.rushT -= dt;
      if (this.rushT <= 0) {
        this.rushT = TB.enemyRushEvery * (0.7 + Math.random() * 0.6);
        const cands = this.units.filter((u) => u.alive && u.side === 'enemy' && u.state === 'cover' && !u.moving);
        const r = cands[Math.floor(Math.random() * cands.length)];
        if (r) {
          r.rush = true;
          r.repoT = 0;
          r.stayT = 99;
        }
      }
    }
    for (const u of this.units) {
      if (!u.alive) continue;
      if (u === this.sheriff) this.updateSheriff(dt, rawDt);
      else if (this.phase === 'play') this.updateAuto(u, dt);
      else u.c.pose = u.side === 'player' && this.phase === 'won' ? 'cheer' : 'idle';
      if (u.warn) {
        u.warn.sprite.visible = u.alive && u.state === 'warn' && Math.floor(this.time * 10) % 2 === 0;
        if (u.warn.sprite.visible) {
          u.c.headCenter(tmp);
          u.warn.sprite.position.copy(tmp).setY(tmp.y + 0.8);
        }
      }
      u.c.update(dt);
      const ring = this.rings.get(u);
      if (ring) {
        ring.position.set(u.pos.x, 0.03, u.pos.z);
        ring.scale.setScalar(u.group === 'S' ? 1.2 : 1);
        (ring.material as THREE.MeshBasicMaterial).opacity = u.group === 'S' ? 0.95 : 0.5;
      }
    }
    if (this.markerT > 0) {
      this.markerT -= rawDt;
      (this.marker.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.markerT);
    }
    this.particles.update(dt);
    this.tracers.update(rawDt);
    this.flashes.update(dt);
    this.updateCamera(rawDt);
    this.updateHud(rawDt);
    this.batcher.sync();

    if (this.phase === 'play' && this.waveIdx >= this.def.waves.length && !this.units.some((u) => u.alive && u.side === 'enemy')) this.win();
  }

  private updateCamera(dt: number): void {
    const c = new THREE.Vector3();
    let w = 0;
    for (const u of this.units) {
      if (!u.alive || u.side !== 'player') continue;
      const k = u.group === 'S' ? 3 : 1;
      c.addScaledVector(u.pos, k);
      w += k;
    }
    if (w) c.divideScalar(w);
    c.z -= 5;
    c.x *= 0.6;
    c.add(this.pan);
    const b = this.map.bounds;
    c.x = THREE.MathUtils.clamp(c.x, b.minX + 4, b.maxX - 4);
    c.z = THREE.MathUtils.clamp(c.z, b.minZ + 3, b.maxZ - 2);
    this.camTarget.lerp(c, 1 - Math.exp(-dt * 3));
    const pitch = THREE.MathUtils.degToRad(TB.camPitch);
    this.view.updateShake(dt);
    this.view.camera.position.set(this.camTarget.x, Math.sin(pitch) * TB.camDist, this.camTarget.z + Math.cos(pitch) * TB.camDist).add(this.view.shakeOffset);
    this.view.camera.lookAt(this.camTarget);
  }

  private updateHud(dt: number): void {
    this.hud.update(dt);
    const sq = (g: 'A' | 'B') => {
      const all = this.units.filter((u) => u.group === g);
      const alive = all.filter((u) => u.alive);
      return `<span class="${g.toLowerCase()}">${g} ${'●'.repeat(alive.length)}${'○'.repeat(all.length - alive.length)}</span>`;
    };
    this.hud.setSquads(`${sq('A')} &nbsp; ${sq('B')}`);
    const s = this.sheriff;
    this.hud.setHp(s.hp / s.maxHp);
    this.hud.setAmmo(`${s.mag}/${s.w.mag} · ${s.reserve}`, s.mag === 0);
    const enemies = this.units.filter((u) => u.alive && u.side === 'enemy').length;
    this.hud.setTop(`${this.def.name} · vlna ${Math.max(1, this.waveIdx)}/${this.def.waves.length} · bandity: ${enemies}`);
    // ◀ ▶ next to the sheriff when he can slide along his cover
    tmp.copy(s.pos).setY(1.0).project(this.view.camera);
    const x = ((tmp.x + 1) / 2) * window.innerWidth, y = ((1 - tmp.y) / 2) * window.innerHeight;
    const can = s.alive && !s.moving && this.phase === 'play';
    this.hud.setSlides(x, y, can && !!this.slideNeighbour(-1), can && !!this.slideNeighbour(1));
  }

  /** Remove everything this mission added to the scene and the UI. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const u of this.units) u.c.dispose();
    this.scene.remove(this.root, this.backdrop, this.particles.mesh, this.tracers.group, this.flashes.group);
    this.batcher.dispose();
    this.hud.root.remove();
  }

  private floatAt(p: THREE.Vector3, text: string, cls = ''): void {
    tmp2.copy(p).project(this.view.camera);
    if (tmp2.z > 1) return;
    this.hud.float(text, ((tmp2.x + 1) / 2) * window.innerWidth, ((1 - tmp2.y) / 2) * window.innerHeight, cls);
  }

  private win(): void {
    this.phase = 'won';
    audio.play('win');
    this.hud.showBanner('VYHRALI SME!', '', 2.5);
    setTimeout(() => !this.disposed && this.result(true), 2200);
  }

  private lose(): void {
    if (this.phase !== 'play') return;
    this.phase = 'lost';
    audio.play('lose');
    this.hud.showBanner('ŠERIF PADOL', 'bad', 2.5);
    setTimeout(() => !this.disposed && this.result(false), 2200);
  }

  private result(won: boolean): void {
    if (this.def.onEnd) {
      const ammoLeft = new Map<number, number>();
      for (const u of this.units) if (u.side === 'player' && u.alive) ammoLeft.set(this.memberOf.get(u) ?? 0, u.mag + u.reserve);
      this.def.onEnd({ won, kills: this.kills, time: this.time, fallen: this.fallenIds, wounded: this.woundedIds, ammoLeft, killsBy: this.killsBy });
      return;
    }
    const list = (a: string[]) => (a.length ? a.join(', ') : '–');
    this.hud.openScreen(
      `<h1>${won ? 'VÝHRA!' : 'PREHRA'}</h1>
       <p>Zneškodnení bandity: <b>${this.kills}</b> · čas ${Math.round(this.time)} s</p>
       <p>Padli: <b>${list(this.fallen)}</b></p>
       <p>Zranení (k doktorovi): <b>${list(this.wounded)}</b></p>
       <p class="sub">Prototyp – obchody, saloon a doktor prídu v ďalšom kroku.</p>`,
      [{ label: 'HRAŤ ZNOVA', onClick: () => location.reload() }],
    );
  }
}

export function disposeMission(m: Mission): void {
  m.dispose();
}

function unitBoxes(u: Unit, out: Box[]): void {
  const p = u.pos;
  u.c.headCenter(tmp);
  const hs = 0.2;
  out.push({ min: new THREE.Vector3(tmp.x - hs, tmp.y - hs, tmp.z - hs), max: new THREE.Vector3(tmp.x + hs, tmp.y + hs * 1.3, tmp.z + hs), part: 'head' });
  out.push({ min: new THREE.Vector3(p.x - 0.3, 0.05, p.z - 0.3), max: new THREE.Vector3(p.x + 0.3, Math.max(0.5, tmp.y - hs), p.z + 0.3), part: 'body' });
}

/** 2D segment (xz) vs cover footprint. */
function segAabb2D(a: THREE.Vector3, b: THREE.Vector3, c: CoverObj): boolean {
  let t0 = 0, t1 = 1;
  const d = [b.x - a.x, b.z - a.z];
  const o = [a.x, a.z];
  const mn = [c.pos.x - c.half.x, c.pos.z - c.half.z];
  const mx = [c.pos.x + c.half.x, c.pos.z + c.half.z];
  for (let i = 0; i < 2; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return false;
      continue;
    }
    let ta = (mn[i] - o[i]) / d[i];
    let tb = (mx[i] - o[i]) / d[i];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}


import * as THREE from 'three';
import type { View } from '../engine/view';
import { CharacterBatcher } from '../gfx/batcher';
import { Flashes, Particles, Tracers } from '../gfx/effects';
import { buildBackdrop } from '../gfx/town';
import type { WeaponKind } from '../gfx/characterModels';
import { audio, vibrate } from '../audio';
import { raycast, Hittable, HitPart } from '../game/hit';
import { CoverObj, CoverSlot, generatePlaza, MapData } from './map';
import { TB } from './tbalance';
import { GroupId, Unit } from './units';
import { TacticsHud, CardInfo } from './thud';

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

  // selection / commands
  selected: GroupId | null = null;
  ordersFor: GroupId = 'A';
  private selectT = 0;
  private rings = new Map<Unit, THREE.Mesh>();
  private marker: THREE.Mesh;
  private markerT = 0;

  // sheriff aim
  private aimId: number | null = null;
  private aimLast = new THREE.Vector2();
  private padCenter = new THREE.Vector2();
  readonly cross = new THREE.Vector3(0, 0, 0);
  private crossMesh: THREE.Mesh;
  private aimLine: THREE.Mesh;
  private lock: Unit | null = null;
  private lockT = 0;
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
    this.map = generatePlaza(def.seed, this.root);
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
    this.orderMove('S', new THREE.Vector3(0, 0, Z - 5));
    this.orderMove('A', new THREE.Vector3(-6, 0, Z - 5));
    this.orderMove('B', new THREE.Vector3(6, 0, Z - 5));
    this.cross.set(0, 0, 0);

    this.hud.onSelect = (g) => this.select(g);
    this.hud.onStance = (s) => {
      for (const u of this.units) if (u.alive && u.group === this.ordersFor) u.stance = s;
      audio.play('click');
    };
    this.bindInput(view.renderer.domElement);
    this.hud.showBanner(`${def.name.toUpperCase()}<br><small>Vyčisti námestie od bandy</small>`, '', 2.4);
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
  select(g: GroupId): void {
    audio.unlock();
    if (!this.units.some((u) => u.alive && u.group === g)) return;
    if (this.selected === g) {
      this.selected = null;
      return;
    }
    this.selected = g;
    if (g !== 'S') this.ordersFor = g;
    this.selectT = TB.commandTimeout;
    audio.play('click');
  }

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
    this.marker.position.set(point.x, 0.04, point.z);
    (this.marker.material as THREE.MeshBasicMaterial).color.setHex(GROUP_COLOR[g]);
    this.markerT = 1;
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
      // start the crosshair on the nearest visible bandit
      if (!this.lock || !this.lock.alive) {
        const t = this.nearestEnemy(this.sheriff.pos);
        if (t) this.cross.copy(t.pos);
      }
    });
    pad.addEventListener('pointermove', (e) => {
      if (this.disposed || e.pointerId !== this.aimId) return;
      const dx = e.clientX - this.aimLast.x;
      const dy = e.clientY - this.aimLast.y;
      this.aimLast.set(e.clientX, e.clientY);
      const cam = this.view.camera;
      const right = tmp.set(1, 0, 0).applyQuaternion(cam.quaternion).setY(0).normalize();
      const fwd = tmp2.set(0, 0, -1).applyQuaternion(cam.quaternion).setY(0).normalize();
      this.cross.addScaledVector(right, dx * TB.aimPadSensitivity).addScaledVector(fwd, -dy * TB.aimPadSensitivity);
      this.clampToMap(this.cross);
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

    canvas.addEventListener('pointerdown', (e) => {
      if (this.disposed) return;
      audio.unlock();
      if (this.mapId !== null) return;
      this.mapId = e.pointerId;
      this.mapStart.set(e.clientX, e.clientY);
      this.mapLast.set(e.clientX, e.clientY);
      this.mapMoved = false;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.disposed || e.pointerId !== this.mapId) return;
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
      if (e.key === '1') this.select('S');
      if (e.key === '2') this.select('A');
      if (e.key === '3') this.select('B');
    });
  }

  private screenToGround(x: number, y: number): THREE.Vector3 | null {
    ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, this.view.camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(ground, p) ? p : null;
  }

  private tap(x: number, y: number): void {
    const p = this.screenToGround(x, y);
    if (!p) return;
    // tapping one of our men selects his group
    let best: Unit | null = null;
    let bd = 1.2;
    for (const u of this.units) {
      if (!u.alive || u.side !== 'player') continue;
      const d = u.pos.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    if (best && (!this.selected || this.selected === best.group)) {
      this.select(best.group);
      return;
    }
    if (this.selected) {
      this.clampToMap(p);
      this.orderMove(this.selected, p);
      audio.play('click');
      this.selected = null;
    }
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
    const players = this.units.filter((p) => p.alive && p.side === 'player');
    if (!players.length) return;
    let near = players[0];
    for (const p of players) if (p.pos.distanceTo(u.pos) < near.pos.distanceTo(u.pos)) near = p;
    const bad = !u.slot || !u.slot.cover.alive || !u.slot.protects(near.pos);
    if (!(u.repoT <= 0 || (bad && u.state === 'cover'))) return;
    if (u.state === 'peek' || u.state === 'warn') return;
    u.repoT = TB.enemyReposition * (0.7 + Math.random() * 0.6);
    const pc = new THREE.Vector3();
    for (const p of players) pc.add(p.pos);
    pc.divideScalar(players.length);
    let best: CoverSlot | null = null;
    let bs = -Infinity;
    for (const s of this.map.slots) {
      if (!(s.free || s.occupant === u || s.reserved === u)) continue;
      const dp = s.pos.distanceTo(pc);
      let score = (s.protects(near.pos) ? 10 : -8) - Math.abs(dp - TB.enemyPreferDist) * 0.8 - s.pos.distanceTo(u.pos) * 0.25 + Math.random() * 2.5;
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

  private updateSheriff(dt: number, realDt: number): void {
    const s = this.sheriff;
    if (!s.alive) return;
    const aiming = this.aimId !== null;
    this.crossMesh.visible = aiming;
    this.aimLine.visible = aiming && !s.moving;
    if (this.moveUnit(s, dt)) return;
    // snap the crosshair to the nearest bandit
    let lock: Unit | null = null;
    let ld = TB.aimSnap;
    for (const u of this.units) {
      if (!u.alive || u.side !== 'enemy') continue;
      const d = u.pos.distanceTo(this.cross);
      if (d < ld) {
        ld = d;
        lock = u;
      }
    }
    if (lock !== this.lock) {
      this.lock = lock;
      this.lockT = 0;
    }
    if (lock && aiming) this.lockT += realDt;
    const aimPoint = new THREE.Vector3();
    if (lock) {
      if (this.lockT > TB.sheriffHeadAimTime) lock.c.headCenter(aimPoint);
      else aimPoint.copy(lock.pos).setY(lock.inCover && !lock.exposed ? 0.7 : 1.05);
    } else aimPoint.copy(this.cross).setY(1.0);
    (this.crossMesh.material as THREE.MeshBasicMaterial).color.setHex(lock ? (this.lockT > TB.sheriffHeadAimTime ? 0xffd040 : 0xff4a3a) : 0xffffff);
    this.crossMesh.position.set(lock ? lock.pos.x : this.cross.x, 0.05, lock ? lock.pos.z : this.cross.z);
    this.crossMesh.scale.setScalar(lock && this.lockT > TB.sheriffHeadAimTime ? 0.7 : 1);

    if (aiming) {
      s.state = 'peek';
      s.c.pose = 'aim';
      this.face(s, aimPoint);
      s.c.aimPitch = Math.atan2(aimPoint.y - 1.45, Math.hypot(aimPoint.x - s.pos.x, aimPoint.z - s.pos.z));
      const m = this.muzzle(s, new THREE.Vector3());
      this.aimLine.position.copy(m);
      this.aimLine.lookAt(aimPoint);
      this.aimLine.scale.set(0.04, 0.04, m.distanceTo(aimPoint));
      s.fireT -= realDt;
      if (s.fireT <= 0) {
        if (s.mag > 0) {
          this.sheriffShoot(m, aimPoint);
          s.mag--;
          s.fireT = s.w.interval;
        } else {
          audio.play('empty', 0.3);
          s.fireT = 0.3;
        }
      }
      this.sheriffReloadT = 0;
    } else {
      s.state = 'cover';
      if (s.mag < s.w.mag && s.reserve > 0) {
        s.c.pose = 'reload';
        this.sheriffReloadT += dt;
        if (this.sheriffReloadT > (s.w.reload / s.w.mag) * (1 - 0.15 * this.def.sheriff.reload)) {
          this.sheriffReloadT = 0;
          s.mag++;
          s.reserve--;
          audio.play('reload', 0.08);
        }
      } else s.c.pose = s.inCover ? 'crouch' : 'idle';
    }
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
    if (this.selected) {
      this.selectT -= rawDt;
      if (this.selectT <= 0) this.selected = null;
    }
    const ts = this.selected && this.phase === 'play' ? TB.commandSlowMo : this.phase === 'play' ? 1 : 0.4;
    const dt = rawDt * ts;
    if (this.phase === 'play') {
      this.time += dt;
      this.spawnWaves();
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
        const sel = this.selected === u.group;
        ring.scale.setScalar(sel ? 1.25 + Math.sin(this.time * 18) * 0.08 : 1);
        (ring.material as THREE.MeshBasicMaterial).opacity = sel ? 1 : 0.55;
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
    const cards: CardInfo[] = (['S', 'A', 'B'] as GroupId[]).map((g) => {
      const all = this.units.filter((u) => u.group === g);
      const alive = all.filter((u) => u.alive);
      const ammo = alive.reduce((a, u) => a + u.mag + u.reserve, 0);
      return {
        id: g,
        name: g,
        alive: alive.length,
        total: all.length,
        hp: g === 'S' ? Math.max(0, this.sheriff.hp / this.sheriff.maxHp) : 1,
        ammo: g === 'S' ? '' : `náboje ${ammo}`,
        stance: alive[0]?.stance ?? 'fire',
      };
    });
    this.hud.setCards(cards, this.selected, this.ordersFor);
    const s = this.sheriff;
    this.hud.setSheriffAmmo(`${s.mag}/${s.w.mag} · ${s.reserve}`, s.mag === 0);
    const enemies = this.units.filter((u) => u.alive && u.side === 'enemy').length;
    this.hud.setTop(`${this.def.name} · vlna ${Math.max(1, this.waveIdx)}/${this.def.waves.length} · bandity: ${enemies}${this.selected ? ' · <span style="color:#ffd060">ťukni, kam ísť</span>' : ''}`);
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
    this.hud.showBanner('NÁMESTIE JE NAŠE!', '', 2.5);
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


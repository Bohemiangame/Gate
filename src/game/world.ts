import * as THREE from 'three';
import { voxelMaterial } from '../engine/voxel';
import { Character } from '../gfx/character';
import { makeCharacter, gunModel } from '../gfx/models';
import { Label } from '../gfx/label';
import { buildBarrel, buildCrate, buildGateFrame, buildHay, buildTntCrate, buildTrough, buildWagon, buildBarricade, PropModel } from '../gfx/props';
import type { Particles, Tracers, Flashes } from '../gfx/effects';
import type { View } from '../engine/view';
import type { Hud } from '../ui/hud';
import { BALANCE } from './balance';
import type { HitPart, Hittable } from './hit';
import type { CoverKind, GateOp, EnemyWeapon } from './levels';
import type { WeaponKind } from '../gfx/characterModels';
import { audio } from '../audio';

type Box = { min: THREE.Vector3; max: THREE.Vector3; part: HitPart };

/** Services the entities need from the game. */
export interface Ctx {
  scene: THREE.Scene;
  view: View;
  particles: Particles;
  tracers: Tracers;
  flashes: Flashes;
  hud: Hud;
  /** Show a floating text at a world position. */
  floatAt(p: THREE.Vector3, text: string, cls?: string): void;
  /** An enemy fired at the posse. `power` = how many members a hit kills. */
  enemyFired(from: THREE.Vector3, power: number): void;
  /** An explosion happened. */
  explode(p: THREE.Vector3, radius: number, damage: number, byPlayer: boolean): void;
  /** Posse world centre (for aiming). */
  possePos: THREE.Vector3;
  /** Called when a bandit dies (for Dead Eye, counters). */
  onKill(b: Bandit | Rider): void;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Props / cover
// ---------------------------------------------------------------------------
const propCache = new Map<string, PropModel>();
export function propModel(kind: string): PropModel {
  let m = propCache.get(kind);
  if (!m) {
    switch (kind) {
      case 'barrel':
        m = buildBarrel(4);
        break;
      case 'crate':
        m = buildCrate();
        break;
      case 'wagon':
        m = buildWagon();
        break;
      case 'hay':
        m = buildHay();
        break;
      case 'trough':
        m = buildTrough();
        break;
      case 'tnt':
        m = buildTntCrate();
        break;
      case 'weaponcrate':
        m = buildCrate('GUN', 0x6a7a4a);
        break;
      case 'barricade':
        m = buildBarricade(6.4);
        break;
      default:
        m = buildCrate();
    }
    propCache.set(kind, m);
  }
  return m;
}

const COVER_HP: Record<string, number> = { barrel: 10, crate: 12, wagon: 28, hay: 14, trough: 16, tnt: 1, roofcrate: 12, barricade: BALANCE.coverHp };

export class CoverProp implements Hittable {
  alive = true;
  readonly mesh: THREE.Mesh;
  hp: number;
  readonly maxHp: number;
  readonly model: PropModel;
  private shakeT = 0;
  private basePos = new THREE.Vector3();

  constructor(
    private ctx: Ctx,
    readonly kind: string,
    x: number,
    y: number,
    z: number,
    rotY = 0,
    hpMul = 1,
  ) {
    this.model = propModel(kind === 'roofcrate' ? 'crate' : kind);
    this.mesh = new THREE.Mesh(this.model.geo, voxelMaterial);
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = rotY;
    this.basePos.copy(this.mesh.position);
    ctx.scene.add(this.mesh);
    this.maxHp = this.hp = (COVER_HP[kind] ?? 12) * hpMul;
  }

  get isTnt(): boolean {
    return this.kind === 'tnt';
  }

  get pos(): THREE.Vector3 {
    return this.mesh.position;
  }

  boxes(out: Box[]): void {
    const h = this.model.half;
    const rot = Math.abs(Math.sin(this.mesh.rotation.y)) > 0.7;
    const hx = rot ? h.z : h.x;
    const hz = rot ? h.x : h.z;
    const p = this.basePos;
    out.push({ min: new THREE.Vector3(p.x - hx, p.y, p.z - hz), max: new THREE.Vector3(p.x + hx, p.y + h.y, p.z + hz), part: 'object' });
  }

  damage(d: number, at?: THREE.Vector3): void {
    if (!this.alive) return;
    this.hp -= d;
    this.shakeT = 0.12;
    if (at && Math.random() < 0.5) this.ctx.particles.dust(at, 2, 0xa87848, 0.15);
    if (this.hp <= 0) this.destroy();
  }

  destroy(): void {
    if (!this.alive) return;
    this.alive = false;
    this.mesh.updateMatrixWorld(true);
    tmp.copy(this.mesh.position).add(new THREE.Vector3(0, 0.2, 0.3));
    this.ctx.particles.burst(this.model.debris, this.mesh.matrixWorld, tmp, this.isTnt ? 7 : 3, 0.08, 160);
    this.ctx.scene.remove(this.mesh);
    audio.play('wood');
    if (this.isTnt) {
      tmp.copy(this.mesh.position).add(new THREE.Vector3(0, 0.5, 0));
      this.ctx.explode(tmp.clone(), BALANCE.tntRadius, BALANCE.tntDamage, true);
    }
  }

  update(dt: number): void {
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeT > 0 ? 0.03 : 0;
      this.mesh.position.set(this.basePos.x + (Math.random() - 0.5) * a, this.basePos.y, this.basePos.z + (Math.random() - 0.5) * a);
    }
  }

  remove(): void {
    this.ctx.scene.remove(this.mesh);
  }
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------
const GATE_COLORS: Record<string, number> = { good: 0x2f7fe8, bad: 0xe03a2a, mul: 0xf0b020 };

export class GatePanel implements Hittable {
  alive = true;
  progress = 0;
  private bumps = 0;
  readonly label: Label;
  readonly banner: THREE.Mesh;
  readonly frame: THREE.Mesh;
  private pulse = 0;

  constructor(
    private ctx: Ctx,
    public op: GateOp,
    public v: number,
    readonly x0: number,
    readonly x1: number,
    readonly z: number,
  ) {
    const w = x1 - x0;
    if (op === '-') {
      this.op = '+';
      this.v = -v;
    }
    this.frame = new THREE.Mesh(gateFrame(w), voxelMaterial);
    this.frame.position.set((x0 + x1) / 2, 0, z);
    ctx.scene.add(this.frame);
    this.banner = new THREE.Mesh(
      new THREE.PlaneGeometry(w - 0.4, 2.55),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.banner.position.set((x0 + x1) / 2, 1.5, z);
    ctx.scene.add(this.banner);
    this.label = new Label(this.text(), 0.95);
    this.label.sprite.position.set((x0 + x1) / 2, 1.75, z + 0.05);
    ctx.scene.add(this.label.sprite);
    this.refresh();
  }

  text(): string {
    if (this.op === 'x') return `×${this.v}`;
    if (this.op === '/') return `÷${this.v}`;
    return this.v >= 0 ? `+${this.v}` : `−${-this.v}`;
  }

  get good(): boolean {
    return this.op === 'x' || (this.op === '+' && this.v > 0);
  }

  refresh(): void {
    const col = this.op === 'x' ? GATE_COLORS.mul : this.op === '/' ? GATE_COLORS.bad : this.v > 0 ? GATE_COLORS.good : this.v === 0 ? 0x9a9a9a : GATE_COLORS.bad;
    (this.banner.material as THREE.MeshBasicMaterial).color.setHex(col);
    this.label.set(this.text());
  }

  boxes(out: Box[]): void {
    out.push({ min: new THREE.Vector3(this.x0 + 0.2, 0, this.z - 0.2), max: new THREE.Vector3(this.x1 - 0.2, 2.9, this.z + 0.2), part: 'object' });
  }

  hit(): void {
    if (this.op === 'x') return;
    this.progress++;
    this.pulse = 0.12;
    if (this.op === '/') {
      if (this.progress >= BALANCE.divGateHitsToFlip) {
        this.op = '+';
        this.v = 0;
        this.progress = 0;
        this.refresh();
        audio.play('coin');
      }
      return;
    }
    if (this.op === '+' && this.v >= BALANCE.gateShootCap) return;
    if (this.progress >= this.hitsNeeded) {
      this.progress = 0;
      this.bumps++;
      this.v++;
      this.refresh();
      audio.play('coin', 0.05);
      tmp.set((this.x0 + this.x1) / 2, 2.3, this.z);
      this.ctx.floatAt(tmp, '+1', 'good');
    }
  }

  get hitsNeeded(): number {
    return BALANCE.gateHitsPerPoint + BALANCE.gateHitsGrowth * this.bumps;
  }

  apply(n: number): number {
    if (this.op === 'x') return n * this.v;
    if (this.op === '/') return Math.ceil(n / this.v);
    return n + this.v;
  }

  update(dt: number): void {
    if (this.pulse > 0) {
      this.pulse -= dt;
      (this.banner.material as THREE.MeshBasicMaterial).opacity = this.pulse > 0 ? 0.7 : 0.42;
    }
  }

  remove(): void {
    this.ctx.scene.remove(this.frame, this.banner, this.label.sprite);
    this.label.dispose();
  }
}

const frameCache = new Map<number, THREE.BufferGeometry>();
function gateFrame(w: number): THREE.BufferGeometry {
  const k = Math.round(w * 10);
  let g = frameCache.get(k);
  if (!g) {
    g = buildGateFrame(w).geo;
    frameCache.set(k, g);
  }
  return g;
}

export class GateRow {
  passed = false;
  readonly panels: GatePanel[];
  constructor(ctx: Ctx, defs: { op: GateOp; v: number }[], readonly z: number, halfWidth: number, valueMul: number) {
    const n = defs.length;
    const w = (halfWidth * 2) / n;
    this.panels = defs.map((d, i) => {
      const v = d.op === '+' || d.op === '-' ? Math.max(1, Math.round(d.v * valueMul)) : d.v;
      return new GatePanel(ctx, d.op, v, -halfWidth + i * w, -halfWidth + (i + 1) * w, z);
    });
  }
  panelAt(x: number): GatePanel {
    for (const p of this.panels) if (x >= p.x0 && x < p.x1) return p;
    return x < 0 ? this.panels[0] : this.panels[this.panels.length - 1];
  }
}

// ---------------------------------------------------------------------------
// Weapon crate
// ---------------------------------------------------------------------------
export class WeaponCrate implements Hittable {
  alive = true;
  readonly mesh: THREE.Mesh;
  readonly label: Label;
  readonly nameLabel: Label;
  private shakeT = 0;

  constructor(
    private ctx: Ctx,
    public hits: number,
    readonly weapon: WeaponKind,
    readonly x: number,
    readonly z: number,
    onOpen: (c: WeaponCrate) => void,
  ) {
    this.onOpen = onOpen;
    const m = propModel('weaponcrate');
    this.mesh = new THREE.Mesh(m.geo, voxelMaterial);
    this.mesh.scale.setScalar(1.35);
    this.mesh.position.set(x, 0, z);
    ctx.scene.add(this.mesh);
    // the gun itself floating above the crate
    this.gun = new THREE.Mesh(gunModel(weapon).geo, voxelMaterial);
    this.gun.scale.setScalar(2.2);
    this.gun.position.set(x, 2.35, z);
    this.gun.rotation.y = Math.PI / 2;
    ctx.scene.add(this.gun);
    this.label = new Label(String(hits), 0.7, { color: '#ffffff' });
    this.label.sprite.position.set(x, 1.65, z + 0.7);
    this.nameLabel = new Label(BALANCE.weapons[weapon].name.toUpperCase(), 0.42, { color: '#ffe070' });
    this.nameLabel.sprite.position.set(x, 3.0, z);
    ctx.scene.add(this.label.sprite, this.nameLabel.sprite);
  }
  private onOpen: (c: WeaponCrate) => void;
  private gun: THREE.Mesh;

  boxes(out: Box[]): void {
    out.push({ min: new THREE.Vector3(this.x - 0.65, 0, this.z - 0.65), max: new THREE.Vector3(this.x + 0.65, 1.3, this.z + 0.65), part: 'object' });
  }

  hit(): void {
    if (!this.alive) return;
    this.hits--;
    this.shakeT = 0.08;
    this.label.set(String(Math.max(0, this.hits)));
    if (this.hits <= 0) {
      this.alive = false;
      this.mesh.updateMatrixWorld(true);
      this.ctx.particles.burst(propModel('weaponcrate').debris, this.mesh.matrixWorld, this.mesh.position.clone().add(new THREE.Vector3(0, 0.3, 0.4)), 4, 0.09);
      audio.play('crate');
      this.remove();
      this.onOpen(this);
    }
  }

  update(dt: number, t: number): void {
    this.gun.rotation.y = t * 2;
    this.gun.position.y = 2.35 + Math.sin(t * 3) * 0.08;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      this.mesh.position.x = this.x + (this.shakeT > 0 ? (Math.random() - 0.5) * 0.06 : 0);
    }
  }

  remove(): void {
    this.ctx.scene.remove(this.mesh, this.gun, this.label.sprite, this.nameLabel.sprite);
    this.label.dispose();
    this.nameLabel.dispose();
  }
}

// ---------------------------------------------------------------------------
// Characters with hit boxes
// ---------------------------------------------------------------------------
function charBoxes(c: Character, crouched: boolean, out: Box[], scale = 1): void {
  const p = c.root.position;
  c.headCenter(tmp);
  const hs = 0.2 * scale;
  out.push({ min: new THREE.Vector3(tmp.x - hs, tmp.y - hs, tmp.z - hs), max: new THREE.Vector3(tmp.x + hs, tmp.y + hs * 1.3, tmp.z + hs), part: 'head' });
  const top = tmp.y - hs;
  const w = 0.28 * scale;
  out.push({ min: new THREE.Vector3(p.x - w, p.y + 0.05, p.z - w), max: new THREE.Vector3(p.x + w, Math.max(p.y + 0.4, top), p.z + w), part: 'body' });
  void crouched;
}

function dieBurst(ctx: Ctx, c: Character, force = 3.5): void {
  c.root.updateMatrixWorld(true);
  tmp.copy(c.root.position).add(new THREE.Vector3(0, 0.6 * c.root.scale.y, -0.5));
  ctx.particles.burst(c.model.debris, c.root.matrixWorld, tmp, force, 0.065 * c.root.scale.x, 220);
  ctx.scene.remove(c.root);
  audio.play('die', 0.02);
}

/** Lone bandit in the street during the run phase. */
export class Rider implements Hittable {
  alive = true;
  readonly c: Character;
  hp: number;
  private timer: number;
  private warn: Label;
  private state: 'idle' | 'warn' | 'cool' = 'idle';

  constructor(
    private ctx: Ctx,
    x: number,
    readonly z: number,
    hp: number,
    telegraph: number,
  ) {
    this.hp = hp;
    this.telegraph = telegraph;
    this.c = makeCharacter('bandit', Math.floor(Math.random() * 6), 'revolver');
    this.c.root.position.set(x, 0, z);
    ctx.scene.add(this.c.root);
    this.timer = 0.4 + Math.random() * 0.6;
    this.warn = new Label('!', 0.9, { color: '#ffdd33', stroke: '#8a0000' });
    this.warn.sprite.visible = false;
    ctx.scene.add(this.warn.sprite);
  }
  private telegraph: number;

  boxes(out: Box[]): void {
    charBoxes(this.c, false, out);
  }

  damage(d: number, head: boolean): boolean {
    if (!this.alive) return false;
    this.hp -= d;
    this.c.flash();
    if (this.hp <= 0) {
      this.kill();
      return true;
    }
    return false;
  }

  kill(): void {
    if (!this.alive) return;
    this.alive = false;
    this.warn.sprite.visible = false;
    dieBurst(this.ctx, this.c);
    this.ctx.scene.remove(this.warn.sprite);
    this.ctx.onKill(this);
  }

  update(dt: number, posseZ: number, posseX: number, t: number): void {
    if (!this.alive) return;
    const dist = this.z - posseZ;
    const near = posseZ - this.z < 30 && posseZ > this.z;
    tmp.set(posseX, 0, posseZ);
    this.c.root.rotation.y = Math.atan2(tmp.x - this.c.root.position.x, tmp.z - this.c.root.position.z);
    if (near) {
      this.timer -= dt;
      if (this.state === 'idle') {
        this.c.pose = 'idle';
        if (this.timer <= 0) {
          this.state = 'warn';
          this.timer = this.telegraph;
          audio.play('warn');
        }
      } else if (this.state === 'warn') {
        this.c.pose = 'aim';
        this.c.aimPitch = -0.05;
        if (this.timer <= 0) {
          this.c.fire();
          this.c.getMuzzleWorld(tmp2);
          this.ctx.flashes.spawn(tmp2, 0.45, 0.05);
          this.ctx.enemyFired(tmp2.clone(), 1);
          this.state = 'cool';
          this.timer = BALANCE.riderInterval;
        }
      } else {
        this.c.pose = 'aim';
        if (this.timer <= 0) {
          this.state = 'idle';
          this.timer = 0.3;
        }
      }
    } else {
      this.c.pose = 'idle';
    }
    this.warn.sprite.visible = this.state === 'warn' && Math.floor(t * 10) % 2 === 0;
    if (this.warn.sprite.visible) {
      this.c.headCenter(tmp2);
      this.warn.sprite.position.copy(tmp2).add(new THREE.Vector3(0, 0.7, 0));
    }
    void dist;
    this.c.update(dt);
  }

  remove(): void {
    this.ctx.scene.remove(this.c.root, this.warn.sprite);
    this.warn.dispose();
  }
}

type BanditState = 'idle' | 'hidden' | 'warn' | 'fire' | 'exposed';

/** Fight-phase bandit behind cover. */
export class Bandit implements Hittable {
  alive = true;
  active = false;
  readonly c: Character;
  hp: number;
  readonly maxHp: number;
  state: BanditState = 'idle';
  timer = 0;
  readonly warn: Label;
  readonly base = new THREE.Vector3();
  readonly isBoss: boolean;
  private burstLeft = 0;
  private hpLabel: Label | null = null;

  constructor(
    protected ctx: Ctx,
    readonly cover: CoverProp | null,
    x: number,
    y: number,
    z: number,
    hp: number,
    readonly weapon: EnemyWeapon,
    protected telegraph: number,
    boss = false,
  ) {
    this.isBoss = boss;
    this.c = boss ? makeCharacter('boss', 0, 'gatling') : makeCharacter('bandit', Math.floor(Math.random() * 6), weapon === 'dynamite' ? 'dynamite' : weapon);
    if (boss) this.c.root.scale.setScalar(1.55);
    this.base.set(x, y, z);
    this.c.root.position.copy(this.base);
    ctx.scene.add(this.c.root);
    this.hp = this.maxHp = hp;
    this.warn = new Label('!', boss ? 1.3 : 0.9, { color: '#ffdd33', stroke: '#8a0000' });
    this.warn.sprite.visible = false;
    ctx.scene.add(this.warn.sprite);
    this.c.pose = 'crouch';
  }

  get exposed(): boolean {
    return this.state === 'warn' || this.state === 'fire' || this.state === 'exposed' || !this.cover || !this.cover.alive;
  }

  get crouched(): boolean {
    return this.c.pose === 'crouch';
  }

  boxes(out: Box[]): void {
    if (!this.exposed) return;
    charBoxes(this.c, this.crouched, out, this.c.root.scale.x);
  }

  activate(delay: number): void {
    this.active = true;
    this.state = 'hidden';
    this.timer = delay;
  }

  damage(d: number, head: boolean): boolean {
    if (!this.alive) return false;
    this.hp -= d;
    this.c.flash();
    if (!this.hpLabel && !this.isBoss && this.maxHp > 3) {
      this.hpLabel = new Label('', 0.36, { color: '#ffffff', bg: 'rgba(120,20,10,0.85)', px: 40 });
      this.ctx.scene.add(this.hpLabel.sprite);
    }
    if (this.hp <= 0) {
      this.kill();
      return true;
    }
    return false;
  }

  kill(force = 3.5): void {
    if (!this.alive) return;
    this.alive = false;
    this.warn.sprite.visible = false;
    this.ctx.scene.remove(this.warn.sprite);
    if (this.hpLabel) this.ctx.scene.remove(this.hpLabel.sprite);
    dieBurst(this.ctx, this.c, force);
    this.ctx.onKill(this);
  }

  private hiddenTime(): number {
    if (this.isBoss) return BALANCE.bossHiddenMin + Math.random() * (BALANCE.bossHiddenMax - BALANCE.bossHiddenMin);
    return BALANCE.enemyHiddenMin + Math.random() * (BALANCE.enemyHiddenMax - BALANCE.enemyHiddenMin);
  }

  update(dt: number, t: number): void {
    if (!this.alive) return;
    const c = this.c;
    // face the posse
    const pp = this.ctx.possePos;
    const dx = pp.x - this.base.x;
    const dz = pp.z - this.base.z;
    c.root.rotation.y = Math.atan2(dx, dz);
    c.aimPitch = Math.atan2(1.0 - (this.base.y + 1.45 * c.root.scale.y), Math.hypot(dx, dz));

    if (this.active) {
      this.timer -= dt;
      switch (this.state) {
        case 'hidden':
          if (this.timer <= 0) {
            this.state = 'warn';
            this.timer = this.isBoss ? BALANCE.bossTelegraph : this.telegraph;
            audio.play('warn', 0.1);
          }
          break;
        case 'warn':
          if (this.timer <= 0) {
            this.state = 'fire';
            this.burstLeft = this.isBoss ? BALANCE.bossBurst : 1;
            this.timer = 0;
          }
          break;
        case 'fire':
          if (this.timer <= 0) {
            this.shoot();
            this.burstLeft--;
            this.timer = BALANCE.bossBurstGap;
            if (this.burstLeft <= 0) {
              this.state = 'exposed';
              this.timer = BALANCE.enemyExposedAfterShot;
            }
          }
          break;
        case 'exposed':
          if (this.timer <= 0) {
            this.state = 'hidden';
            this.timer = this.hiddenTime();
          }
          break;
      }
    }

    const up = this.state === 'warn' || this.state === 'fire' || this.state === 'exposed';
    if (up) c.pose = this.weapon === 'dynamite' ? 'throw' : 'aim';
    else c.pose = this.cover ? 'crouch' : 'idle';
    // roof bandits duck lower behind their crate
    c.root.position.y = this.base.y;

    this.warn.sprite.visible = this.state === 'warn' && Math.floor(t * 10) % 2 === 0;
    c.headCenter(tmp);
    if (this.warn.sprite.visible) this.warn.sprite.position.copy(tmp).add(new THREE.Vector3(0, 0.75 * c.root.scale.y, 0));
    if (this.hpLabel) {
      this.hpLabel.set(String(Math.max(0, Math.ceil(this.hp))));
      this.hpLabel.sprite.position.copy(tmp).add(new THREE.Vector3(0, 0.55, 0));
    }
    c.update(dt);
  }

  private shoot(): void {
    const c = this.c;
    c.fire();
    c.getMuzzleWorld(tmp2);
    if (this.weapon === 'dynamite') {
      this.ctx.enemyFired(tmp2.clone(), -1); // -1 = dynamite (handled by game)
      return;
    }
    this.ctx.flashes.spawn(tmp2, this.isBoss ? 0.8 : 0.45, 0.05);
    this.ctx.enemyFired(tmp2.clone(), this.isBoss ? 1 : 1);
  }

  remove(): void {
    this.ctx.scene.remove(this.c.root, this.warn.sprite);
    if (this.hpLabel) this.ctx.scene.remove(this.hpLabel.sprite);
    this.warn.dispose();
  }
}

/** Factory for an enemy with its cover, placed relative to the posse cover line. */
export function spawnEnemy(ctx: Ctx, cover: CoverKind, x: number, coverLineZ: number, dz: number, hp: number, weapon: EnemyWeapon, telegraph: number, coverMul: number, covers: CoverProp[]): Bandit {
  const zCover = coverLineZ - dz;
  if (cover === 'roof') {
    const y = 3.0;
    const cp = new CoverProp(ctx, 'roofcrate', x - Math.sign(x) * 0.15, y, zCover, 0, coverMul);
    covers.push(cp);
    return new Bandit(ctx, cp, x, y, zCover - 0.75, hp, weapon, telegraph);
  }
  if (cover === 'none') return new Bandit(ctx, null, x, 0, zCover, hp, weapon, telegraph);
  const rot = cover === 'wagon' || cover === 'trough' || cover === 'hay' ? 0 : Math.random() * 6;
  const cp = new CoverProp(ctx, cover, x, 0, zCover, rot, coverMul);
  covers.push(cp);
  const behind = cover === 'wagon' ? 1.0 : 0.8;
  return new Bandit(ctx, cp, x, 0, zCover - behind, hp, weapon, telegraph);
}

// ---------------------------------------------------------------------------
// Thrown dynamite (both sides)
// ---------------------------------------------------------------------------
export class Dynamite {
  alive = true;
  readonly mesh: THREE.Mesh;
  private t = 0;
  private spark = 0;
  constructor(
    private ctx: Ctx,
    readonly from: THREE.Vector3,
    readonly to: THREE.Vector3,
    readonly flight: number,
    readonly byPlayer: boolean,
    readonly damage: number,
    readonly radius: number,
  ) {
    this.mesh = new THREE.Mesh(gunModel('dynamite').geo, voxelMaterial);
    this.mesh.scale.setScalar(1.3);
    this.mesh.position.copy(from);
    ctx.scene.add(this.mesh);
  }
  update(dt: number): void {
    if (!this.alive) return;
    this.t += dt;
    const k = Math.min(1, this.t / this.flight);
    this.mesh.position.lerpVectors(this.from, this.to, k);
    this.mesh.position.y += Math.sin(k * Math.PI) * (2.2 + this.from.distanceTo(this.to) * 0.12);
    this.mesh.rotation.x += dt * 12;
    this.mesh.rotation.z += dt * 7;
    this.spark -= dt;
    if (this.spark <= 0) {
      this.spark = 0.05;
      this.ctx.flashes.spawn(this.mesh.position, 0.25, 0.08);
    }
    if (k >= 1) {
      this.alive = false;
      this.ctx.scene.remove(this.mesh);
      this.ctx.explode(this.to.clone(), this.radius, this.damage, this.byPlayer);
    }
  }
  remove(): void {
    this.ctx.scene.remove(this.mesh);
  }
}

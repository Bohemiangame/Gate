import * as THREE from 'three';
import type { View } from '../engine/view';
import { Character } from '../gfx/character';
import { CharacterBatcher } from '../gfx/batcher';
import { makeCharacter, gunModel } from '../gfx/models';
import { buildBackdrop, buildStreet } from '../gfx/town';
import { Flashes, Particles, Tracers } from '../gfx/effects';
import type { WeaponKind } from '../gfx/characterModels';
import { Hud } from '../ui/hud';
import { audio, vibrate } from '../audio';
import { Ads } from '../ads';
import { BALANCE, hpScale, telegraphFor, upgradeCost, UpgradeKey } from './balance';
import { LevelDef, levelDef, LEVELS } from './levels';
import { loadSave, SaveData, writeSave } from './save';
import { raycast, Hittable, RayHit } from './hit';
import { Bandit, CoverProp, Ctx, Dynamite, GatePanel, GateRow, Rider, spawnEnemy, WeaponCrate } from './world';

type Phase = 'menu' | 'run' | 'fight' | 'cleared' | 'win' | 'lose' | 'result';

interface Member {
  c: Character;
  slot: THREE.Vector3;
  fireT: number;
}

interface FightRT {
  boss: boolean;
  coverZ: number;
  stopZ: number;
  exitZ: number;
  enemies: Bandit[];
  covers: CoverProp[];
  playerCover: CoverProp;
  bossUnit: Bandit | null;
  started: boolean;
  done: boolean;
  defs: { enemies: number };
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();

export class Game {
  readonly scene: THREE.Scene;
  readonly hud: Hud;
  readonly particles = new Particles();
  readonly tracers = new Tracers(90);
  readonly flashes = new Flashes(60);
  private batcher: CharacterBatcher;
  save: SaveData;

  // level state
  phase: Phase = 'menu';
  levelIndex = 0;
  level!: LevelDef;
  root = new THREE.Group();
  private backdrop = buildBackdrop();
  members: Member[] = [];
  posseX = 0;
  targetX = 0;
  posseZ = 0;
  private startZ = 0;
  private endZ = 0;
  weapon: WeaponKind = 'revolver';
  ammo = 6;
  private reloadT = 0;
  private fireT = 0;
  gates: GateRow[] = [];
  crates: WeaponCrate[] = [];
  riders: Rider[] = [];
  fights: FightRT[] = [];
  fight: FightRT | null = null;
  private dynamites: Dynamite[] = [];
  private peak = 0;
  private levelTime = 0;
  private phaseT = 0;
  private time = 0;
  kills = 0;
  lost = 0;

  // input
  private pointerId: number | null = null;
  private lastPX = 0;
  holding = false;
  private aimScreen = new THREE.Vector2();
  readonly aimPoint = new THREE.Vector3();
  private aimLine: THREE.Mesh;
  private reticle: THREE.Mesh;

  // dead eye
  deadEye = 0;
  private deadEyeT = 0;
  timeScale = 1;
  private slowMoT = 0;

  // camera
  private camPos = new THREE.Vector3(0, 8, 8);
  private camLook = new THREE.Vector3(0, 0, -8);
  private hfov = 58;

  // upgrades
  private dmgMul = 1;
  private rateMul = 1;
  private reloadMul = 1;
  private coverMul = 1;

  god = false;
  /** Bot player used by tests and the balance simulation (?sim / debug). */
  autoplay: null | { duck: number; aimError: number; headBias: number; greedy: number; react: number } = null;
  private botT = 0;
  private botTarget: unknown = null;
  private botAcquire = 0;
  /** Called when a level ends (used by the simulation). */
  onResult: ((r: { won: boolean; level: number; survivors: number; peak: number; time: number; stars: number; coins: number; progress: number; lost: number }) => void) | null = null;
  private ctx: Ctx;
  private tutorialStep = 0;

  constructor(
    readonly view: View,
    uiRoot: HTMLElement,
  ) {
    this.scene = view.scene;
    this.batcher = new CharacterBatcher(view.scene);
    this.hud = new Hud(uiRoot);
    this.save = loadSave();
    audio.enabled = this.save.sound;
    this.scene.add(this.particles.mesh, this.tracers.group, this.flashes.group, this.backdrop, this.root);

    // aim line + reticle
    this.aimLine = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false, fog: false }),
    );
    this.aimLine.renderOrder = 20;
    this.aimLine.visible = false;
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, fog: false, side: THREE.DoubleSide }));
    this.reticle.renderOrder = 21;
    this.reticle.visible = false;
    this.scene.add(this.aimLine, this.reticle);

    const game = this;
    this.ctx = {
      get scene() {
        return game.root as unknown as THREE.Scene;
      },
      view,
      particles: this.particles,
      tracers: this.tracers,
      flashes: this.flashes,
      hud: this.hud,
      floatAt: (p, text, cls) => this.floatAt(p, text, cls),
      enemyFired: (from, power) => this.enemyFired(from, power),
      explode: (p, r, d, byPlayer) => this.explode(p, r, d, byPlayer),
      possePos: new THREE.Vector3(),
      onKill: () => {
        this.kills++;
      },
    };

    this.hud.onDeadEye = () => this.activateDeadEye();
    this.bindInput(view.renderer.domElement);
    this.loadLevel(this.save.level);
    this.showMenu();
  }

  // =====================================================================
  // Level setup
  // =====================================================================
  loadLevel(index: number): void {
    this.clearLevel();
    this.levelIndex = index;
    this.level = levelDef(index);
    const L = this.level;
    const u = this.save.upg;
    this.dmgMul = 1 + 0.15 * u.damage;
    this.rateMul = 1 + 0.1 * u.rate;
    this.reloadMul = 1 + 0.2 * u.reload;
    this.coverMul = 1 + 0.25 * u.cover;
    const hpMul = hpScale(index);
    const tele = telegraphFor(index);
    const gateMul = 1 + BALANCE.gateGrowth * index;

    let z = 0;
    this.startZ = 0;
    for (const seg of L.segments) {
      if (seg.kind === 'run') {
        for (const it of seg.items) {
          const iz = z - it.at;
          if (it.t === 'gates') this.gates.push(new GateRow(this.ctx, it.gates, iz, BALANCE.laneHalf + 0.3, gateMul));
          else if (it.t === 'crate') this.crates.push(new WeaponCrate(this.ctx, it.hits, it.weapon, it.x, iz, (c) => this.openCrate(c)));
          else this.riders.push(new Rider(this.ctx, it.x, iz, Math.max(1, Math.round(it.hp * hpMul * BALANCE.riderHpMul)), tele + 0.15));
        }
        z -= seg.len;
      } else {
        const coverZ = z - 2;
        const covers: CoverProp[] = [];
        const enemies: Bandit[] = [];
        const defs = seg.kind === 'fight' ? seg.enemies : seg.guards;
        for (const d of defs) enemies.push(spawnEnemy(this.ctx, d.cover, d.x, coverZ, d.dz, Math.max(1, Math.round(d.hp * hpMul * BALANCE.enemyHpMul)), d.weapon ?? (d.cover === 'roof' ? 'rifle' : 'revolver'), tele, 1, covers));
        for (const t of seg.tnt ?? []) covers.push(new CoverProp(this.ctx, 'tnt', t.x, 0, coverZ - t.dz, 0.3));
        let bossUnit: Bandit | null = null;
        if (seg.kind === 'boss') {
          const wz = coverZ - 14;
          const wagon = new CoverProp(this.ctx, 'wagon', 0, 0, wz, 0, 2.2);
          covers.push(wagon);
          bossUnit = new Bandit(this.ctx, wagon, 0, 0, wz - 1.3, Math.round(seg.hp * hpMul * BALANCE.bossHpMul), 'revolver', tele, true);
          enemies.push(bossUnit);
        }
        const playerCover = new CoverProp(this.ctx, 'barricade', 0, 0, coverZ, 0, this.coverMul);
        this.fights.push({
          boss: seg.kind === 'boss',
          coverZ,
          stopZ: coverZ + 1.0,
          exitZ: coverZ - 22,
          enemies,
          covers,
          playerCover,
          bossUnit,
          started: false,
          done: false,
          defs: { enemies: enemies.length },
        });
        z = coverZ - 22;
      }
    }
    this.endZ = z;
    this.root.add(buildStreet(30, z - 60, L.seed));

    // posse
    this.weapon = BALANCE.weaponOrder[Math.min(2, u.weapon)];
    this.ammo = BALANCE.weapons[this.weapon].mag;
    const start = Math.min(BALANCE.maxPosse, BALANCE.startPosse + u.start);
    this.posseX = this.targetX = 0;
    this.posseZ = 0;
    for (let i = 0; i < start; i++) this.addMember(true);
    this.layoutRun(true);
    this.peak = start;
    this.levelTime = 0;
    this.kills = 0;
    this.lost = 0;
    this.deadEye = 0;
    this.fight = null;
    this.timeScale = 1;
    this.hud.setLevel(`${index + 1}. ${L.name}`);
    this.hud.setCoins(this.save.coins);
    this.hud.setWeapon(BALANCE.weapons[this.weapon].name);
    this.hud.setProgress(0);
    this.hud.show('boss', false);
    this.hud.show('ammo', false);
    this.hud.show('deadeye', false);
    this.camPos.set(0, 8.5, 6.5);
    this.camLook.set(0, 0, -8);
  }

  clearLevel(): void {
    for (const g of this.gates) for (const p of g.panels) p.remove();
    for (const c of this.crates) c.remove();
    for (const r of this.riders) r.remove();
    for (const f of this.fights) {
      for (const e of f.enemies) e.remove();
      for (const c of f.covers) c.remove();
      f.playerCover.remove();
    }
    for (const d of this.dynamites) d.remove();
    for (const m of this.members) m.c.dispose();
    this.scene.remove(this.root);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.members = [];
    this.gates = [];
    this.crates = [];
    this.riders = [];
    this.fights = [];
    this.dynamites = [];
  }

  // =====================================================================
  // Posse
  // =====================================================================
  addMember(silent = false): void {
    if (this.members.length >= BALANCE.maxPosse) return;
    const i = this.members.length + Math.floor(Math.random() * 100);
    const c = makeCharacter('posse', i, this.weapon);
    c.root.rotation.y = Math.PI;
    const ox = (Math.random() - 0.5) * 1.2;
    c.root.position.set(this.posseX + ox, 0, this.posseZ + 0.5 + Math.random());
    this.root.add(c.root);
    this.members.push({ c, slot: new THREE.Vector3(), fireT: Math.random() * 0.3 });
    if (!silent) this.particles.dust(c.root.position, 5, 0xe8d8b0, 0.5);
  }

  killMember(m?: Member): void {
    if (this.god || !this.members.length) return;
    const idx = m ? this.members.indexOf(m) : Math.floor(Math.random() * this.members.length);
    if (idx < 0) return;
    const victim = this.members[idx];
    this.members.splice(idx, 1);
    this.lost++;
    victim.c.root.updateMatrixWorld(true);
    tmp.copy(victim.c.root.position).add(new THREE.Vector3(0, 0.6, 0.6));
    this.particles.burst(victim.c.model.debris, victim.c.root.matrixWorld, tmp, 3, 0.065, 200);
    this.root.remove(victim.c.root);
    victim.c.dispose();
    this.hud.hurt();
    audio.play('hurt', 0.05);
    vibrate(60);
    if (this.members.length === 0) this.lose();
  }

  private layoutRun(snap = false): void {
    const n = this.members.length;
    const s = BALANCE.formationSpacing;
    for (let i = 0; i < n; i++) {
      const r = s * Math.sqrt(i) * 1.05;
      const a = i * 2.39996;
      this.members[i].slot.set(Math.sin(a) * r, 0, Math.cos(a) * r * 0.85 + 0.2);
      if (snap) this.members[i].c.root.position.set(this.posseX + this.members[i].slot.x, 0, this.posseZ + this.members[i].slot.z);
    }
  }

  private layoutFight(): void {
    const n = this.members.length;
    const perRow = 10;
    const rows = Math.ceil(n / perRow);
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / perRow);
      const inRow = row < rows - 1 ? perRow : n - row * perRow;
      const k = i - row * perRow;
      const sp = Math.min(0.62, 5.6 / Math.max(1, inRow));
      this.members[i].slot.set((k - (inRow - 1) / 2) * sp + (row % 2) * sp * 0.5, 0, 0.85 + row * 0.75);
    }
  }

  private setWeapon(w: WeaponKind): void {
    this.weapon = w;
    for (const m of this.members) m.c.setGun(w, gunModel(w));
    this.ammo = BALANCE.weapons[w].mag;
    this.hud.setWeapon(BALANCE.weapons[w].name);
  }

  private openCrate(c: WeaponCrate): void {
    const order = BALANCE.weaponOrder;
    if (order.indexOf(c.weapon) > order.indexOf(this.weapon)) {
      this.setWeapon(c.weapon);
      this.hud.showBanner(`${BALANCE.weapons[c.weapon].name.toUpperCase()}!`, 'small');
      audio.play('weapon');
      vibrate([40, 40, 40]);
    } else {
      this.addCoins(15);
      this.floatAt(tmp.set(c.x, 2, c.z), '+15 $', 'good');
      audio.play('coin');
    }
  }

  private addCoins(n: number): void {
    this.save.coins += n;
    this.hud.setCoins(this.save.coins);
  }

  // =====================================================================
  // Input
  // =====================================================================
  private bindInput(el: HTMLElement): void {
    el.addEventListener('pointerdown', (e) => {
      audio.unlock();
      if (this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.lastPX = e.clientX;
      this.aimScreen.set(e.clientX, e.clientY);
      this.holding = true;
      if (this.tutorialStep === 1 && this.phase === 'run') this.hud.hint(null);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      const dx = e.clientX - this.lastPX;
      this.lastPX = e.clientX;
      this.aimScreen.set(e.clientX, e.clientY);
      if (this.phase === 'run' || this.phase === 'cleared') {
        this.targetX += (dx / window.innerWidth) * BALANCE.dragMetresPerScreen;
        this.targetX = THREE.MathUtils.clamp(this.targetX, -BALANCE.laneHalf, BALANCE.laneHalf);
      }
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.holding = false;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  private updateAim(): void {
    const f = this.fight!;
    ndc.set((this.aimScreen.x / window.innerWidth) * 2 - 1, -((this.aimScreen.y - BALANCE.aimOffsetPx) / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, this.view.camera);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    const hit = raycast(o, d, this.fightTargets(f), 80, BALANCE.aimAssist);
    let onEnemy = false;
    if (hit) {
      this.aimPoint.copy(hit.point);
      if (hit.target instanceof Bandit) {
        onEnemy = true;
        // snap to the part centre so assisted aim actually lands
        const b = hit.target;
        if (hit.part === 'head') b.c.headCenter(this.aimPoint);
        else this.aimPoint.set(b.c.root.position.x, b.c.root.position.y + 0.85 * b.c.root.scale.y, b.c.root.position.z);
      }
    } else {
      // vertical plane in the enemy zone, or the ground if closer
      const tPlane = (f.coverZ - 14 - o.z) / d.z;
      const tGround = d.y < 0 ? -o.y / d.y : Infinity;
      const t = Math.min(tPlane > 0 ? tPlane : Infinity, tGround);
      this.aimPoint.copy(o).addScaledVector(d, Number.isFinite(t) ? t : 30);
    }
    (this.reticle.material as THREE.MeshBasicMaterial).color.setHex(onEnemy ? 0xff3a2a : 0xffffff);
  }

  private fightTargets(f: FightRT): Hittable[] {
    const out: Hittable[] = [];
    for (const e of f.enemies) if (e.alive) out.push(e);
    for (const c of f.covers) if (c.alive) out.push(c);
    return out;
  }

  // =====================================================================
  // Main update
  // =====================================================================
  update(rawDt: number): void {
    this.time += rawDt;
    // dead eye & slow-mo
    if (this.deadEyeT > 0) {
      this.deadEyeT -= rawDt;
      this.timeScale = BALANCE.deadEyeTimeScale;
      if (this.deadEyeT <= 0) this.timeScale = 1;
    }
    if (this.slowMoT > 0) {
      this.slowMoT -= rawDt;
      this.timeScale = this.slowMoT > 0 ? 0.35 : 1;
    }
    const dt = rawDt * this.timeScale;
    this.phaseT += rawDt;
    if (this.phase === 'run' || this.phase === 'fight' || this.phase === 'cleared') this.levelTime += rawDt;

    switch (this.phase) {
      case 'menu':
      case 'result':
        this.updateIdle(dt);
        break;
      case 'run':
      case 'cleared':
        this.updateRun(dt, rawDt);
        break;
      case 'fight':
        this.updateFight(dt, rawDt);
        break;
      case 'win':
      case 'lose':
        this.updateEnd(dt);
        break;
    }

    // world entities
    for (const g of this.gates) for (const p of g.panels) p.update(dt);
    for (const c of this.crates) if (c.alive) c.update(dt, this.time);
    for (const r of this.riders) r.update(dt, this.posseZ, this.posseX, this.time);
    for (const f of this.fights) {
      if (Math.abs(f.coverZ - this.posseZ) > 70 && f !== this.fight) continue;
      for (const e of f.enemies) e.update(dt, this.time);
      for (const c of f.covers) c.update(dt);
    }
    for (let i = this.dynamites.length - 1; i >= 0; i--) {
      this.dynamites[i].update(dt);
      if (!this.dynamites[i].alive) this.dynamites.splice(i, 1);
    }
    for (const m of this.members) m.c.update(dt);
    this.particles.update(dt);
    this.tracers.update(rawDt);
    this.flashes.update(dt);
    this.updateCamera(rawDt);
    this.updateHud(rawDt);
    this.batcher.sync();
  }

  private moveMembers(dt: number, cx: number, cz: number, rate = 10): void {
    const k = 1 - Math.exp(-dt * rate);
    for (const m of this.members) {
      const p = m.c.root.position;
      p.x += (cx + m.slot.x - p.x) * k;
      p.z += (cz + m.slot.z - p.z) * k;
    }
  }

  private updateIdle(dt: number): void {
    for (const m of this.members) m.c.pose = 'idle';
    this.moveMembers(dt, this.posseX, this.posseZ);
  }

  // =====================================================================
  // Bot (autoplay)
  // =====================================================================
  private botRun(): void {
    const bot = this.autoplay!;
    // steer to the best upcoming gate panel, otherwise to an upcoming crate or rider
    const g = this.gates.find((r) => !r.passed && r.z < this.posseZ && r.z > this.posseZ - 30);
    if (g) {
      let best = g.panels[0];
      const score = (p: GatePanel) => p.apply(Math.max(1, this.members.length)) + (p.op === '+' ? (p.progress / p.hitsNeeded) * bot.greedy : 0);
      for (const p of g.panels) if (score(p) > score(best)) best = p;
      this.targetX = (best.x0 + best.x1) / 2;
      return;
    }
    const c = this.crates.find((k) => k.alive && k.z < this.posseZ && k.z > this.posseZ - 25);
    if (c && Math.random() < bot.greedy) {
      this.targetX = c.x;
      return;
    }
    const r = this.riders.find((k) => k.alive && k.z < this.posseZ && k.z > this.posseZ - 25);
    if (r) this.targetX = r.c.root.position.x;
  }

  private botFight(f: FightRT, dt: number): void {
    const bot = this.autoplay!;
    this.botT -= dt;
    this.botAcquire -= dt;
    // a "!" is noticed only after the reaction time has passed since it appeared
    const danger = f.enemies.some((e) => {
      if (!e.alive || e.state !== 'warn') return false;
      const total = e.isBoss ? BALANCE.bossTelegraph : telegraphFor(this.levelIndex);
      return total - e.timer > bot.react;
    });
    const w = BALANCE.weapons[this.weapon];
    if (danger && Math.random() < bot.duck) {
      this.holding = false;
      this.botT = 0.3;
      return;
    }
    if (this.botT > 0) return;
    if (this.ammo === 0 || (!this.holding && this.ammo < w.mag * 0.5)) {
      this.holding = false;
      this.botT = 0.2;
      return;
    }
    // target: TNT next to enemies, else an exposed enemy (boss last), else chew through the nearest cover
    const exposedE = f.enemies.filter((e) => e.alive && e.exposed);
    let aim: THREE.Vector3 | null = null;
    let target: unknown = null;
    const tnt = f.covers.find((c) => c.alive && c.isTnt && f.enemies.some((e) => e.alive && e.c.root.position.distanceTo(c.pos) < BALANCE.tntRadius));
    if (tnt) {
      aim = tnt.pos.clone().setY(0.45);
      target = tnt;
    } else if (exposedE.length) {
      const keep = exposedE.find((e) => e === this.botTarget);
      const e = keep ?? exposedE.sort((a, b) => (a.isBoss ? 1 : 0) - (b.isBoss ? 1 : 0))[0];
      target = e;
      aim = new THREE.Vector3();
      if (Math.random() < bot.headBias) e.c.headCenter(aim);
      else aim.copy(e.c.root.position).setY(e.c.root.position.y + 0.85 * e.c.root.scale.y);
    } else {
      const e = f.enemies.find((k) => k.alive);
      if (e && e.cover && e.cover.alive) {
        aim = e.cover.pos.clone().setY(e.cover.pos.y + 0.5);
        target = e.cover;
      }
    }
    if (target !== this.botTarget) {
      this.botTarget = target;
      this.botAcquire = bot.react * 0.8;
    }
    if (!aim || this.botAcquire > 0) {
      this.holding = false;
      return;
    }
    aim.x += (Math.random() - 0.5) * bot.aimError;
    aim.y += (Math.random() - 0.5) * bot.aimError;
    this.aimPoint.copy(aim);
    this.holding = true;
    if (this.deadEye >= 1) this.activateDeadEye();
  }

  private updateRun(dt: number, rawDt: number): void {
    if (this.autoplay) this.botRun();
    const cleared = this.phase === 'cleared';
    if (cleared && this.phaseT < 0.9) {
      for (const m of this.members) m.c.pose = 'cheer';
      return;
    }
    if (cleared) {
      this.phase = 'run';
      this.layoutRun();
    }
    this.posseZ -= BALANCE.runSpeed * dt;
    const ks = 1 - Math.exp(-dt * BALANCE.steerSmoothing);
    this.posseX += (this.targetX - this.posseX) * ks;
    this.moveMembers(dt, this.posseX, this.posseZ, 14);
    for (const m of this.members) {
      m.c.pose = 'run';
      m.c.root.rotation.y = Math.PI;
    }

    // auto fire straight ahead
    const w = BALANCE.weapons[this.weapon];
    let tracerBudget = BALANCE.maxVisibleTracers;
    const targets: Hittable[] = [];
    for (const g of this.gates) if (!g.passed && g.z < this.posseZ + 1 && g.z > this.posseZ - w.runRange) targets.push(...g.panels);
    for (const c of this.crates) if (c.alive && c.z < this.posseZ && c.z > this.posseZ - w.runRange) targets.push(c);
    for (const r of this.riders) if (r.alive && r.z < this.posseZ && r.z > this.posseZ - w.runRange) targets.push(r);
    const dir = new THREE.Vector3();
    for (const m of this.members) {
      m.fireT -= rawDt * this.rateMul;
      if (m.fireT > 0) continue;
      m.fireT = w.interval * (0.9 + Math.random() * 0.2);
      if (!targets.length) continue;
      const o = tmp.set(m.c.root.position.x, 1.25, m.c.root.position.z - 0.3);
      dir.set((Math.random() - 0.5) * 0.02, 0, -1).normalize();
      const hit = raycast(o, dir, targets, w.runRange);
      if (!hit) continue;
      m.c.fire();
      if (tracerBudget-- > 0) {
        m.c.getMuzzleWorld(tmp2);
        this.tracers.fire(tmp2, hit.point);
        this.flashes.spawn(tmp2, 0.3, 0.04);
        audio.play(this.weapon === 'dynamite' ? 'revolver' : this.weapon, this.weapon === 'gatling' ? 0.05 : 0.07);
      }
      const t = hit.target;
      if (t instanceof GatePanel) t.hit();
      else if (t instanceof WeaponCrate) t.hit();
      else if (t instanceof Rider) {
        const dmg = w.damage * this.dmgMul * (hit.part === 'head' ? BALANCE.headshotMultiplier : 1);
        if (t.damage(dmg, hit.part === 'head')) this.floatAt(t.c.root.position.clone().setY(2), 'BANG!', 'head');
        else audio.play('hit');
      }
    }

    // gates
    for (const g of this.gates) {
      if (g.passed || this.posseZ > g.z) continue;
      g.passed = true;
      const panel = g.panelAt(this.posseX);
      const before = this.members.length;
      const after = THREE.MathUtils.clamp(panel.apply(before), 0, BALANCE.maxPosse);
      const delta = after - before;
      if (delta > 0) {
        for (let i = 0; i < delta; i++) this.addMember();
        audio.play('gateGood');
        vibrate(30);
      } else if (delta < 0) {
        for (let i = 0; i < -delta && this.members.length; i++) this.killMember();
        audio.play('gateBad');
      }
      this.floatAt(tmp.set(this.posseX, 2.6, this.posseZ), panel.text(), panel.good ? 'good' : 'bad');
      this.peak = Math.max(this.peak, this.members.length);
      this.layoutRun();
      for (const p of g.panels) {
        p.alive = false;
        (p.banner.material as THREE.MeshBasicMaterial).opacity = 0.15;
      }
      if (this.phase !== 'run') return;
    }

    // riders reaching the posse
    for (const r of this.riders) {
      if (!r.alive || this.posseZ > r.z + 0.6) continue;
      if (Math.abs(r.c.root.position.x - this.posseX) < 1.8) {
        r.kill();
        this.killMember();
        if (this.phase !== 'run') return;
      } else {
        r.alive = false;
        this.root.remove(r.c.root);
        r.c.dispose();
      }
    }

    // arrive at a fight
    const next = this.fights.find((f) => !f.done);
    if (next && this.posseZ <= next.stopZ) this.startFight(next);
  }

  private startFight(f: FightRT): void {
    this.phase = 'fight';
    this.phaseT = 0;
    this.fight = f;
    f.started = true;
    this.posseZ = f.coverZ;
    this.posseX = this.targetX = 0;
    this.layoutFight();
    this.reloadT = 0;
    this.fireT = 0;
    f.enemies.forEach((e, i) => e.activate(BALANCE.enemyFirstDelay + i * 0.45 + Math.random() * 0.6));
    this.hud.show('ammo', true);
    this.hud.show('deadeye', true);
    if (f.boss) {
      this.hud.show('boss', true);
      this.hud.showBanner('ŠÉF BANDY!', 'bad', 1.4);
    }
    if (!this.save.tutorialDone || this.levelIndex === 0) {
      this.hud.hint('DRŽ PRST = vykloň sa a strieľaj<br>PUSŤ = kryt a nabíjanie');
      this.tutorialStep = 2;
    }
    Ads.gameplayStart();
  }

  private updateFight(dt: number, rawDt: number): void {
    const f = this.fight!;
    this.moveMembers(dt, 0, f.coverZ, 8);
    const w = BALANCE.weapons[this.weapon];
    if (this.autoplay) this.botFight(f, rawDt);
    const exposed = this.holding;

    if (exposed) {
      if (!this.autoplay) this.updateAim();
      if (this.tutorialStep === 2 && this.phaseT > 0.5) {
        this.tutorialStep = 3;
        this.hud.hint(null);
        this.save.tutorialDone = true;
        writeSave(this.save);
      }
    } else {
      // reload while crouched
      if (this.ammo < w.mag) {
        this.reloadT += rawDt * this.reloadMul;
        const per = BALANCE.reloadPerRound * (this.weapon === 'gatling' ? 0.15 : this.weapon === 'dynamite' ? 2.5 : 1);
        while (this.reloadT >= per && this.ammo < w.mag) {
          this.reloadT -= per;
          this.ammo++;
          audio.play('reload', 0.06);
        }
      } else this.reloadT = 0;
    }

    // members pose + aim
    const shooting = exposed && this.ammo > 0;
    for (const m of this.members) {
      const c = m.c;
      if (exposed) {
        c.pose = this.weapon === 'dynamite' ? 'throw' : 'aim';
        const dx = this.aimPoint.x - c.root.position.x;
        const dz = this.aimPoint.z - c.root.position.z;
        c.root.rotation.y = Math.atan2(dx, dz);
        c.aimPitch = Math.atan2(this.aimPoint.y - 1.45, Math.hypot(dx, dz));
      } else {
        c.pose = this.ammo < w.mag ? 'reload' : 'crouch';
        c.root.rotation.y = Math.PI;
      }
    }

    // fire
    this.fireT -= rawDt * this.rateMul;
    if (exposed && this.fireT <= 0) {
      if (this.ammo > 0) {
        this.volley();
        this.ammo--;
        this.fireT = w.interval;
      } else {
        audio.play('empty', 0.3);
        this.fireT = 0.3;
      }
    }
    this.aimLine.visible = this.reticle.visible = exposed;
    if (exposed) {
      tmp.set(0, 1.45, f.coverZ + 0.9);
      const len = tmp.distanceTo(this.aimPoint);
      this.aimLine.position.copy(tmp);
      this.aimLine.lookAt(this.aimPoint);
      this.aimLine.scale.set(0.035, 0.035, len);
      this.reticle.position.copy(this.aimPoint);
      this.reticle.lookAt(this.view.camera.position);
      this.reticle.scale.setScalar(shooting ? 1 : 1.3);
    }

    // done?
    if (f.enemies.every((e) => !e.alive)) {
      this.aimLine.visible = this.reticle.visible = false;
      f.done = true;
      this.fight = null;
      this.hud.show('ammo', false);
      this.hud.show('deadeye', false);
      this.deadEyeT = 0;
      this.timeScale = 1;
      if (f.boss) {
        this.win();
        return;
      }
      this.phase = 'cleared';
      this.phaseT = 0;
      this.hud.showBanner('ČISTO!', '', 1.0);
      audio.play('coin');
      // kick the barricade over
      f.playerCover.destroy();
      this.ammo = w.mag;
      this.hud.hint(null);
    }
  }

  private volley(): void {
    const w = BALANCE.weapons[this.weapon];
    const f = this.fight!;
    const targets = this.fightTargets(f);
    const n = this.members.length;
    if (this.weapon === 'dynamite') {
      const throwers = Math.min(BALANCE.dynamiteThrowers, n);
      for (let i = 0; i < throwers; i++) {
        const m = this.members[i];
        m.c.fire();
        m.c.getMuzzleWorld(tmp2);
        const to = this.aimPoint.clone();
        to.x += (Math.random() - 0.5) * 0.8;
        to.z += (Math.random() - 0.5) * 0.8;
        to.y = Math.max(0, to.y - 0.3);
        const dmg = w.damage * this.dmgMul * (1 + 0.12 * n);
        this.dynamites.push(new Dynamite(this.ctx, tmp2.clone(), to, 0.55 + i * 0.05, true, dmg, BALANCE.dynamiteRadius));
      }
      audio.play('throw');
      return;
    }
    let tracerBudget = BALANCE.maxVisibleTracers;
    const dir = new THREE.Vector3();
    let anyHit = false;
    for (const m of this.members) {
      m.c.fire();
      m.c.getMuzzleWorld(tmp2);
      const origin = tmp2.clone();
      for (let p = 0; p < w.pellets; p++) {
        dir.copy(this.aimPoint).sub(origin).normalize();
        dir.x += (Math.random() - 0.5) * w.spread * 2;
        dir.y += (Math.random() - 0.5) * w.spread * 2;
        dir.normalize();
        const hit = raycast(origin, dir, targets, 90);
        const end = hit ? hit.point : origin.clone().addScaledVector(dir, 40);
        if (tracerBudget > 0 && (p === 0 || Math.random() < 0.3)) {
          tracerBudget--;
          this.tracers.fire(origin, end);
        }
        if (hit) anyHit = this.applyHit(hit, w.damage * this.dmgMul) || anyHit;
      }
      if (tracerBudget >= 0) this.flashes.spawn(origin, 0.4, 0.05);
    }
    audio.play(this.weapon, this.weapon === 'gatling' ? 0.05 : 0.04);
    void anyHit;
  }

  private applyHit(hit: RayHit, dmg: number): boolean {
    const t = hit.target;
    if (t instanceof Bandit) {
      const head = hit.part === 'head';
      const d = dmg * (head ? BALANCE.headshotMultiplier : 1);
      const killed = t.damage(d, head);
      this.deadEye = Math.min(1, this.deadEye + (head ? 2 : 1) / BALANCE.deadEyeCharge);
      if (head) {
        this.floatAt(hit.point, killed ? 'HEADSHOT!' : `${fmt(d)}`, 'head');
        audio.play('headshot', 0.08);
      } else {
        if (Math.random() < 0.5) this.floatAt(hit.point, fmt(d), 'dmg');
        audio.play('hit', 0.05);
      }
      if (t.isBoss) this.hud.setBoss(t.hp / t.maxHp);
      if (killed && t.isBoss) vibrate([80, 40, 120]);
      return true;
    }
    if (t instanceof CoverProp) {
      t.damage(dmg, hit.point);
      return true;
    }
    return false;
  }

  // =====================================================================
  // Enemy attacks & explosions
  // =====================================================================
  private enemyFired(from: THREE.Vector3, power: number): void {
    if (this.phase === 'win' || this.phase === 'lose' || this.phase === 'result') return;
    const f = this.fight;
    if (power < 0) {
      // dynamite thrown at our cover
      if (!f) return;
      const to = new THREE.Vector3((Math.random() - 0.5) * 3, 0.2, f.coverZ + 0.2);
      this.dynamites.push(new Dynamite(this.ctx, from.clone(), to, 1.0, false, 0, 2));
      audio.play('throw');
      return;
    }
    audio.play('enemyShot', 0.04);
    if (!f) {
      // run phase: no cover
      const victim = this.members[Math.floor(Math.random() * this.members.length)];
      if (!victim) return;
      tmp.copy(victim.c.root.position).setY(1.2);
      if (Math.random() < 0.65) {
        this.tracers.fire(from, tmp, 0xffb060);
        this.killMember(victim);
      } else {
        tmp.x += (Math.random() - 0.5) * 2;
        tmp.y = 0.05;
        this.tracers.fire(from, tmp, 0xffb060);
        this.particles.dust(tmp, 4);
      }
      return;
    }
    const cover = f.playerCover;
    const exposed = this.holding;
    if (exposed || !cover.alive) {
      const acc = exposed ? BALANCE.enemyAccuracy : BALANCE.enemyAccuracy * 0.6;
      const victim = this.members[Math.floor(Math.random() * this.members.length)];
      if (victim && Math.random() < acc) {
        tmp.copy(victim.c.root.position).setY(exposed ? 1.4 : 0.8);
        this.tracers.fire(from, tmp, 0xffb060);
        this.killMember(victim);
      } else {
        tmp.set((Math.random() - 0.5) * 6, 0.05, f.coverZ + 1 + Math.random() * 2);
        this.tracers.fire(from, tmp, 0xffb060);
        this.particles.dust(tmp, 4);
      }
    } else {
      tmp.set((Math.random() - 0.5) * 5, 0.6 + Math.random() * 0.4, f.coverZ - 0.2);
      this.tracers.fire(from, tmp, 0xffb060);
      cover.damage(BALANCE.enemyCoverDamage, tmp);
      this.particles.dust(tmp, 3, 0xd8c8a0, 0.2);
      if (!cover.alive) {
        this.hud.showBanner('KRYT JE PREČ!', 'bad small', 1.2);
        vibrate(100);
      }
    }
  }

  private explode(p: THREE.Vector3, radius: number, damage: number, byPlayer: boolean): void {
    this.flashes.spawn(p, radius * 1.4, 0.35, radius * 2);
    for (let k = 0; k < 24; k++) this.particles.dust(p, 1, k % 3 ? 0x6a6058 : 0xe8a040, radius * 0.6);
    this.view.shake(byPlayer ? 0.4 : 0.6, 0.35);
    audio.play('explode', 0.05);
    vibrate(byPlayer ? 50 : 120);
    if (byPlayer) {
      for (const f of this.fights) {
        if (Math.abs(f.coverZ - p.z) > 40) continue;
        for (const e of f.enemies) {
          if (!e.alive) continue;
          const d = tmp.copy(e.c.root.position).setY(e.c.root.position.y + 0.8).distanceTo(p);
          if (d < radius) {
            const dmg = damage * (1 - (d / radius) * 0.5);
            const killed = e.damage(dmg, false);
            this.floatAt(tmp, killed ? 'BUM!' : fmt(dmg), 'head');
            if (e.isBoss) this.hud.setBoss(e.hp / e.maxHp);
          }
        }
        for (const c of f.covers) {
          if (!c.alive) continue;
          const d = tmp.copy(c.pos).setY(c.pos.y + 0.5).distanceTo(p);
          if (d < radius) c.damage(c.isTnt ? 99 : damage * 0.6);
        }
      }
      return;
    }
    // enemy dynamite at our position
    const f = this.fight;
    if (!f) return;
    if (this.holding) {
      this.killMember();
      if (this.members.length) this.killMember();
    } else if (f.playerCover.alive) {
      f.playerCover.damage(12, p);
      if (!f.playerCover.alive) this.hud.showBanner('KRYT JE PREČ!', 'bad small', 1.2);
    } else this.killMember();
  }

  // =====================================================================
  // Dead Eye
  // =====================================================================
  private activateDeadEye(): void {
    if (this.phase !== 'fight' || this.deadEye < 1 || this.deadEyeT > 0) return;
    this.deadEye = 0;
    this.deadEyeT = BALANCE.deadEyeDuration;
    audio.play('deadeye');
    vibrate(40);
    this.hud.showBanner('DEAD EYE', 'small', 1.0);
  }

  // =====================================================================
  // End of level
  // =====================================================================
  private win(): void {
    this.phase = 'win';
    this.phaseT = 0;
    this.slowMoT = 1.4;
    this.hud.show('boss', false);
    // remaining bandits flee in a puff
    for (const f of this.fights) for (const e of f.enemies) if (e.alive) e.kill(5);
    this.hud.showBanner('VÝHRA!', '', 2.2);
    audio.play('win');
    vibrate([60, 60, 120]);
    Ads.gameplayStop();
  }

  private lose(): void {
    if (this.phase === 'lose') return;
    this.phase = 'lose';
    this.phaseT = 0;
    this.holding = false;
    this.aimLine.visible = this.reticle.visible = false;
    this.hud.show('ammo', false);
    this.hud.show('deadeye', false);
    this.hud.show('boss', false);
    this.hud.hint(null);
    this.hud.showBanner('PREHRA', 'bad', 2.0);
    audio.play('lose');
    vibrate(300);
    Ads.gameplayStop();
  }

  private updateEnd(dt: number): void {
    if (this.phase === 'win') {
      for (const m of this.members) {
        m.c.pose = 'cheer';
        m.c.root.rotation.y = Math.PI;
      }
      this.aimLine.visible = this.reticle.visible = false;
      if (this.phaseT > 2.2) this.showResult(true);
    } else if (this.phaseT > 1.8) this.showResult(false);
  }

  private stars(): number {
    let s = 1;
    if (this.members.length >= Math.ceil(this.peak * BALANCE.starSurvivorShare)) s++;
    if (this.levelTime <= this.level.par) s++;
    return s;
  }

  private showResult(won: boolean): void {
    this.phase = 'result';
    if (this.onResult) {
      const st = won ? this.stars() : 0;
      const coins = won
        ? this.members.length * BALANCE.coinsPerSurvivor + st * BALANCE.coinsPerStar + (this.levelIndex + 1) * BALANCE.coinsPerLevel
        : Math.floor(this.progressFrac() * BALANCE.loseCoinsProgress) + this.kills * BALANCE.loseCoinsPerKill;
      this.onResult({ won, level: this.levelIndex, survivors: this.members.length, peak: this.peak, time: this.levelTime, stars: st, coins, progress: this.progressFrac(), lost: this.lost });
      return;
    }
    this.hud.show('posse', false);
    this.hud.show('weapon', false);
    if (won) {
      const st = this.stars();
      const survivors = this.members.length;
      const coins = survivors * BALANCE.coinsPerSurvivor + st * BALANCE.coinsPerStar + (this.levelIndex + 1) * BALANCE.coinsPerLevel;
      const prevStars = this.save.stars[this.levelIndex] ?? 0;
      this.save.stars[this.levelIndex] = Math.max(prevStars, st);
      this.save.level = Math.max(this.save.level, this.levelIndex + 1);
      this.addCoins(coins);
      writeSave(this.save);
      const starHtml = [0, 1, 2].map((i) => `<span class="${i < st ? 'on' : 'off'}">★</span>`).join('');
      const buttons = [
        { label: 'ĎALŠÍ LEVEL ▶', onClick: () => this.nextLevel() },
        { label: 'OBCHOD', cls: 'alt', onClick: () => this.showShop(true) },
      ];
      if (Ads.available)
        buttons.splice(1, 0, {
          label: '2× MINCE (reklama)',
          cls: 'gold',
          onClick: async () => {
            if (await Ads.rewarded()) {
              this.addCoins(coins);
              writeSave(this.save);
            }
          },
        });
      this.hud.openScreen(
        `<h1>VÝHRA!</h1><div class="stars">${starHtml}</div>
         <p>Preživší: <b>${survivors}</b> · Čas: <b>${Math.round(this.levelTime)} s</b></p>
         <p class="sub">★ výhra · ★ aspoň ${Math.round(BALANCE.starSurvivorShare * 100)} % skupiny prežije · ★ do ${this.level.par} s</p>
         <p class="coinline">+${coins} $</p>`,
        buttons,
      );
    } else {
      const progress = this.progressFrac();
      const coins = Math.floor(progress * BALANCE.loseCoinsProgress) + this.kills * BALANCE.loseCoinsPerKill;
      this.addCoins(coins);
      writeSave(this.save);
      this.hud.openScreen(
        `<h1>PREHRA</h1><p>Bandy ťa dostali na ${Math.round(progress * 100)} % cesty.</p>
         <p class="coinline">+${coins} $</p>
         <p class="sub">Tip: skry sa, keď nad banditom blikne „!“. Vylepšenia v obchode pomáhajú.</p>`,
        [
          { label: 'SKÚSIŤ ZNOVA', onClick: () => this.restart() },
          { label: 'OBCHOD', cls: 'alt', onClick: () => this.showShop(false) },
        ],
      );
    }
  }

  private progressFrac(): number {
    return THREE.MathUtils.clamp((this.startZ - this.posseZ) / (this.startZ - this.endZ), 0, 1);
  }

  nextLevel(): void {
    Ads.interstitial().then(() => {
      this.hud.closeScreen();
      this.loadLevel(this.save.level);
      this.begin();
    });
  }

  restart(): void {
    this.hud.closeScreen();
    this.loadLevel(this.levelIndex);
    this.begin();
  }

  jumpTo(index: number): void {
    this.hud.closeScreen();
    this.loadLevel(index);
    this.begin();
  }

  begin(): void {
    this.hud.closeScreen();
    this.phase = 'run';
    this.phaseT = 0;
    this.hud.show('top', true);
    this.hud.show('posse', true);
    this.hud.show('weapon', true);
    if (this.levelIndex === 0 && !this.save.tutorialDone) {
      this.hud.hint('ŤAHAJ PRSTOM doľava / doprava');
      this.tutorialStep = 1;
    } else this.tutorialStep = 0;
    Ads.gameplayStart();
  }

  // =====================================================================
  // Menu & shop
  // =====================================================================
  showMenu(): void {
    this.phase = 'menu';
    this.hud.show('top', false);
    this.hud.show('posse', false);
    this.hud.show('weapon', false);
    const lvl = this.save.level;
    const totalStars = Object.values(this.save.stars).reduce((a, b) => a + b, 0);
    this.hud.openScreen(
      `<h1 class="title-big">DUSTY<br>GULCH</h1>
       <p class="sub">Vyčisti mesto od bandy</p>
       <p>Level <b>${lvl + 1}</b> · ★ ${totalStars} · <b>${this.save.coins} $</b></p>`,
      [
        { label: `HRAŤ ▶`, onClick: () => this.begin() },
        { label: 'OBCHOD', cls: 'alt', onClick: () => this.showShop(false) },
        {
          label: this.save.sound ? '🔊 Zvuk: zapnutý' : '🔈 Zvuk: vypnutý',
          cls: 'alt',
          onClick: () => {
            this.save.sound = !this.save.sound;
            audio.enabled = this.save.sound;
            writeSave(this.save);
            this.showMenu();
          },
        },
      ],
      'clear',
    );
  }

  showShop(fromWin: boolean): void {
    const keys = Object.keys(BALANCE.upgrades) as UpgradeKey[];
    const rows = keys
      .map((k) => {
        const u = BALANCE.upgrades[k];
        const lv = this.save.upg[k];
        const maxed = lv >= u.max;
        const cost = upgradeCost(k, lv);
        const pips = '●'.repeat(lv) + '○'.repeat(u.max - lv);
        const extra = k === 'weapon' ? ` (${BALANCE.weapons[BALANCE.weaponOrder[Math.min(2, lv + (maxed ? 0 : 1))]].name})` : '';
        return `<div class="shoprow"><div class="info"><b>${u.name}${maxed ? '' : extra}</b><small>${u.desc}</small><div class="pips">${pips}</div></div>
          <button class="btn ${maxed ? 'alt' : 'gold'}" data-k="${k}" ${maxed || cost > this.save.coins ? 'disabled' : ''}>${maxed ? 'MAX' : cost + ' $'}</button></div>`;
      })
      .join('');
    const el = this.hud.openScreen(`<h2>OBCHOD</h2><p class="coinline">${this.save.coins} $</p>${rows}`, [
      { label: fromWin || this.phase === 'result' ? 'HRAŤ ĎALEJ ▶' : 'SPÄŤ', onClick: () => (this.phase === 'result' ? (fromWin ? this.nextLevel() : this.restart()) : this.showMenu()) },
    ]);
    el.querySelectorAll<HTMLButtonElement>('button[data-k]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const k = b.dataset.k as UpgradeKey;
        const cost = upgradeCost(k, this.save.upg[k]);
        if (this.save.coins < cost || this.save.upg[k] >= BALANCE.upgrades[k].max) return;
        this.save.coins -= cost;
        this.save.upg[k]++;
        writeSave(this.save);
        audio.unlock();
        audio.play('coin');
        this.hud.setCoins(this.save.coins);
        // reflect upgrades on the waiting level (start size / weapon)
        if (this.phase === 'menu') this.loadLevel(this.levelIndex);
        this.showShop(fromWin);
      }),
    );
  }

  // =====================================================================
  // Camera & HUD
  // =====================================================================
  private updateCamera(dt: number): void {
    let pos: THREE.Vector3, look: THREE.Vector3, hf: number;
    const f = this.fight;
    if (this.phase === 'menu') {
      const a = Math.sin(this.time * 0.25) * 0.5;
      pos = tmp.set(Math.sin(a) * 7, 4.2, this.posseZ + Math.cos(a) * 7);
      look = tmp2.set(0, 1.2, this.posseZ - 2);
      hf = 60;
    } else if (f || (this.phase === 'win' && this.fights.length)) {
      const cz = f ? f.coverZ : this.fights[this.fights.length - 1].coverZ;
      pos = tmp.set(0, 6.4, cz + 7.6);
      look = tmp2.set(0, 0.9, cz - 12);
      hf = 32;
    } else {
      pos = tmp.set(this.posseX * 0.55, 8.5, this.posseZ + 6.5);
      look = tmp2.set(this.posseX * 0.35, 0, this.posseZ - 8);
      hf = 58;
    }
    const k = 1 - Math.exp(-dt * (this.phase === 'run' ? 8 : 3.5));
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    this.hfov += (hf - this.hfov) * k;
    if (Math.abs(this.view.hfov - this.hfov) > 0.05) {
      this.view.hfov = this.hfov;
      this.view.resize();
    }
    this.view.updateShake(dt);
    this.view.camera.position.copy(this.camPos).add(this.view.shakeOffset);
    this.view.camera.lookAt(this.camLook);
    this.backdrop.position.z = this.camPos.z;
    this.ctx.possePos.set(this.posseX, 1, this.posseZ);
  }

  private updateHud(dt: number): void {
    this.hud.update(dt);
    if (this.phase === 'menu' || this.phase === 'result') return;
    this.hud.setProgress(this.progressFrac());
    // posse counter above the group
    const f = this.fight;
    if (f) this.hud.setPosse(this.members.length, 44, window.innerHeight - 72);
    else {
      tmp.set(this.posseX, 2.3, this.posseZ).project(this.view.camera);
      this.hud.setPosse(this.members.length, ((tmp.x + 1) / 2) * window.innerWidth, ((1 - tmp.y) / 2) * window.innerHeight);
    }
    if (f) {
      this.hud.setAmmo(this.ammo, BALANCE.weapons[this.weapon].mag, !this.holding);
      this.hud.setDeadEye(this.deadEye, this.deadEyeT > 0);
      if (f.bossUnit) this.hud.setBoss(f.bossUnit.hp / f.bossUnit.maxHp);
    }
  }

  floatAt(p: THREE.Vector3, text: string, cls = ''): void {
    tmp2.copy(p).project(this.view.camera);
    if (tmp2.z > 1) return;
    this.hud.float(text, ((tmp2.x + 1) / 2) * window.innerWidth, ((1 - tmp2.y) / 2) * window.innerHeight, cls);
  }

  get levelCount(): number {
    return LEVELS.length;
  }
}

function fmt(n: number): string {
  return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

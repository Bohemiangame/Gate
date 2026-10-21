import * as THREE from 'three';
import { Character } from '../gfx/character';
import { makeCharacter } from '../gfx/models';
import { Label } from '../gfx/label';
import type { WeaponKind } from '../gfx/characterModels';
import type { CoverSlot } from './map';
import { TB } from './tbalance';

export type Side = 'player' | 'enemy';
/** S = sheriff, A/B = posse squads, E = bandits. */
export type GroupId = 'S' | 'A' | 'B' | 'E';
export type UnitState = 'cover' | 'warn' | 'peek' | 'reload';

let nextId = 1;

export class Unit {
  readonly id = nextId++;
  readonly c: Character;
  alive = true;
  hp: number;
  readonly maxHp: number;
  mag: number;
  reserve: number;
  slot: CoverSlot | null = null;
  path: THREE.Vector3[] = [];
  /** fire = shoot at will, hold = stay down. */
  stance: 'fire' | 'hold' = 'fire';
  state: UnitState = 'cover';
  timer = Math.random();
  shotsLeft = 0;
  fireT = 0;
  reloadT = 0;
  target: Unit | null = null;
  targetT = 0;
  /** AI: time until the bandit looks for a better cover. */
  repoT = 3 + Math.random() * 4;
  /** AI: time spent in the current cover. */
  stayT = 0;
  /** AI: this bandit is rushing forward. */
  rush = false;
  warn: Label | null = null;
  readonly facing = new THREE.Vector3(0, 0, -1);

  constructor(
    readonly side: Side,
    readonly group: GroupId,
    public weapon: WeaponKind,
    variant: number,
    hp: number,
    reserve: number,
  ) {
    const faction = group === 'S' ? 'sheriff' : group === 'A' ? 'posse' : group === 'B' ? 'posseB' : 'bandit';
    this.c = makeCharacter(faction, variant, weapon);
    this.hp = this.maxHp = hp;
    this.mag = TB.weapons[weapon].mag;
    this.reserve = reserve;
    if (side === 'enemy') {
      this.warn = new Label('!', 0.9, { color: '#ffdd33', stroke: '#8a0000' });
      this.warn.sprite.visible = false;
    }
  }

  get pos(): THREE.Vector3 {
    return this.c.root.position;
  }
  get w() {
    return TB.weapons[this.weapon];
  }
  get moving(): boolean {
    return this.path.length > 0;
  }
  /** Standing up (aiming/shooting) or caught in the open. */
  get exposed(): boolean {
    return this.moving || this.state === 'peek' || this.state === 'warn' || !this.inCover;
  }
  /** At a cover slot whose cover still stands. */
  get inCover(): boolean {
    return !!this.slot && this.slot.cover.alive && this.pos.distanceTo(this.slot.pos) < 0.35;
  }
  /** Is this unit protected against a shot from `from` right now? */
  protectedFrom(from: THREE.Vector3): boolean {
    return this.inCover && !this.moving && this.slot!.protects(from);
  }

  leaveSlot(): void {
    if (this.slot) {
      if (this.slot.occupant === this) this.slot.occupant = null;
      if (this.slot.reserved === this) this.slot.reserved = null;
    }
    this.slot = null;
  }

  /** Walk to `slot` (or a free spot) along `path`. */
  goTo(path: THREE.Vector3[], slot: CoverSlot | null): void {
    this.leaveSlot();
    this.slot = slot;
    if (slot) slot.reserved = this;
    this.path = path;
    this.state = 'cover';
  }
}

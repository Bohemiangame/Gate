import * as THREE from 'three';
import { CharacterModel, GunModel, VS, WeaponKind } from './characterModels';

export type Pose = 'idle' | 'run' | 'aim' | 'crouch' | 'reload' | 'cheer' | 'throw';

export const shadowGeo = new THREE.CircleGeometry(0.32, 12).rotateX(-Math.PI / 2);

/**
 * A body part: only a transform + the geometry to draw. Parts are not drawn one by one;
 * `CharacterBatcher` draws all parts sharing a geometry with one InstancedMesh.
 */
export class Part extends THREE.Object3D {
  constructor(public geometry: THREE.BufferGeometry) {
    super();
  }
}

/** Every live character (for the batcher). */
export const characters = new Set<Character>();

interface Joints {
  bodyY: number;
  lean: number;
  head: number;
  armLx: number;
  armLz: number;
  armRx: number;
  armRz: number;
  thighL: number;
  thighR: number;
  shinL: number;
  shinR: number;
}

const ZERO: Joints = { bodyY: 0, lean: 0, head: 0, armLx: 0, armLz: 0, armRx: 0, armRz: 0, thighL: 0, thighR: 0, shinL: 0, shinR: 0 };

/**
 * A procedurally animated voxel character. Facing +Z in local space.
 * Animation = per-joint target pose blended with exponential smoothing.
 */
export class Character {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly torso: Part;
  readonly head: Part;
  readonly armL: Part;
  readonly armR: Part;
  readonly thighL: Part;
  readonly thighR: Part;
  readonly shinL: Part;
  readonly shinR: Part;
  gun: Part;
  readonly muzzle = new THREE.Object3D();
  readonly shadow: Part;
  readonly parts: Part[];

  pose: Pose = 'idle';
  /** Elevation of the aim in radians (positive = up). */
  aimPitch = 0;
  runSpeed = 1;
  private phase = Math.random() * 10;
  private j: Joints = { ...ZERO };
  private recoil = 0;
  flashT = 0;
  private t = Math.random() * 10;

  constructor(
    readonly model: CharacterModel,
    gun: GunModel,
    public weapon: WeaponKind,
  ) {
    const m = (g: THREE.BufferGeometry) => new Part(g);
    this.torso = m(model.torso);
    this.head = m(model.head);
    this.armL = m(model.armL);
    this.armR = m(model.armR);
    this.thighL = m(model.thigh);
    this.thighR = m(model.thigh);
    this.shinL = m(model.shin);
    this.shinR = m(model.shin);
    this.gun = m(gun.geo);

    this.root.add(this.body);
    this.body.add(this.torso, this.thighL, this.thighR);
    this.torso.position.set(0, 12 * VS, 0);
    this.head.position.set(0, 9 * VS, 0);
    this.armL.position.set(5 * VS, 9 * VS - VS * 0.5, 0);
    this.armR.position.set(-5 * VS, 9 * VS - VS * 0.5, 0);
    this.torso.add(this.head, this.armL, this.armR);
    // Character's left leg is on +X.
    this.thighL.position.set(2 * VS, 12 * VS, 0);
    this.thighR.position.set(-2 * VS, 12 * VS, 0);
    this.shinL.position.set(0, -6 * VS, 0);
    this.shinR.position.set(0, -6 * VS, 0);
    this.thighL.add(this.shinL);
    this.thighR.add(this.shinR);

    this.armR.add(this.gun);
    this.gun.position.set(0, -8 * VS, 0);
    this.gun.rotation.x = Math.PI / 2;
    this.gun.add(this.muzzle);
    this.muzzle.position.copy(gun.muzzle);

    this.shadow = new Part(shadowGeo);
    this.shadow.position.y = 0.02;
    this.root.add(this.shadow);

    this.parts = [this.torso, this.head, this.armL, this.armR, this.thighL, this.thighR, this.shinL, this.shinR, this.gun];
    characters.add(this);
  }

  /** Stop drawing this character for good (dead / level unloaded). */
  dispose(): void {
    characters.delete(this);
  }

  setGun(kind: WeaponKind, gun: GunModel): void {
    this.weapon = kind;
    this.gun.geometry = gun.geo;
    this.muzzle.position.copy(gun.muzzle);
  }

  fire(): void {
    this.recoil = this.weapon === 'gatling' ? 0.12 : this.weapon === 'shotgun' ? 0.55 : 0.35;
  }

  flash(): void {
    this.flashT = 0.07;
  }

  getMuzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.muzzle.getWorldPosition(out);
  }

  /** World-space head centre (for headshot hit boxes). */
  headCenter(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 3 * VS, 0);
    return this.head.localToWorld(out);
  }

  update(dt: number): void {
    this.t += dt;
    if (this.flashT > 0) this.flashT -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 3.5);

    const tgt: Joints = { ...ZERO };
    const breathe = Math.sin(this.t * 2.2) * 0.02;
    switch (this.pose) {
      case 'idle':
        tgt.lean = 0.03 + breathe;
        tgt.armLx = 0.05;
        tgt.armRx = -0.35;
        tgt.armLz = 0.08;
        tgt.armRz = -0.08;
        break;
      case 'run': {
        this.phase += dt * 11 * this.runSpeed;
        const a = Math.sin(this.phase);
        tgt.bodyY = Math.abs(Math.cos(this.phase)) * 0.06 - 0.02;
        tgt.lean = 0.18;
        tgt.thighL = -a * 0.85;
        tgt.thighR = a * 0.85;
        tgt.shinL = 0.25 + Math.max(0, Math.sin(this.phase - 1.3)) * 1.3;
        tgt.shinR = 0.25 + Math.max(0, Math.sin(this.phase + Math.PI - 1.3)) * 1.3;
        tgt.armLx = a * 0.8;
        tgt.armRx = -0.9 - a * 0.25;
        tgt.armLz = 0.1;
        tgt.armRz = -0.1;
        tgt.head = -0.1;
        break;
      }
      case 'aim':
        tgt.lean = -0.02;
        tgt.armRx = -Math.PI / 2 - this.aimPitch - this.recoil;
        tgt.armRz = 0.12;
        tgt.armLx = -Math.PI / 2 - this.aimPitch * 0.8 + 0.25 - this.recoil * 0.5;
        tgt.armLz = -0.55;
        tgt.head = -this.aimPitch * 0.5;
        tgt.thighL = -0.25;
        tgt.thighR = 0.15;
        tgt.shinL = 0.2;
        tgt.shinR = 0.1;
        tgt.bodyY = -0.02;
        break;
      case 'crouch':
      case 'reload': {
        tgt.bodyY = -0.31;
        tgt.lean = 0.28;
        tgt.thighL = -1.45;
        tgt.shinL = 1.45;
        tgt.thighR = -0.2;
        tgt.shinR = 1.6;
        tgt.head = -0.15;
        if (this.pose === 'reload') {
          const jig = Math.sin(this.t * 22) * 0.12;
          tgt.armRx = -1.2 + jig;
          tgt.armRz = 0.45;
          tgt.armLx = -1.0 - jig;
          tgt.armLz = -0.5;
          tgt.head = 0.35;
        } else {
          tgt.armRx = -0.75 + breathe;
          tgt.armLx = -0.4;
          tgt.armLz = 0.1;
        }
        break;
      }
      case 'throw':
        tgt.armRx = -Math.PI * 0.95 + this.recoil * 4;
        tgt.armLx = -0.8;
        tgt.lean = -0.1 + this.recoil;
        break;
      case 'cheer': {
        const hop = Math.max(0, Math.sin(this.t * 9 + this.phase));
        tgt.bodyY = hop * 0.18;
        tgt.armRx = -Math.PI + 0.2 + Math.sin(this.t * 9) * 0.2;
        tgt.armLx = -Math.PI + 0.3;
        tgt.armLz = -0.3;
        tgt.armRz = 0.3;
        tgt.thighL = -hop * 0.4;
        tgt.thighR = -hop * 0.4;
        tgt.shinL = hop * 0.8;
        tgt.shinR = hop * 0.8;
        tgt.head = -0.3;
        break;
      }
    }

    const k = 1 - Math.exp(-dt * (this.pose === 'run' ? 30 : 16));
    const j = this.j;
    for (const key of Object.keys(j) as (keyof Joints)[]) j[key] += (tgt[key] - j[key]) * k;

    this.body.position.y = j.bodyY;
    this.torso.rotation.x = j.lean;
    this.head.rotation.x = j.head;
    this.armL.rotation.set(j.armLx, 0, j.armLz);
    this.armR.rotation.set(j.armRx, 0, j.armRz);
    this.thighL.rotation.x = j.thighL;
    this.thighR.rotation.x = j.thighR;
    this.shinL.rotation.x = j.shinL;
    this.shinR.rotation.x = j.shinR;
  }
}

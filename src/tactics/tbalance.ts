import type { WeaponKind } from '../gfx/characterModels';

/** All tuning numbers of the tactics mode. */
export const TB = {
  // camera
  camPitch: 42,
  camDist: 22,
  camFov: 40,
  pixelSize: 2,

  // movement
  runSpeed: 3.4,
  /** Time scale while choosing where a squad should go. */
  commandSlowMo: 0.3,
  commandTimeout: 4,

  // weapons: damage per hit, range (m), time between shots, magazine, reload time, base accuracy
  weapons: {
    revolver: { name: 'Revolver', dmg: 1, range: 16, interval: 0.55, mag: 6, reload: 2.0, acc: 0.55, pellets: 1, ammo: 'náboje .45' },
    rifle: { name: 'Puška', dmg: 2, range: 26, interval: 1.0, mag: 5, reload: 2.6, acc: 0.7, pellets: 1, ammo: 'puškové náboje' },
    shotgun: { name: 'Brokovnica', dmg: 1, range: 9, interval: 1.1, mag: 2, reload: 2.2, acc: 0.5, pellets: 4, ammo: 'broky' },
    dynamite: { name: 'Dynamit', dmg: 4, range: 12, interval: 2, mag: 1, reload: 1.5, acc: 0.8, pellets: 1, ammo: 'dynamit' },
    gatling: { name: 'Guľomet', dmg: 1, range: 18, interval: 0.12, mag: 30, reload: 4, acc: 0.35, pellets: 1, ammo: 'pás' },
  } as Record<WeaponKind, { name: string; dmg: number; range: number; interval: number; mag: number; reload: number; acc: number; pellets: number; ammo: string }>,

  // sheriff (manual aim)
  sheriffHp: 5,
  sheriffReserve: 36,
  sheriffAccSpread: 0.035,
  /** Holding the aim on one bandit this long moves the aim to the head. */
  sheriffHeadAimTime: 0.7,
  /** Cursor moves this many screen px per px of thumb movement on the aim pad. */
  aimPadGain: 1.7,
  /** Cursor snaps to a bandit's body within this many px, to the head within headSnapPx. */
  aimSnapPx: 34,
  headSnapPx: 12,
  /** Sheriff stays leaned out this long after each shot. */
  sheriffExposeTime: 0.6,
  /** Reloading starts this long after the last shot. */
  sheriffReloadDelay: 0.8,

  // posse
  posseHp: 3,
  posseReserve: 24,
  /** When a posse member falls: chance he is only wounded (goes to the doctor). */
  woundedChance: 0.6,

  // hit chance modifiers
  coverPeekMul: 0.45,
  coverHiddenMul: 0.07,
  movingMul: 0.65,
  /** Accuracy falls linearly to this factor at max range. */
  rangeFalloff: 0.45,

  // AI
  peekDelayMin: 0.9,
  peekDelayMax: 2.0,
  /** At most this many bandits aim/shoot at the same moment. */
  maxEnemyShooters: 2,
  /** A bandit has to stay in a cover at least this long before he may move again (unless it is destroyed). */
  enemyMinStay: 4,
  /** Every ~N seconds one bandit rushes to a closer cover. */
  enemyRushEvery: 14,
  enemyRushDist: 6,
  shotsPerPeek: 2,
  enemyTelegraph: 0.6,
  enemyHp: 3,
  enemyReposition: 8,
  enemyPreferDist: 11,
};

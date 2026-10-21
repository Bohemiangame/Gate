import type { WeaponKind } from '../gfx/characterModels';

/**
 * ALL tuning numbers in one place. Change values here, reload the page.
 * Times are in seconds, distances in metres.
 */
export const BALANCE = {
  // ---------- Posse ----------
  startPosse: 3,
  maxPosse: 20,
  runSpeed: 6.5,
  /** Street half-width the posse can move in. */
  laneHalf: 3.6,
  /** Drag across the full screen width moves the posse this many metres. */
  dragMetresPerScreen: 9,
  /** Exponential smoothing of lateral movement (higher = snappier). */
  steerSmoothing: 12,
  /** Distance between posse members in the formation. */
  formationSpacing: 0.62,

  // ---------- Weapons (per posse member) ----------
  weapons: {
    revolver: { name: 'Revolver', damage: 1.0, interval: 0.42, mag: 6, spread: 0.018, pellets: 1, runRange: 24 },
    rifle: { name: 'Puška', damage: 2.4, interval: 0.62, mag: 5, spread: 0.006, pellets: 1, runRange: 30 },
    shotgun: { name: 'Brokovnica', damage: 0.75, interval: 0.8, mag: 4, spread: 0.07, pellets: 5, runRange: 16 },
    dynamite: { name: 'Dynamit', damage: 3.0, interval: 1.0, mag: 3, spread: 0.02, pellets: 1, runRange: 22 },
    gatling: { name: 'Gatling', damage: 0.55, interval: 0.09, mag: 40, spread: 0.03, pellets: 1, runRange: 26 },
  } as Record<WeaponKind, { name: string; damage: number; interval: number; mag: number; spread: number; pellets: number; runRange: number }>,
  weaponOrder: ['revolver', 'rifle', 'shotgun', 'dynamite', 'gatling'] as WeaponKind[],
  /** Dynamite: explosion radius and how many posse members throw per volley (rest keep shooting revolvers). */
  dynamiteRadius: 2.6,
  dynamiteThrowers: 3,
  /** In run phase only this many members fire per volley (keeps tracers readable). */
  maxVisibleTracers: 8,

  // ---------- Fight ----------
  /** Seconds per round reloaded while crouched. */
  reloadPerRound: 0.16,
  headshotMultiplier: 2,
  /** Aim assist: enemy hit boxes are grown by this many metres. */
  aimAssist: 0.12,
  /** Aim point is drawn this many CSS px above the finger so the finger does not hide the target. */
  aimOffsetPx: 56,
  coverHp: 30,
  /** Enemy shot timing. */
  enemyHiddenMin: 1.0,
  enemyHiddenMax: 2.4,
  enemyTelegraph: 0.75,
  enemyExposedAfterShot: 0.45,
  /** Chance an enemy shot kills a member when the posse is exposed. */
  enemyAccuracy: 0.8,
  /** Damage to cover per enemy shot when posse is crouched. */
  enemyCoverDamage: 3,
  enemyFirstDelay: 1.0,
  tntRadius: 3.6,
  tntDamage: 99,

  // ---------- Run phase ----------
  /** Hits for +1 on a gate; every further +1 on the same gate costs gateHitsGrowth more. */
  gateHitsPerPoint: 6,
  gateHitsGrowth: 2,
  /** Shooting raises a gate only up to this value (negative gates can be rescued, positive ones don't grow). */
  gateShootCap: 1,
  divGateHitsToFlip: 24,
  riderTelegraph: 0.9,
  riderInterval: 2.2,

  // ---------- Dead Eye ----------
  deadEyeCharge: 22, // hits needed (headshot = 2)
  deadEyeDuration: 3.5, // real seconds
  deadEyeTimeScale: 0.3,

  // ---------- Boss ----------
  bossTelegraph: 1.0,
  bossBurst: 4,
  bossBurstGap: 0.18,
  bossHiddenMin: 1.6,
  bossHiddenMax: 2.6,

  // ---------- Global HP multipliers (applied on top of level data) ----------
  enemyHpMul: 6,
  riderHpMul: 4,
  bossHpMul: 3.2,

  // ---------- Difficulty scaling per level (index 0 = level 1) ----------
  /** Enemy HP multiplier: 1 + hpGrowth * level. */
  hpGrowth: 0.14,
  /** Quadratic term so later levels keep up with upgrades. */
  hpGrowth2: 0.006,
  /** Telegraph shrinks per level down to the minimum. */
  telegraphShrink: 0.015,
  telegraphMin: 0.5,
  /** Gate values grow slower than enemy HP. */
  gateGrowth: 0.06,

  // ---------- Rewards ----------
  coinsPerSurvivor: 4,
  coinsPerStar: 8,
  coinsPerLevel: 4,
  /** Consolation after a loss: coins per % of the level done (×100) and per kill. */
  loseCoinsProgress: 35,
  loseCoinsPerKill: 2,
  /** 2nd star: survivors >= this share of the peak posse size. */
  starSurvivorShare: 0.6,

  // ---------- Shop upgrades: base cost, cost growth, max level ----------
  upgrades: {
    start: { name: 'Väčšia skupina', desc: '+1 člen na štarte', base: 45, growth: 1.7, max: 6 },
    damage: { name: 'Poškodenie', desc: '+15 % poškodenie', base: 40, growth: 1.6, max: 10 },
    rate: { name: 'Rýchla ruka', desc: '+10 % rýchlosť streľby', base: 40, growth: 1.6, max: 8 },
    reload: { name: 'Nabíjanie', desc: '+20 % rýchlosť nabíjania', base: 30, growth: 1.55, max: 6 },
    cover: { name: 'Pevný kryt', desc: '+25 % odolnosť krytu', base: 30, growth: 1.55, max: 6 },
    weapon: { name: 'Štartová zbraň', desc: 'Trvalo lepšia zbraň na štarte', base: 150, growth: 2.4, max: 2 },
  },
};

export type UpgradeKey = keyof typeof BALANCE.upgrades;

export function upgradeCost(key: UpgradeKey, level: number): number {
  const u = BALANCE.upgrades[key];
  return Math.round(u.base * Math.pow(u.growth, level));
}

export function hpScale(levelIndex: number): number {
  return 1 + BALANCE.hpGrowth * levelIndex + BALANCE.hpGrowth2 * levelIndex * levelIndex;
}

export function telegraphFor(levelIndex: number): number {
  return Math.max(BALANCE.telegraphMin, BALANCE.enemyTelegraph - BALANCE.telegraphShrink * levelIndex);
}

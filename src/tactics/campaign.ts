import type { WeaponKind } from '../gfx/characterModels';

// ---------------------------------------------------------------------------
// Campaign state: money, roster of hired men, sheriff, ammo inventory.
// Saved in localStorage (separate key from the old game).
// ---------------------------------------------------------------------------

export type AmmoType = 'r45' | 'rifle' | 'shells';
export const AMMO_OF: Record<string, AmmoType> = { revolver: 'r45', rifle: 'rifle', shotgun: 'shells' };
export const AMMO_NAME: Record<AmmoType, string> = { r45: 'Náboje .45', rifle: 'Puškové náboje', shells: 'Broky' };

export interface Member {
  id: number;
  name: string;
  weapon: WeaponKind;
  variant: number;
  /** Missions he still has to sit out at the doctor (0 = ready). */
  wounded: number;
  squad: 'A' | 'B' | null;
  missions: number;
  kills: number;
}

export interface Campaign {
  v: 1;
  money: number;
  mission: number;
  nextId: number;
  roster: Member[];
  fallen: string[];
  ammo: Record<AmmoType, number>;
  sheriff: { weapon: WeaponKind; hp: number; acc: number; reload: number };
  doctor: number; // doctor upgrade level
  /** Candidates waiting in the saloon (refreshed after every mission). */
  saloon: { name: string; weapon: WeaponKind; price: number; variant: number }[];
}

const KEY = 'dusty-gulch-campaign-v1';
const NAMES = ['Jake', 'Billy', 'Hank', 'Wyatt', 'Cole', 'Eli', 'Jesse', 'Luke', 'Sam', 'Tom', 'Walt', 'Ned', 'Abe', 'Gus', 'Roy', 'Clay', 'Amos', 'Silas', 'Otis', 'Jeb', 'Earl', 'Virgil', 'Morgan', 'Doc', 'Hoyt', 'Buck'];

export const PRICES = {
  rifle: 90,
  shotgun: 75,
  ammo: { r45: { qty: 12, price: 8 }, rifle: { qty: 10, price: 12 }, shells: { qty: 8, price: 10 } } as Record<AmmoType, { qty: number; price: number }>,
  healNow: 25,
  doctorUpgrade: [60, 120, 200],
  sheriffHp: [50, 100, 160],
  sheriffAcc: [60, 120, 180],
  sheriffReload: [50, 100, 150],
};
/** How many rounds a man carries into a mission (taken from the inventory). */
export const CARRY: Record<AmmoType, number> = { r45: 24, rifle: 20, shells: 12 };
export const SHERIFF_CARRY = 36;
export const MAX_ROSTER = 8;
export const SQUAD_SIZE = 3;

function pickName(c: Campaign): string {
  const used = new Set([...c.roster.map((m) => m.name), ...c.fallen, ...c.saloon.map((s) => s.name)]);
  const free = NAMES.filter((n) => !used.has(n));
  return free.length ? free[Math.floor(Math.random() * free.length)] : `Muž ${c.nextId}`;
}

export function refreshSaloon(c: Campaign): void {
  c.saloon = [];
  for (let i = 0; i < 3; i++) {
    const weapon: WeaponKind = Math.random() < 0.2 + c.mission * 0.05 ? (Math.random() < 0.5 ? 'rifle' : 'shotgun') : 'revolver';
    const price = 30 + (weapon === 'revolver' ? 0 : 35) + Math.floor(Math.random() * 3) * 5 + c.mission * 3;
    c.saloon.push({ name: pickName(c), weapon, price, variant: Math.floor(Math.random() * 8) });
  }
}

export function newCampaign(): Campaign {
  const c: Campaign = {
    v: 1,
    money: 120,
    mission: 0,
    nextId: 1,
    roster: [],
    fallen: [],
    ammo: { r45: 180, rifle: 0, shells: 0 },
    sheriff: { weapon: 'revolver', hp: 0, acc: 0, reload: 0 },
    doctor: 0,
    saloon: [],
  };
  // the sheriff's office starts with four deputies with service revolvers
  for (let i = 0; i < 4; i++) hire(c, { name: pickName(c), weapon: 'revolver', price: 0, variant: i });
  autoSquads(c);
  refreshSaloon(c);
  return c;
}

export function hire(c: Campaign, cand: { name: string; weapon: WeaponKind; variant: number; price: number }): Member {
  const m: Member = { id: c.nextId++, name: cand.name, weapon: cand.weapon, variant: cand.variant, wounded: 0, squad: null, missions: 0, kills: 0 };
  c.roster.push(m);
  return m;
}

/** Fill both squads with ready men (keeps existing assignments where possible). */
export function autoSquads(c: Campaign): void {
  for (const m of c.roster) if (m.wounded > 0) m.squad = null;
  const count = (s: 'A' | 'B') => c.roster.filter((m) => m.squad === s).length;
  for (const m of c.roster) {
    if (m.squad || m.wounded > 0) continue;
    if (count('A') < SQUAD_SIZE) m.squad = 'A';
    else if (count('B') < SQUAD_SIZE) m.squad = 'B';
  }
}

export function loadCampaign(): Campaign | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Campaign;
    return c.v === 1 ? c : null;
  } catch {
    return null;
  }
}

export function saveCampaign(c: Campaign): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* storage unavailable */
  }
}

export function clearCampaign(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

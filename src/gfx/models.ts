import { buildCharacter, buildGun, CharacterModel, Faction, GunModel, WeaponKind } from './characterModels';
import { Character } from './character';

// Model cache: a handful of variants per faction, shared by every character instance.
const VARIANTS: Record<Faction, number> = { posse: 8, posseB: 6, sheriff: 1, bandit: 6, boss: 1, town: 5 };
const charCache = new Map<string, CharacterModel>();
const gunCache = new Map<WeaponKind, GunModel>();

export function charModel(faction: Faction, i: number): CharacterModel {
  const v = ((i % VARIANTS[faction]) + VARIANTS[faction]) % VARIANTS[faction];
  const key = faction + v;
  let m = charCache.get(key);
  if (!m) {
    m = buildCharacter(faction, v + ({ posse: 0, posseB: 50, sheriff: 300, bandit: 100, boss: 200, town: 0 } as Record<Faction, number>)[faction]);
    charCache.set(key, m);
  }
  return m;
}

export function gunModel(kind: WeaponKind): GunModel {
  let g = gunCache.get(kind);
  if (!g) {
    g = buildGun(kind);
    gunCache.set(kind, g);
  }
  return g;
}

export function makeCharacter(faction: Faction, i: number, weapon: WeaponKind): Character {
  return new Character(charModel(faction, i), gunModel(weapon), weapon);
}

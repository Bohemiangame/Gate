import type { UpgradeKey } from './balance';

export interface SaveData {
  v: 1;
  level: number; // next level index to play (0-based)
  coins: number;
  upg: Record<UpgradeKey, number>;
  stars: Record<number, number>;
  sound: boolean;
  tutorialDone: boolean;
}

const KEY = 'dusty-gulch-save-v1';

export function defaultSave(): SaveData {
  return {
    v: 1,
    level: 0,
    coins: 0,
    upg: { start: 0, damage: 0, rate: 0, reload: 0, cover: 0, weapon: 0 },
    stars: {},
    sound: true,
    tutorialDone: false,
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const d = JSON.parse(raw);
    const def = defaultSave();
    return { ...def, ...d, upg: { ...def.upg, ...(d.upg ?? {}) }, stars: { ...(d.stars ?? {}) } };
  } catch {
    return defaultSave();
  }
}

export function writeSave(d: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable (private mode) – progress just isn't kept */
  }
}

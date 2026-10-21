import type { WeaponKind } from '../gfx/characterModels';
import { rng } from '../engine/voxel';

// ---------------------------------------------------------------------------
// Level data. Levels are plain data; helpers below only keep them short.
// Enemy `hp` is in base units and gets multiplied by the level HP scale.
// `dz` = distance in metres in front of the posse's cover.
// ---------------------------------------------------------------------------

export type GateOp = '+' | '-' | 'x' | '/';
export interface GateDef {
  op: GateOp;
  v: number;
}
export type CoverKind = 'barrel' | 'crate' | 'wagon' | 'hay' | 'trough' | 'roof' | 'none';
export type EnemyWeapon = 'revolver' | 'rifle' | 'dynamite';

export interface EnemyDef {
  cover: CoverKind;
  x: number;
  dz: number;
  hp: number;
  weapon?: EnemyWeapon;
}

export type RunItem =
  | { t: 'gates'; at: number; gates: GateDef[] }
  | { t: 'crate'; at: number; x: number; hits: number; weapon: WeaponKind }
  | { t: 'rider'; at: number; x: number; hp: number };

export interface RunSeg {
  kind: 'run';
  len: number;
  items: RunItem[];
}
export interface FightSeg {
  kind: 'fight';
  enemies: EnemyDef[];
  tnt?: { x: number; dz: number }[];
}
export interface BossSeg {
  kind: 'boss';
  hp: number;
  guards: EnemyDef[];
  tnt?: { x: number; dz: number }[];
}
export type Segment = RunSeg | FightSeg | BossSeg;

export interface LevelDef {
  name: string;
  seed: number;
  /** Par time for the 3rd star (seconds). */
  par: number;
  segments: Segment[];
}

// ---- helpers ----
const g = (s: string): GateDef => {
  const op = s[0] as GateOp;
  return { op, v: parseInt(s.slice(1), 10) };
};
const gates = (at: number, ...s: string[]): RunItem => ({ t: 'gates', at, gates: s.map(g) });
const crate = (at: number, x: number, hits: number, weapon: WeaponKind): RunItem => ({ t: 'crate', at, x, hits, weapon });
const rider = (at: number, x: number, hp = 2): RunItem => ({ t: 'rider', at, x, hp });
const run = (len: number, ...items: RunItem[]): RunSeg => ({ kind: 'run', len, items });
const e = (cover: CoverKind, x: number, dz: number, hp: number, weapon?: EnemyWeapon): EnemyDef => ({ cover, x, dz, hp, weapon });
const roof = (side: -1 | 1, dz: number, hp: number, weapon: EnemyWeapon = 'rifle'): EnemyDef => e('roof', side * 6.0, dz, hp, weapon);
const fight = (enemies: EnemyDef[], tnt?: { x: number; dz: number }[]): FightSeg => ({ kind: 'fight', enemies, tnt });
const boss = (hp: number, guards: EnemyDef[], tnt?: { x: number; dz: number }[]): BossSeg => ({ kind: 'boss', hp, guards, tnt });

export const LEVELS: LevelDef[] = [
  {
    name: 'Prvý deň v meste',
    seed: 11,
    par: 70,
    segments: [
      run(55, gates(14, '+1', '+2'), rider(36, 0, 2)),
      fight([e('barrel', -1.5, 12, 3), e('crate', 2, 14, 3)]),
      run(50, gates(12, '+2', '-1'), gates(34, '+3', '+1')),
      fight([e('wagon', -1, 13, 3), e('barrel', 2.5, 11, 3), roof(1, 16, 3)]),
      run(30, gates(12, '+2', '+1')),
      boss(28, [e('barrel', 2.5, 12, 3)]),
    ],
  },
  {
    name: 'Prach na hlavnej',
    seed: 23,
    par: 75,
    segments: [
      run(55, gates(12, '+2', '-1'), crate(30, -1.8, 14, 'rifle'), rider(44, 2, 2)),
      fight([e('barrel', -2, 12, 3), e('crate', 1.5, 13, 3), roof(-1, 16, 3)], [{ x: 0.4, dz: 14 }]),
      run(55, gates(14, '+3', '+1'), rider(30, -2, 2), gates(42, '-2', '+2')),
      fight([e('wagon', 0, 13, 4), e('hay', -2.8, 11, 3), e('barrel', 2.8, 15, 3), roof(1, 17, 3)]),
      run(30, gates(12, '+1', '+2', '-1')),
      boss(34, [e('crate', -2.5, 12, 3), roof(1, 16, 3)]),
    ],
  },
  {
    name: 'Banka o polnoci',
    seed: 37,
    par: 80,
    segments: [
      run(60, gates(12, '+2', '+1'), rider(28, -1, 3), crate(40, 1.6, 18, 'rifle'), gates(52, '-1', '+3')),
      fight([e('barrel', -2, 12, 3), e('wagon', 1, 14, 4), roof(-1, 15, 3), roof(1, 18, 3)], [{ x: -0.6, dz: 15 }]),
      run(55, gates(12, '+3', '-2'), rider(26, 1.5, 3), rider(30, -1.5, 3), gates(44, '+2', '/2')),
      fight([e('crate', -2.5, 11, 4), e('barrel', 0, 13, 3), e('trough', 2.5, 12, 4), roof(1, 16, 4)]),
      run(40, gates(14, '+2', '-1', '+3')),
      boss(40, [e('barrel', -2.5, 12, 3), e('crate', 2.5, 13, 3)], [{ x: 1.2, dz: 15 }]),
    ],
  },
  {
    name: 'Saloon v plameňoch',
    seed: 41,
    par: 85,
    segments: [
      run(55, gates(12, '+2', '-2'), crate(30, 0, 22, 'shotgun'), rider(46, 2, 3)),
      fight([e('barrel', -2.4, 11, 4), e('wagon', 0.8, 13, 4), roof(-1, 16, 4), roof(1, 15, 4)], [{ x: 2.4, dz: 13 }]),
      run(55, gates(12, '+3', '+1'), rider(24, -2, 3), gates(40, '-3', '+2')),
      fight([e('hay', -2.6, 12, 4), e('crate', 0, 11, 4, 'dynamite'), e('barrel', 2.6, 13, 4), roof(-1, 17, 4)]),
      run(45, gates(12, '+2', '+1', '-2'), crate(30, -1.6, 20, 'shotgun')),
      fight([e('wagon', -1, 12, 5), e('trough', 2.2, 14, 4), roof(1, 16, 4), roof(-1, 18, 4)], [{ x: 0.5, dz: 15 }]),
      boss(46, [e('barrel', 2.6, 12, 4), roof(-1, 16, 4)]),
    ],
  },
  {
    name: 'Vlak s dynamitom',
    seed: 53,
    par: 90,
    segments: [
      run(60, gates(12, '+3', '-1'), rider(26, 0, 3), crate(38, 1.8, 24, 'rifle'), gates(52, '+3', '-3')),
      fight([e('crate', -2, 12, 4, 'dynamite'), e('barrel', 1.5, 13, 4), roof(1, 16, 4), roof(-1, 17, 4)], [{ x: -0.4, dz: 14 }]),
      run(55, gates(12, '+2', '/2'), rider(26, -1.5, 4), rider(30, 1.5, 4), crate(42, 0, 26, 'shotgun')),
      fight([e('wagon', 0, 13, 5), e('barrel', -2.6, 11, 4), e('hay', 2.6, 12, 4), roof(-1, 16, 5)], [{ x: 2, dz: 15 }]),
      run(45, gates(14, '+3', '-2', '+1')),
      fight([e('trough', -2, 12, 5), e('crate', 2, 12, 5, 'dynamite'), roof(1, 15, 5), roof(-1, 18, 5)]),
      boss(52, [e('barrel', -2.6, 12, 4), e('crate', 2.6, 12, 4, 'dynamite')], [{ x: 0, dz: 16 }]),
    ],
  },
  {
    name: 'Zlatá horúčka',
    seed: 67,
    par: 95,
    segments: [
      run(60, gates(12, '+3', '+1'), rider(28, -2, 4), gates(42, '-2', 'x2'), crate(54, 2, 26, 'rifle')),
      fight([e('barrel', -2.4, 12, 5), e('wagon', 1, 14, 5), roof(-1, 15, 5), roof(1, 17, 5)], [{ x: -1, dz: 15 }]),
      run(60, gates(12, '+2', '-3', '+3'), rider(26, 1, 4), rider(32, -1, 4), crate(46, 0, 30, 'shotgun')),
      fight([e('crate', -2.6, 11, 5, 'dynamite'), e('hay', 0, 12, 5), e('barrel', 2.6, 13, 5), roof(-1, 17, 5), roof(1, 16, 5)]),
      run(45, gates(12, '+3', '/2'), gates(32, '+2', '-2')),
      fight([e('wagon', -1, 12, 6), e('trough', 2.4, 14, 5), roof(1, 15, 5)], [{ x: 0.8, dz: 14 }]),
      boss(58, [e('barrel', -2.6, 12, 5), roof(1, 16, 5), roof(-1, 17, 5)]),
    ],
  },
  {
    name: 'Mesto duchov',
    seed: 79,
    par: 100,
    segments: [
      run(60, gates(12, '+3', '-2'), rider(26, 1, 4), rider(30, -1.5, 4), crate(44, -1.8, 30, 'shotgun')),
      fight([e('barrel', -2.4, 11, 5), e('crate', 0, 13, 5, 'dynamite'), e('barrel', 2.4, 12, 5), roof(-1, 16, 5), roof(1, 18, 5)], [{ x: 1.4, dz: 14 }]),
      run(60, gates(12, 'x2', '-3'), rider(28, 0, 5), gates(42, '+3', '+1', '-2'), crate(54, 1.6, 34, 'dynamite')),
      fight([e('wagon', 0, 13, 6), e('hay', -2.6, 12, 5), e('trough', 2.6, 14, 5), roof(-1, 15, 6), roof(1, 17, 6)]),
      run(50, gates(14, '+2', '-1'), rider(32, 2, 5)),
      fight([e('crate', -2, 12, 6, 'dynamite'), e('barrel', 2, 12, 6), roof(1, 16, 6), roof(-1, 18, 6)], [{ x: 0, dz: 15 }]),
      boss(64, [e('wagon', -2.4, 13, 5), e('barrel', 2.6, 12, 5), roof(1, 16, 5)]),
    ],
  },
  {
    name: 'Šerifova pomsta',
    seed: 83,
    par: 105,
    segments: [
      run(60, gates(12, '+3', '+2'), rider(26, -2, 5), crate(40, 1.8, 34, 'shotgun'), gates(52, '-3', 'x2')),
      fight([e('barrel', -2.6, 12, 6), e('wagon', 0.5, 14, 6), e('hay', 2.6, 11, 6), roof(-1, 16, 6), roof(1, 17, 6)], [{ x: -1.2, dz: 15 }]),
      run(60, gates(12, '+2', '/2', '+3'), rider(24, 1.5, 5), rider(28, -1.5, 5), crate(46, 0, 38, 'dynamite')),
      fight([e('crate', -2.4, 11, 6, 'dynamite'), e('trough', 0, 13, 6), e('barrel', 2.4, 12, 6), roof(1, 15, 6), roof(-1, 18, 6)]),
      run(50, gates(14, '+3', '-2'), rider(34, 0, 5)),
      fight([e('wagon', -1, 12, 7), e('crate', 2.4, 13, 6, 'dynamite'), roof(-1, 16, 6), roof(1, 17, 6)], [{ x: 0.6, dz: 14 }]),
      boss(70, [e('barrel', -2.6, 12, 6), e('hay', 2.6, 12, 6), roof(-1, 16, 6)], [{ x: -1.6, dz: 15 }]),
    ],
  },
  {
    name: 'Kaňon smrti',
    seed: 97,
    par: 110,
    segments: [
      run(65, gates(12, '+3', '-3'), rider(24, 0, 5), rider(28, 2, 5), crate(40, -1.6, 36, 'shotgun'), gates(54, 'x2', '+2')),
      fight([e('barrel', -2.6, 11, 7), e('crate', 0, 12, 7, 'dynamite'), e('wagon', 2.2, 14, 7), roof(-1, 15, 7), roof(1, 17, 7)], [{ x: 1, dz: 13 }]),
      run(60, gates(12, '+2', '-2', '+3'), rider(26, -1.8, 6), crate(42, 1.8, 40, 'dynamite'), gates(54, '/2', '+3')),
      fight([e('hay', -2.6, 12, 7), e('trough', 0, 13, 7), e('barrel', 2.6, 11, 7, 'dynamite'), roof(-1, 16, 7), roof(1, 18, 7)], [{ x: -0.6, dz: 15 }]),
      run(50, gates(14, '+3', '+1'), rider(30, 0, 6), rider(34, 1.6, 6)),
      fight([e('wagon', -1, 12, 8), e('crate', 2.4, 12, 7, 'dynamite'), roof(-1, 15, 7), roof(1, 16, 7), roof(-1, 18, 7)]),
      boss(78, [e('barrel', -2.6, 12, 7), e('crate', 2.6, 12, 7, 'dynamite'), roof(1, 16, 7)], [{ x: 0, dz: 15 }]),
    ],
  },
  {
    name: 'Posledná prestrelka',
    seed: 101,
    par: 120,
    segments: [
      run(65, gates(12, '+3', '-2'), rider(24, -1.5, 6), rider(28, 1.5, 6), crate(42, 0, 40, 'dynamite'), gates(56, 'x2', '-3')),
      fight([e('barrel', -2.6, 11, 8), e('wagon', 0.5, 13, 8), e('crate', 2.6, 12, 8, 'dynamite'), roof(-1, 15, 8), roof(1, 17, 8)], [{ x: -1, dz: 14 }]),
      run(60, gates(12, '+3', '/2', '+2'), rider(26, 0, 6), crate(42, 1.8, 46, 'gatling'), gates(54, '+2', '-2')),
      fight([e('hay', -2.6, 12, 8), e('crate', 0, 11, 8, 'dynamite'), e('trough', 2.6, 13, 8), roof(-1, 16, 8), roof(1, 18, 8)], [{ x: 1.4, dz: 15 }]),
      run(55, gates(14, '+3', '-3', '+1'), rider(30, -2, 7), rider(34, 2, 7)),
      fight([e('wagon', -1, 12, 9), e('barrel', 2.4, 12, 8, 'dynamite'), roof(-1, 15, 8), roof(1, 16, 8), roof(-1, 18, 8)], [{ x: 0.4, dz: 15 }]),
      boss(86, [e('barrel', -2.6, 12, 8), e('hay', 2.6, 12, 8), roof(-1, 16, 8), roof(1, 17, 8)], [{ x: -1.4, dz: 14 }]),
    ],
  },
];

const NAMES = ['Divoký západ', 'Prašná cesta', 'Strieborný kaňon', 'Hrdzavá ostroha', 'Čierna rokliny', 'Zlatý dôl', 'Suchý potok', 'Vlčí prameň'];

/**
 * Procedural levels after the hand-made ones. Difficulty grows with `index`
 * (index 10 = level 11). Same building blocks as above.
 */
export function generateLevel(index: number): LevelDef {
  const r = rng(index * 1013 + 7);
  const d = index - LEVELS.length + 1; // 1, 2, 3...
  const tier = 8 + d * 0.8; // base enemy hp
  const pickX = () => Math.round((r() * 2 - 1) * 2.6 * 10) / 10;
  const covers: CoverKind[] = ['barrel', 'crate', 'wagon', 'hay', 'trough'];
  const gatePool = ['+1', '+2', '+3', '-1', '-2', '-3', 'x2', '/2'];
  const gatePair = (): string[] => {
    const n = r() < 0.3 ? 3 : 2;
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(gatePool[Math.floor(r() * gatePool.length)]);
    if (!out.some((s) => s[0] === '+' || s[0] === 'x')) out[0] = '+2';
    return out;
  };
  const weaponPool: WeaponKind[] = ['rifle', 'shotgun', 'dynamite', 'gatling'];
  const segs: Segment[] = [];
  const fights = 3;
  for (let f = 0; f < fights; f++) {
    const items: RunItem[] = [gates(12, ...gatePair())];
    const riders = 1 + Math.floor(r() * 2);
    for (let k = 0; k < riders; k++) items.push(rider(24 + k * 5, pickX(), Math.round(tier * 0.75)));
    if (r() < 0.7) items.push(crate(40, pickX() * 0.7, Math.round(40 + d * 4), weaponPool[Math.floor(r() * weaponPool.length)]));
    items.push(gates(54, ...gatePair()));
    segs.push(run(62, ...items));
    const enemies: EnemyDef[] = [];
    const ground = 3 + (r() < 0.4 ? 1 : 0);
    for (let k = 0; k < ground; k++) {
      const x = -2.6 + (5.2 * k) / Math.max(1, ground - 1) + (r() - 0.5) * 0.4;
      enemies.push(e(covers[Math.floor(r() * covers.length)], Math.round(x * 10) / 10, 11 + Math.floor(r() * 4), Math.round(tier), r() < 0.25 ? 'dynamite' : undefined));
    }
    const roofs = 1 + Math.floor(r() * 2.5);
    for (let k = 0; k < roofs; k++) enemies.push(roof(k % 2 ? 1 : -1, 15 + Math.floor(r() * 4), Math.round(tier)));
    segs.push(fight(enemies, r() < 0.7 ? [{ x: pickX() * 0.6, dz: 14 }] : undefined));
  }
  segs.push(run(30, gates(12, ...gatePair())));
  segs.push(boss(Math.round(90 + d * 6), [e('barrel', -2.6, 12, Math.round(tier)), e('crate', 2.6, 12, Math.round(tier), 'dynamite'), roof(1, 16, Math.round(tier))], [{ x: 0, dz: 15 }]));
  return { name: `${NAMES[index % NAMES.length]} ${d}`, seed: 500 + index, par: 125, segments: segs };
}

export function levelDef(index: number): LevelDef {
  return index < LEVELS.length ? LEVELS[index] : generateLevel(index);
}

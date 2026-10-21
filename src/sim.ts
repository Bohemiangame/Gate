import type { View } from './engine/view';
import { Game } from './game/game';
import { BALANCE, upgradeCost, UpgradeKey } from './game/balance';
import { defaultSave } from './game/save';

/**
 * ?sim – headless balance simulation. Runs the real game logic with a bot player at a fixed
 * time step (no rendering) and prints a table per level. Results go to the page and to
 * `window.simResult` (read by tools/run-sim.mjs).
 *   ?sim&levels=12&profile=good|average|bad&runs=3
 */
export async function runSim(view: View, ui: HTMLElement, params: URLSearchParams): Promise<void> {
  const levels = parseInt(params.get('levels') ?? '12', 10);
  const runs = parseInt(params.get('runs') ?? '3', 10);
  const profiles: Record<string, { duck: number; aimError: number; headBias: number; greedy: number }> = {
    good: { duck: 0.95, aimError: 0.12, headBias: 0.6, greedy: 0.8 },
    average: { duck: 0.75, aimError: 0.3, headBias: 0.3, greedy: 0.5 },
    bad: { duck: 0.45, aimError: 0.5, headBias: 0.1, greedy: 0.2 },
  };
  const which = (params.get('profile') ?? 'good,average,bad').split(',');
  const out: Record<string, unknown[]> = {};
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:0;margin:0;overflow:auto;background:#111;color:#0f0;font:11px monospace;z-index:9;pointer-events:auto';
  document.body.appendChild(pre);
  const log = (s: string) => {
    pre.textContent += s + '\n';
  };
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  const game = new Game(view, ui);
  game.hud.closeScreen();
  const DT = 1 / 30;

  for (const prof of which) {
    const rows: unknown[] = [];
    out[prof] = rows;
    log(`=== profile ${prof} ===`);
    log('lvl att won surv peak lost time stars coins upg');
    for (let run = 0; run < runs; run++) {
      game.save = defaultSave();
      game.autoplay = profiles[prof];
      for (let lvl = 0; lvl < levels; lvl++) {
        let won = false;
        for (let att = 1; att <= 6 && !won; att++) {
          let res: Parameters<NonNullable<Game['onResult']>>[0] | null = null;
          game.onResult = (r) => {
            res = r;
          };
          game.loadLevel(lvl);
          game.begin();
          let t = 0;
          while (!res && t < 400) {
            game.update(DT);
            t += DT;
          }
          const r = res as Parameters<NonNullable<Game['onResult']>>[0] | null;
          if (!r) {
            log(`${lvl + 1} ${att} TIMEOUT phase=${game.phase}`);
            break;
          }
          won = r.won;
          game.save.coins += r.coins;
          if (won) game.save.level = lvl + 1;
          // bot shopping: cheapest affordable upgrade first
          const keys = Object.keys(BALANCE.upgrades) as UpgradeKey[];
          for (;;) {
            const opts = keys.filter((k) => game.save.upg[k] < BALANCE.upgrades[k].max).map((k) => ({ k, c: upgradeCost(k, game.save.upg[k]) }));
            opts.sort((a, b) => a.c - b.c);
            if (!opts.length || opts[0].c > game.save.coins) break;
            game.save.coins -= opts[0].c;
            game.save.upg[opts[0].k]++;
          }
          const upg = Object.values(game.save.upg).join('');
          const row = { prof, run, lvl: lvl + 1, att, won: r.won, surv: r.survivors, peak: r.peak, time: Math.round(r.time), stars: r.stars, coins: r.coins, progress: Math.round(r.progress * 100), lost: r.lost, upg };
          rows.push(row);
          log(`${String(lvl + 1).padStart(3)} ${att}  ${r.won ? 'W' : 'L'}   ${String(r.survivors).padStart(3)}  ${String(r.peak).padStart(3)}  ${String(r.lost).padStart(3)} ${String(Math.round(r.time)).padStart(4)}   ${r.stars}   ${String(r.coins).padStart(4)}  ${upg}${r.won ? '' : ' @' + Math.round(r.progress * 100) + '%'}`);
          await new Promise((res2) => setTimeout(res2, 0));
        }
      }
    }
  }
  (window as unknown as { simResult: unknown }).simResult = out;
  log('DONE');
}

import type { Game } from './game/game';

/** ?debug overlay: FPS, counts, level jump buttons, cheats. */
export function installDebug(game: Game, root: HTMLElement): (dt: number) => void {
  const el = document.createElement('div');
  el.className = 'debug';
  root.appendChild(el);
  const info = document.createElement('div');
  el.appendChild(info);
  const btns = document.createElement('div');
  el.appendChild(btns);
  const add = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    btns.appendChild(b);
  };
  for (let i = 0; i < 15; i++) add(`L${i + 1}`, () => game.jumpTo(i));
  add('+500$', () => {
    game.save.coins += 500;
    game.hud.setCoins(game.save.coins);
  });
  add('god', () => {
    game.god = !game.god;
  });
  add('+5', () => {
    for (let i = 0; i < 5; i++) game.addMember();
  });
  add('bot', () => {
    game.autoplay = game.autoplay ? null : { duck: 0.85, aimError: 0.25, headBias: 0.4, greedy: 0.6 };
  });
  add('kill all', () => {
    if (game.fight) for (const e of game.fight.enemies) if (e.alive) e.kill();
  });
  let acc = 0;
  let frames = 0;
  let fps = 0;
  return (dt: number) => {
    acc += dt;
    frames++;
    if (acc >= 0.5) {
      fps = Math.round(frames / acc);
      acc = 0;
      frames = 0;
      const r = game.view.renderer.info.render;
      const enemies = game.fight ? game.fight.enemies.filter((e) => e.alive).length : 0;
      info.textContent = `FPS ${fps} | calls ${r.calls} | tris ${(r.triangles / 1000).toFixed(0)}k | posse ${game.members.length} | enemies ${enemies} | ${game.phase} | ${game.god ? 'GOD' : ''}`;
    }
  };
}

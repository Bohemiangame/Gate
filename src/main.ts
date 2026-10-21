import './style.css';
import { View } from './engine/view';
import { startShowcase } from './showcase';
import { Game } from './game/game';
import { installDebug } from './debug';
import { runSim } from './sim';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const view = new View(canvas);

// Block browser gestures (pinch zoom, double-tap zoom, context menu, scrolling) on mobile.
for (const ev of ['gesturestart', 'gesturechange', 'dblclick', 'contextmenu'])
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

if (params.has('showcase') || params.has('view')) {
  startShowcase(view, params);
} else if (params.has('sim')) {
  runSim(view, ui, params);
} else {
  const game = new Game(view, ui);
  const dbg = params.has('debug') ? installDebug(game, ui) : null;
  (window as unknown as { game: Game }).game = game;
  let last = performance.now();
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.update(dt);
    view.render();
    dbg?.(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => {
    last = performance.now();
  });
}

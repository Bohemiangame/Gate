import './style.css';
import { View } from './engine/view';
import { startShowcase } from './showcase';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const view = new View(canvas);

// Block browser gestures (pinch zoom, double-tap zoom, context menu) on mobile.
for (const ev of ['gesturestart', 'gesturechange', 'dblclick', 'contextmenu'])
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });

startShowcase(view, params);

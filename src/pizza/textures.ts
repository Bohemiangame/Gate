import * as THREE from 'three';
import { rng } from '../engine/voxel';

// Procedural canvas textures for the night city (no image files).

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export type FacadeStyle = 'glass' | 'concrete' | 'brick' | 'dark';

const FACADE: Record<FacadeStyle, { wall: string; frame: string; glass: string; lit: string[]; litChance: number; cols: number; rows: number }> = {
  glass: { wall: '#2a3c52', frame: '#3e5672', glass: '#1c2c40', lit: ['#bfe6ff', '#ffe8b0', '#9ad0ff'], litChance: 0.38, cols: 8, rows: 8 },
  concrete: { wall: '#8a8a94', frame: '#5c5c66', glass: '#222838', lit: ['#ffd9a0', '#ffe8c0', '#ffc070'], litChance: 0.32, cols: 4, rows: 4 },
  brick: { wall: '#8a4a3a', frame: '#4a2a22', glass: '#22202a', lit: ['#ffcf8a', '#ffb860', '#fff0c8'], litChance: 0.36, cols: 4, rows: 4 },
  dark: { wall: '#3c3c4a', frame: '#26262e', glass: '#1a1c28', lit: ['#c8a0ff', '#80f0ff', '#ffd090'], litChance: 0.3, cols: 6, rows: 6 },
};

/**
 * Facade: one tile = `cols` windows wide (3 m each) and `rows` floors high (3.2 m each).
 * Returns the diffuse map and an emissive map with randomly lit windows.
 */
export function facadeTextures(style: FacadeStyle, seed: number): { map: THREE.Texture; emissive: THREE.Texture; tileW: number; tileH: number } {
  const f = FACADE[style];
  const cw = 64, ch = 64; // pixels per window cell
  const [c, g] = canvas(f.cols * cw, f.rows * ch);
  const [e, ge] = canvas(f.cols * cw, f.rows * ch);
  const r = rng(seed);
  g.fillStyle = f.wall;
  g.fillRect(0, 0, c.width, c.height);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, e.width, e.height);
  // subtle wall noise
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + r() * 0.04})`;
    g.fillRect(r() * c.width, r() * c.height, 2, 2);
  }
  for (let y = 0; y < f.rows; y++)
    for (let x = 0; x < f.cols; x++) {
      const px = x * cw, py = y * ch;
      if (style === 'brick') {
        g.fillStyle = 'rgba(0,0,0,0.18)';
        for (let k = 0; k < ch; k += 6) g.fillRect(px, py + k, cw, 1);
      }
      // window frame + glass
      const m = style === 'glass' ? 4 : 12;
      const top = style === 'glass' ? 6 : 14;
      g.fillStyle = f.frame;
      g.fillRect(px + m - 2, py + top - 2, cw - 2 * m + 4, ch - top - 8 + 4);
      g.fillStyle = f.glass;
      g.fillRect(px + m, py + top, cw - 2 * m, ch - top - 8);
      if (style !== 'glass') {
        g.fillStyle = 'rgba(255,255,255,0.06)';
        g.fillRect(px + m, py + top, cw - 2 * m, 4);
        g.fillStyle = f.frame;
        g.fillRect(px + cw / 2 - 1, py + top, 2, ch - top - 8);
      }
      if (r() < f.litChance) {
        const col = f.lit[Math.floor(r() * f.lit.length)];
        const dim = 0.55 + r() * 0.45;
        ge.globalAlpha = dim;
        ge.fillStyle = col;
        ge.fillRect(px + m, py + top, cw - 2 * m, ch - top - 8);
        // curtains / silhouettes
        if (r() < 0.4) {
          ge.fillStyle = '#000';
          ge.globalAlpha = 0.5;
          ge.fillRect(px + m + r() * (cw - 2 * m - 10), py + top + 8, 8, ch - top - 18);
        }
        ge.globalAlpha = 1;
        g.fillStyle = col;
        g.globalAlpha = 0.35;
        g.fillRect(px + m, py + top, cw - 2 * m, ch - top - 8);
        g.globalAlpha = 1;
      }
    }
  if (style === 'glass') {
    // vertical mullions
    g.fillStyle = 'rgba(120,160,200,0.25)';
    for (let x = 0; x < c.width; x += cw) g.fillRect(x, 0, 3, c.height);
  }
  return { map: tex(c), emissive: tex(e), tileW: f.cols * 3, tileH: f.rows * 3.2 };
}

export function asphaltTexture(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  const r = rng(3);
  g.fillStyle = '#23252b';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = 20 + Math.floor(r() * 30);
    g.fillStyle = `rgb(${v},${v + 1},${v + 5})`;
    g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
  }
  // cracks / patches
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    let x = r() * 256, y = r() * 256;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (r() - 0.5) * 40;
      y += (r() - 0.5) * 40;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return tex(c);
}

export function pavingTexture(): THREE.Texture {
  const [c, g] = canvas(128, 128);
  const r = rng(5);
  g.fillStyle = '#4a4a52';
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 32)
    for (let x = 0; x < 128; x += 32) {
      const v = 70 + Math.floor(r() * 16);
      g.fillStyle = `rgb(${v},${v},${v + 6})`;
      g.fillRect(x + 1, y + 1, 30, 30);
    }
  return tex(c);
}

export function grassTexture(): THREE.Texture {
  const [c, g] = canvas(128, 128);
  const r = rng(7);
  g.fillStyle = '#1a3a22';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = r() < 0.5 ? '#224a2a' : '#163220';
    g.fillRect(r() * 128, r() * 128, 1, 2);
  }
  return tex(c);
}

/** Soft radial gradient (light pools on the ground, glows). */
export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.Texture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.6)'));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return tex(c, true, false);
}

/** Headlight cone on the ground: bright near the car, fading forward. */
export function headlightTexture(): THREE.Texture {
  const [c, g] = canvas(128, 256);
  const grad = g.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0, 'rgba(255,245,220,0.9)');
  grad.addColorStop(1, 'rgba(255,245,220,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(54, 256);
  g.lineTo(74, 256);
  g.lineTo(128, 0);
  g.lineTo(0, 0);
  g.closePath();
  g.fill();
  // soften the sides
  const side = g.createLinearGradient(0, 0, 128, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)');
  side.addColorStop(0.2, 'rgba(0,0,0,0)');
  side.addColorStop(0.8, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = side;
  g.fillRect(0, 0, 128, 256);
  return tex(c, true, false);
}

/** Neon sign: glowing text on transparent background (used as emissive map of an additive plane). */
export function neonTexture(text: string, color: string, frame = true): { tex: THREE.Texture; aspect: number } {
  const font = `900 64px 'Trebuchet MS', 'Arial Black', sans-serif`;
  const [m, mg] = canvas(4, 4);
  mg.font = font;
  const w = Math.ceil(mg.measureText(text).width) + 60;
  void m;
  const [c, g] = canvas(w, 100);
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.lineWidth = 5;
  g.strokeStyle = color;
  g.strokeText(text, w / 2, 52);
  g.shadowBlur = 6;
  g.fillStyle = '#ffffff';
  g.globalAlpha = 0.85;
  g.fillText(text, w / 2, 52);
  g.globalAlpha = 1;
  if (frame) {
    g.shadowBlur = 12;
    g.strokeStyle = color;
    g.lineWidth = 4;
    g.strokeRect(8, 8, w - 16, 84);
  }
  return { tex: tex(c, true, false), aspect: w / 100 };
}

/** Night sky gradient for scene.background. */
export function nightSky(): THREE.Texture {
  const [c, g] = canvas(4, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#05060f');
  grad.addColorStop(0.55, '#141a3a');
  grad.addColorStop(0.8, '#3a2a5a');
  grad.addColorStop(1, '#5a3a6a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  return tex(c, true, false);
}

/** Text label texture for roof signs etc. */
export function signTexture(text: string, bg: string, fg: string): THREE.Texture {
  const [c, g] = canvas(256, 64);
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = fg;
  g.font = `900 44px 'Trebuchet MS', 'Arial Black', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  return tex(c, true, false);
}

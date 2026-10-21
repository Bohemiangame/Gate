import * as THREE from 'three';

export interface LabelStyle {
  color?: string;
  stroke?: string;
  bg?: string | null;
  font?: string;
  px?: number;
}

/**
 * Text sprite drawn on a canvas. The texture is only redrawn when the text changes.
 * Size is in world units (height of the sprite).
 */
export class Label {
  readonly sprite: THREE.Sprite;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private text = '';

  constructor(
    text: string,
    private height = 0.6,
    private style: LabelStyle = {},
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 64;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, fog: false }));
    this.sprite.renderOrder = 10;
    this.set(text);
  }

  set(text: string): void {
    if (text === this.text) return;
    this.text = text;
    const ctx = this.ctx;
    const px = this.style.px ?? 46;
    ctx.font = this.style.font ?? `900 ${px}px 'Trebuchet MS', 'Arial Black', sans-serif`;
    const w = Math.max(64, Math.ceil(ctx.measureText(text).width + 28));
    if (this.canvas.width !== w) {
      this.canvas.width = w;
      ctx.font = this.style.font ?? `900 ${px}px 'Trebuchet MS', 'Arial Black', sans-serif`;
    }
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.style.bg) {
      ctx.fillStyle = this.style.bg;
      const r = 14;
      const W = this.canvas.width, H = this.canvas.height;
      ctx.beginPath();
      ctx.moveTo(r, 2);
      ctx.arcTo(W - 2, 2, W - 2, H - 2, r);
      ctx.arcTo(W - 2, H - 2, 2, H - 2, r);
      ctx.arcTo(2, H - 2, 2, 2, r);
      ctx.arcTo(2, 2, W - 2, 2, r);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = this.style.stroke ?? 'rgba(30,16,8,0.95)';
    ctx.strokeText(text, this.canvas.width / 2, 34);
    ctx.fillStyle = this.style.color ?? '#fff8e0';
    ctx.fillText(text, this.canvas.width / 2, 34);
    this.tex.needsUpdate = true;
    this.sprite.scale.set((this.height * this.canvas.width) / this.canvas.height, this.height, 1);
  }

  setColor(color: string): void {
    if (this.style.color === color) return;
    this.style.color = color;
    const t = this.text;
    this.text = '';
    this.set(t);
  }

  dispose(): void {
    this.tex.dispose();
    this.sprite.material.dispose();
  }
}

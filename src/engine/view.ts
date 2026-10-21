import * as THREE from 'three';
import { FOG_COLOR, makeSkyTexture } from '../gfx/town';

/** Renderer + scene + camera with a portrait-friendly field of view. */
export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  /** Horizontal field of view we try to keep (degrees). */
  hfov = 58;
  private shakeT = 0;
  private shakeAmp = 0;
  readonly shakeOffset = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene.background = makeSkyTexture();
    this.scene.fog = new THREE.Fog(FOG_COLOR, 38, 95);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    const hf = THREE.MathUtils.degToRad(this.hfov);
    let vf = 2 * Math.atan(Math.tan(hf / 2) / aspect);
    vf = THREE.MathUtils.clamp(vf, THREE.MathUtils.degToRad(40), THREE.MathUtils.degToRad(80));
    this.camera.fov = THREE.MathUtils.radToDeg(vf);
    this.camera.updateProjectionMatrix();
  }

  shake(amp: number, time = 0.25): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = Math.max(this.shakeT, time);
  }

  updateShake(dt: number): void {
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * Math.max(0, this.shakeT) * 4;
      this.shakeOffset.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, 0);
      if (this.shakeT <= 0) this.shakeAmp = 0;
    } else this.shakeOffset.set(0, 0, 0);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

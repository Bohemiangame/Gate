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

  /** CSS pixels per rendered pixel (1 = native sharpness capped at DPR 2, 3 = chunky pixel art). */
  pixelSize = 0;
  /** When set, use this vertical FOV instead of deriving it from hfov. */
  vfov = 0;

  /** Depth-based dark outlines (pixel-art look); only used with pixelSize > 1. */
  outline = false;
  private rt: THREE.WebGLRenderTarget | null = null;
  private post: { scene: THREE.Scene; cam: THREE.OrthographicCamera; mat: THREE.ShaderMaterial } | null = null;

  setPixelSize(px: number): void {
    this.pixelSize = px;
    const canvas = this.renderer.domElement;
    canvas.style.imageRendering = px > 1 ? 'pixelated' : '';
    this.renderer.setPixelRatio(px > 0 ? 1 / px : Math.min(window.devicePixelRatio || 1, 2));
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.vfov) {
      this.camera.aspect = w / h;
      this.camera.fov = this.vfov;
      this.camera.updateProjectionMatrix();
      return;
    }
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
    if (!this.outline) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (!this.rt || this.rt.width !== size.x || this.rt.height !== size.y) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(size.x, size.y, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthTexture: new THREE.DepthTexture(size.x, size.y),
        colorSpace: THREE.SRGBColorSpace,
      });
      if (!this.post) {
        const mat = new THREE.ShaderMaterial({
          uniforms: { tColor: { value: null }, tDepth: { value: null }, texel: { value: new THREE.Vector2() }, near: { value: 0.1 }, far: { value: 100 }, strength: { value: 0.75 } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
          fragmentShader: `
            uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 texel; uniform float near; uniform float far; uniform float strength;
            varying vec2 vUv;
            float lin(float d){ float z = d * 2.0 - 1.0; return (2.0 * near * far) / (far + near - z * (far - near)); }
            void main(){
              vec4 c = texture2D(tColor, vUv);
              float d = lin(texture2D(tDepth, vUv).x);
              float e = 0.0;
              e = max(e, lin(texture2D(tDepth, vUv + vec2(texel.x, 0.0)).x) - d);
              e = max(e, lin(texture2D(tDepth, vUv - vec2(texel.x, 0.0)).x) - d);
              e = max(e, lin(texture2D(tDepth, vUv + vec2(0.0, texel.y)).x) - d);
              e = max(e, lin(texture2D(tDepth, vUv - vec2(0.0, texel.y)).x) - d);
              float edge = smoothstep(0.006, 0.016, e / d);
              gl_FragColor = vec4(mix(c.rgb, c.rgb * 0.22, edge * strength), 1.0);
              #include <colorspace_fragment>
            }`,
          depthTest: false,
          depthWrite: false,
        });
        const scene = new THREE.Scene();
        scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
        this.post = { scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mat };
      }
    }
    const u = this.post!.mat.uniforms;
    u.tColor.value = this.rt.texture;
    u.tDepth.value = this.rt.depthTexture;
    u.texel.value.set(1 / size.x, 1 / size.y);
    u.near.value = this.camera.near;
    u.far.value = this.camera.far;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.post!.scene, this.post!.cam);
  }
}

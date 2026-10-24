const el = <T extends HTMLElement = HTMLElement>(html: string): T => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
};

const CSS = `
.pz { position: absolute; inset: 0; pointer-events: none; font-family: 'Trebuchet MS', system-ui, sans-serif; color: #fff; user-select: none; -webkit-user-select: none; }
.pz button { pointer-events: auto; font-family: inherit; }
.pz .p-steer { position: absolute; left: 0; top: 0; bottom: 0; width: 48%; pointer-events: auto; touch-action: none; }
.pz .p-track { position: absolute; width: 220px; height: 54px; margin: -27px 0 0 -110px; border-radius: 27px; background: rgba(10,12,30,0.45); border: 2px solid rgba(120,200,255,0.35); left: calc(env(safe-area-inset-left) + 150px); top: calc(100% - 80px); transition: opacity .2s; }
.pz .p-track i { position: absolute; left: 50%; top: 8px; bottom: 8px; width: 2px; margin-left: -1px; background: rgba(255,255,255,0.25); }
.pz .p-knob { position: absolute; left: 50%; top: 50%; width: 50px; height: 50px; margin: -25px 0 0 -25px; border-radius: 50%; background: radial-gradient(circle at 40% 35%, #9be8ff, #2a8ad0); box-shadow: 0 0 16px rgba(80,200,255,0.7); }
.pz .p-btn { position: absolute; border: 0; border-radius: 50%; font-weight: 900; letter-spacing: 1px; color: #fff; touch-action: none; }
.pz .p-brake { width: 96px; height: 96px; right: calc(env(safe-area-inset-right) + 28px); bottom: 26px; background: radial-gradient(circle at 40% 35%, #ff6a5a, #b0201a); box-shadow: 0 0 18px rgba(255,60,40,0.55); font-size: 17px; }
.pz .p-drift { width: 78px; height: 78px; right: calc(env(safe-area-inset-right) + 138px); bottom: 20px; background: radial-gradient(circle at 40% 35%, #ffd36a, #c07a10); box-shadow: 0 0 16px rgba(255,180,40,0.5); font-size: 14px; }
.pz .p-btn.down { filter: brightness(1.5); transform: scale(0.94); }
.pz .p-cam { position: absolute; right: calc(env(safe-area-inset-right) + 12px); top: 10px; width: 46px; height: 46px; border-radius: 12px; border: 0; background: rgba(10,12,30,0.55); color: #9be8ff; font-size: 20px; }
.pz .p-speed { position: absolute; right: calc(env(safe-area-inset-right) + 140px); bottom: 110px; font-size: 30px; font-weight: 900; text-shadow: 0 0 10px rgba(80,200,255,0.8); text-align: right; }
.pz .p-speed small { font-size: 12px; opacity: 0.7; }
.pz .p-top { position: absolute; left: 50%; top: 8px; transform: translateX(-50%); padding: 6px 16px; border-radius: 12px; background: rgba(10,12,30,0.55); font-size: 14px; white-space: nowrap; }
.pz .p-rotate { position: absolute; inset: 0; background: #0a0a1e; display: flex; flex-direction: column; align-items: center; justify-content: center; font-weight: 900; pointer-events: auto; z-index: 5; }
.pz .p-rotate div { font-size: 64px; color: #9be8ff; }
.pz .hidden { display: none; }
`;

/** Landscape driving HUD: left half = steering slider (touch-relative), right = BRAKE + DRIFT. */
export class PizzaHud {
  readonly root: HTMLElement;
  /** -1 (full left) … 1 (full right). */
  steer = 0;
  brake = false;
  drift = false;
  onCamera: () => void = () => {};
  private track: HTMLElement;
  private knob: HTMLElement;
  private speed: HTMLElement;
  private top: HTMLElement;
  private rotate: HTMLElement;
  private steerId: number | null = null;
  private steerX0 = 0;

  constructor(parent: HTMLElement) {
    if (!document.getElementById('pz-css')) {
      const s = document.createElement('style');
      s.id = 'pz-css';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    this.root = el(`<div class="pz"></div>`);
    const steerZone = el(`<div class="p-steer"></div>`);
    this.track = el(`<div class="p-track"><i></i><div class="p-knob"></div></div>`);
    this.knob = this.track.querySelector('.p-knob') as HTMLElement;
    steerZone.appendChild(this.track);
    const brake = el<HTMLButtonElement>(`<button class="p-btn p-brake">BRZDA</button>`);
    const drift = el<HTMLButtonElement>(`<button class="p-btn p-drift">DRIFT</button>`);
    const cam = el<HTMLButtonElement>(`<button class="p-cam">⌖</button>`);
    this.speed = el(`<div class="p-speed">0<small> km/h</small></div>`);
    this.top = el(`<div class="p-top"></div>`);
    this.rotate = el(`<div class="p-rotate hidden"><div>⟳</div><p>Otoč telefón na šírku</p></div>`);
    this.root.append(steerZone, brake, drift, cam, this.speed, this.top, this.rotate);
    parent.appendChild(this.root);

    // steering slider: the track centres on the touch-down point, the knob follows the thumb
    const halfRange = 95;
    steerZone.addEventListener('pointerdown', (e) => {
      if (this.steerId !== null) return;
      this.steerId = e.pointerId;
      steerZone.setPointerCapture(e.pointerId);
      this.steerX0 = e.clientX;
      const r = steerZone.getBoundingClientRect();
      this.track.style.left = `${Math.max(120, Math.min(r.width - 120, e.clientX - r.left))}px`;
      this.track.style.top = `${e.clientY - r.top}px`;
    });
    steerZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.steerId) return;
      this.steer = Math.max(-1, Math.min(1, (e.clientX - this.steerX0) / halfRange));
      this.knob.style.transform = `translateX(${this.steer * halfRange}px)`;
    });
    const endSteer = (e: PointerEvent) => {
      if (e.pointerId !== this.steerId) return;
      this.steerId = null;
      this.steer = 0;
      this.knob.style.transform = '';
    };
    steerZone.addEventListener('pointerup', endSteer);
    steerZone.addEventListener('pointercancel', endSteer);

    const hold = (b: HTMLButtonElement, set: (on: boolean) => void) => {
      b.addEventListener('pointerdown', (e) => {
        b.setPointerCapture(e.pointerId);
        b.classList.add('down');
        set(true);
      });
      const up = () => {
        b.classList.remove('down');
        set(false);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    };
    hold(brake, (on) => (this.brake = on));
    hold(drift, (on) => (this.drift = on));
    cam.addEventListener('click', () => this.onCamera());
  }

  setSpeed(kmh: number): void {
    const t = `${Math.round(kmh)}<small> km/h</small>`;
    if (this.speed.innerHTML !== t) this.speed.innerHTML = t;
  }

  setTop(html: string): void {
    if (this.top.innerHTML !== html) this.top.innerHTML = html;
  }

  setRotateHint(on: boolean): void {
    this.rotate.classList.toggle('hidden', !on);
  }
}

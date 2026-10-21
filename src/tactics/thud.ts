const el = <T extends HTMLElement = HTMLElement>(html: string): T => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
};

/**
 * Landscape HUD for the tactics mode:
 * left thumb = aim pad (moves the on-screen crosshair), right thumb = FIRE (one tap = one shot),
 * ◀ ▶ next to the sheriff slide him along his cover.
 */
export class TacticsHud {
  readonly root: HTMLElement;
  readonly aimPad: HTMLElement;
  readonly fireBtn: HTMLButtonElement;
  readonly slideL: HTMLButtonElement;
  readonly slideR: HTMLButtonElement;
  private cursor: HTMLElement;
  private top: HTMLElement;
  private squads: HTMLElement;
  private hp: HTMLElement;
  private ammo: HTMLElement;
  private banner: HTMLElement;
  private bannerT = 0;
  private floaters: { el: HTMLElement; t: number; x: number; y: number }[] = [];
  private screen: HTMLElement;
  private rotate: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el(`<div class="tac"></div>`);
    parent.appendChild(this.root);
    this.top = el(`<div class="t-top"></div>`);
    this.squads = el(`<div class="t-squads"></div>`);
    this.hp = el(`<div class="t-hp"><b>ŠERIF</b><div class="bar"><em></em></div></div>`);
    this.aimPad = el(`<div class="t-aimpad left"><div class="knob"></div><span>MIERENIE</span></div>`);
    this.fireBtn = el<HTMLButtonElement>(`<button class="t-fire">PAĽ</button>`);
    this.ammo = el(`<div class="t-sammo"></div>`);
    this.slideL = el<HTMLButtonElement>(`<button class="t-slide hidden">◀</button>`);
    this.slideR = el<HTMLButtonElement>(`<button class="t-slide hidden">▶</button>`);
    this.cursor = el(`<div class="t-cursor"><i></i></div>`);
    this.banner = el(`<div class="t-banner hidden"></div>`);
    this.screen = el(`<div class="screen hidden"></div>`);
    this.rotate = el(`<div class="t-rotate hidden"><div>⟳</div><p>Otoč telefón na šírku</p></div>`);
    this.root.append(this.cursor, this.top, this.squads, this.hp, this.aimPad, this.fireBtn, this.ammo, this.slideL, this.slideR, this.banner, this.screen, this.rotate);
  }

  setTop(html: string): void {
    if (this.top.innerHTML !== html) this.top.innerHTML = html;
  }

  setSquads(html: string): void {
    if (this.squads.innerHTML !== html) this.squads.innerHTML = html;
  }

  setHp(frac: number): void {
    (this.hp.querySelector('em') as HTMLElement).style.width = `${Math.max(0, frac) * 100}%`;
  }

  setAmmo(text: string, urgent: boolean): void {
    this.ammo.textContent = text;
    this.ammo.classList.toggle('urgent', urgent);
  }

  setPad(active: boolean, kx: number, ky: number): void {
    this.aimPad.classList.toggle('active', active);
    (this.aimPad.querySelector('.knob') as HTMLElement).style.transform = `translate(${kx}px, ${ky}px)`;
  }

  /** state: '' | 'lock' | 'head' */
  setCursor(x: number, y: number, state: string, visible = true): void {
    this.cursor.style.transform = `translate(${x}px, ${y}px)`;
    this.cursor.className = `t-cursor ${state}${visible ? '' : ' hidden'}`;
  }

  setSlides(x: number, y: number, left: boolean, right: boolean): void {
    this.slideL.classList.toggle('hidden', !left);
    this.slideR.classList.toggle('hidden', !right);
    this.slideL.style.transform = `translate(${x - 70}px, ${y - 22}px)`;
    this.slideR.style.transform = `translate(${x + 26}px, ${y - 22}px)`;
  }

  firePressed(on: boolean): void {
    this.fireBtn.classList.toggle('down', on);
  }

  showBanner(text: string, cls = '', t = 1.6): void {
    this.banner.className = `t-banner ${cls}`;
    this.banner.innerHTML = text;
    this.bannerT = t;
  }

  float(text: string, x: number, y: number, cls = ''): void {
    const f = el(`<div class="floater ${cls}">${text}</div>`);
    this.root.appendChild(f);
    this.floaters.push({ el: f, t: 0.9, x, y });
  }

  setRotateHint(on: boolean): void {
    this.rotate.classList.toggle('hidden', !on);
  }

  openScreen(html: string, buttons: { label: string; cls?: string; onClick: () => void }[]): void {
    this.screen.className = 'screen';
    this.screen.innerHTML = `<div class="panel">${html}<div class="buttons"></div></div>`;
    const bar = this.screen.querySelector('.buttons')!;
    for (const b of buttons) {
      const e = document.createElement('button');
      e.className = `btn ${b.cls ?? ''}`;
      e.innerHTML = b.label;
      e.addEventListener('click', (ev) => {
        ev.stopPropagation();
        b.onClick();
      });
      bar.appendChild(e);
    }
  }

  update(dt: number): void {
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      this.banner.classList.toggle('hidden', this.bannerT <= 0);
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t -= dt;
      f.y -= 40 * dt;
      f.el.style.transform = `translate(${f.x}px, ${f.y}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(Math.min(1, f.t * 3));
      if (f.t <= 0) {
        f.el.remove();
        this.floaters.splice(i, 1);
      }
    }
  }
}

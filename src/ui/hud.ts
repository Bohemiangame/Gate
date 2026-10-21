import { audio } from '../audio';

const $ = <T extends HTMLElement = HTMLElement>(html: string): T => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
};

interface Floater {
  el: HTMLDivElement;
  life: number;
  max: number;
  x: number;
  y: number;
  vy: number;
}

export interface ButtonDef {
  label: string;
  cls?: string;
  onClick: () => void;
  disabled?: boolean;
}

/** DOM overlay: top bar, posse counter, ammo, Dead Eye, boss bar, floating texts, screens. */
export class Hud {
  readonly root: HTMLElement;
  private top: HTMLElement;
  private levelName: HTMLElement;
  private progress: HTMLElement;
  private coins: HTMLElement;
  private posse: HTMLElement;
  private ammo: HTMLElement;
  private reloadTxt: HTMLElement;
  private deadEyeBtn: HTMLButtonElement;
  private deadEyeFill: HTMLElement;
  private bossBar: HTMLElement;
  private bossFill: HTMLElement;
  private hintEl: HTMLElement;
  private banner: HTMLElement;
  private weaponEl: HTMLElement;
  private screen: HTMLElement;
  private vignette: HTMLElement;
  private damageFlash: HTMLElement;
  private floaters: Floater[] = [];
  private pool: HTMLDivElement[] = [];
  private bannerT = 0;
  private lastAmmo = '';
  onDeadEye: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = parent;
    this.vignette = $(`<div class="vignette"></div>`);
    this.damageFlash = $(`<div class="dmgflash"></div>`);
    this.top = $(`<div class="topbar">
      <div class="lvl"><span class="lvlname"></span><div class="prog"><div class="progfill"></div></div></div>
      <div class="coins">$ <b>0</b></div>
    </div>`);
    this.levelName = this.top.querySelector('.lvlname')!;
    this.progress = this.top.querySelector('.progfill')!;
    this.coins = this.top.querySelector('.coins b')!;
    this.bossBar = $(`<div class="bossbar hidden"><div class="bossname">ŠÉF BANDY</div><div class="bosstrack"><div class="bossfill"></div></div></div>`);
    this.bossFill = this.bossBar.querySelector('.bossfill')!;
    this.posse = $(`<div class="posse hidden">3</div>`);
    this.ammo = $(`<div class="ammo hidden"></div>`);
    this.reloadTxt = $(`<div class="reloadtxt hidden">NABÍJAM…</div>`);
    this.weaponEl = $(`<div class="weapon hidden"></div>`);
    this.deadEyeBtn = $<HTMLButtonElement>(`<button class="deadeye hidden"><div class="defill"></div><span>DEAD<br>EYE</span></button>`);
    this.deadEyeFill = this.deadEyeBtn.querySelector('.defill')!;
    this.deadEyeBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.onDeadEye();
    });
    this.hintEl = $(`<div class="hint hidden"></div>`);
    this.banner = $(`<div class="banner hidden"></div>`);
    this.screen = $(`<div class="screen hidden"></div>`);
    parent.append(this.vignette, this.damageFlash, this.top, this.bossBar, this.posse, this.ammo, this.reloadTxt, this.weaponEl, this.deadEyeBtn, this.hintEl, this.banner, this.screen);
  }

  show(el: 'top' | 'posse' | 'ammo' | 'deadeye' | 'boss' | 'weapon', on: boolean): void {
    const map = { top: this.top, posse: this.posse, ammo: this.ammo, deadeye: this.deadEyeBtn, boss: this.bossBar, weapon: this.weaponEl };
    map[el].classList.toggle('hidden', !on);
    if (el === 'ammo' && !on) this.reloadTxt.classList.add('hidden');
  }

  setLevel(name: string): void {
    this.levelName.textContent = name;
  }
  setProgress(p: number): void {
    this.progress.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
  }
  setCoins(n: number): void {
    this.coins.textContent = String(n);
  }
  setWeapon(name: string): void {
    this.weaponEl.textContent = name;
  }

  setPosse(n: number, x: number, y: number): void {
    const s = String(n);
    if (this.posse.textContent !== s) {
      this.posse.textContent = s;
      this.posse.classList.remove('pop');
      void this.posse.offsetWidth;
      this.posse.classList.add('pop');
    }
    this.posse.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }

  setAmmo(cur: number, max: number, reloading: boolean): void {
    const key = `${cur}/${max}/${reloading}`;
    if (key === this.lastAmmo) return;
    this.lastAmmo = key;
    let h = '';
    for (let i = 0; i < max; i++) h += `<i class="${i < cur ? 'full' : ''}"></i>`;
    this.ammo.innerHTML = h;
    this.reloadTxt.classList.toggle('hidden', !reloading || cur >= max);
    this.reloadTxt.textContent = cur === 0 ? 'PREBI – PUSTI PRST!' : 'NABÍJAM…';
    this.reloadTxt.classList.toggle('urgent', cur === 0);
  }

  setDeadEye(charge: number, active: boolean): void {
    this.deadEyeFill.style.height = `${Math.round(Math.min(1, charge) * 100)}%`;
    this.deadEyeBtn.classList.toggle('ready', charge >= 1 && !active);
    this.deadEyeBtn.classList.toggle('active', active);
    this.vignette.classList.toggle('on', active);
  }

  setBoss(frac: number): void {
    this.bossFill.style.width = `${Math.max(0, frac) * 100}%`;
  }

  hint(text: string | null): void {
    this.hintEl.classList.toggle('hidden', !text);
    if (text) this.hintEl.innerHTML = text;
  }

  showBanner(text: string, cls = '', time = 1.3): void {
    this.banner.className = `banner ${cls}`;
    this.banner.innerHTML = text;
    this.bannerT = time;
  }

  hurt(): void {
    this.damageFlash.classList.remove('on');
    void this.damageFlash.offsetWidth;
    this.damageFlash.classList.add('on');
  }

  float(text: string, x: number, y: number, cls = ''): void {
    const el = this.pool.pop() ?? (document.createElement('div') as HTMLDivElement);
    el.className = `floater ${cls}`;
    el.textContent = text;
    this.root.appendChild(el);
    this.floaters.push({ el, life: 0.9, max: 0.9, x: x + (Math.random() - 0.5) * 16, y, vy: -60 });
  }

  update(dt: number): void {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      f.y += f.vy * dt;
      f.vy *= 0.95;
      const t = f.life / f.max;
      f.el.style.transform = `translate(${f.x}px, ${f.y}px) translate(-50%, -50%) scale(${0.8 + Math.min(1, (1 - t) * 6) * 0.4})`;
      f.el.style.opacity = String(Math.min(1, t * 3));
      if (f.life <= 0) {
        f.el.remove();
        this.pool.push(f.el);
        this.floaters.splice(i, 1);
      }
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      this.banner.classList.toggle('hidden', this.bannerT <= 0);
    }
  }

  // ---------- Screens ----------
  openScreen(html: string, buttons: ButtonDef[] = [], cls = ''): HTMLElement {
    this.screen.className = `screen ${cls}`;
    this.screen.innerHTML = `<div class="panel">${html}<div class="buttons"></div></div>`;
    const bar = this.screen.querySelector('.buttons')!;
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = `btn ${b.cls ?? ''}`;
      el.innerHTML = b.label;
      el.disabled = !!b.disabled;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        audio.unlock();
        audio.play('click');
        b.onClick();
      });
      bar.appendChild(el);
    }
    return this.screen;
  }

  closeScreen(): void {
    this.screen.className = 'screen hidden';
    this.screen.innerHTML = '';
  }

  get screenOpen(): boolean {
    return !this.screen.classList.contains('hidden');
  }
}

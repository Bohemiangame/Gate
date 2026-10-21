import type { GroupId } from './units';

const el = <T extends HTMLElement = HTMLElement>(html: string): T => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
};

export interface CardInfo {
  id: GroupId;
  name: string;
  alive: number;
  total: number;
  hp: number; // 0..1 (sheriff)
  ammo: string;
  stance: 'fire' | 'hold';
}

/** Landscape HUD for the tactics mode. */
export class TacticsHud {
  readonly root: HTMLElement;
  readonly aimPad: HTMLElement;
  private cards = new Map<GroupId, HTMLElement>();
  private top: HTMLElement;
  private orders: HTMLElement;
  private fireBtn: HTMLButtonElement;
  private holdBtn: HTMLButtonElement;
  private sheriffAmmo: HTMLElement;
  private banner: HTMLElement;
  private bannerT = 0;
  private floaters: { el: HTMLElement; t: number; x: number; y: number }[] = [];
  private screen: HTMLElement;
  private rotate: HTMLElement;
  onSelect: (g: GroupId) => void = () => {};
  onStance: (s: 'fire' | 'hold') => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = el(`<div class="tac"></div>`);
    parent.appendChild(this.root);
    const cardsBox = el(`<div class="t-cards"></div>`);
    for (const [id, name, cls] of [
      ['S', 'ŠERIF', 'sheriff'],
      ['A', 'SKUPINA A', 'a'],
      ['B', 'SKUPINA B', 'b'],
    ] as const) {
      const c = el(`<button class="t-card ${cls}"><b>${name}</b><span class="dots"></span><small class="t-ammo"></small><i class="stance"></i></button>`);
      c.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.onSelect(id);
      });
      this.cards.set(id, c);
      cardsBox.appendChild(c);
    }
    this.top = el(`<div class="t-top"></div>`);
    this.orders = el(`<div class="t-orders"></div>`);
    this.fireBtn = el<HTMLButtonElement>(`<button class="t-btn fire">PAĽBA</button>`);
    this.holdBtn = el<HTMLButtonElement>(`<button class="t-btn hold">KRYT</button>`);
    for (const [b, s] of [
      [this.fireBtn, 'fire'],
      [this.holdBtn, 'hold'],
    ] as const)
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.onStance(s);
      });
    this.orders.append(this.fireBtn, this.holdBtn);
    this.aimPad = el(`<div class="t-aimpad"><div class="knob"></div><span>MIER</span></div>`);
    this.sheriffAmmo = el(`<div class="t-sammo"></div>`);
    this.banner = el(`<div class="t-banner hidden"></div>`);
    this.screen = el(`<div class="screen hidden"></div>`);
    this.rotate = el(`<div class="t-rotate hidden"><div>⟳</div><p>Otoč telefón na šírku</p></div>`);
    this.root.append(cardsBox, this.top, this.orders, this.aimPad, this.sheriffAmmo, this.banner, this.screen, this.rotate);
  }

  setCards(cards: CardInfo[], selected: GroupId | null, ordersFor: GroupId | null): void {
    for (const c of cards) {
      const e = this.cards.get(c.id)!;
      e.classList.toggle('sel', selected === c.id);
      e.classList.toggle('dead', c.alive === 0);
      const dots = c.id === 'S' ? `<em style="width:${Math.round(c.hp * 100)}%"></em>` : '●'.repeat(c.alive) + '○'.repeat(Math.max(0, c.total - c.alive));
      const d = e.querySelector('.dots')!;
      if (d.innerHTML !== dots) d.innerHTML = dots;
      (e.querySelector(".t-ammo") as HTMLElement).textContent = c.ammo;
      (e.querySelector('.stance') as HTMLElement).textContent = c.id === 'S' ? '' : c.stance === 'fire' ? 'PAĽBA' : 'KRYT';
    }
    this.orders.classList.toggle('hidden', !ordersFor || ordersFor === 'S');
    const st = cards.find((c) => c.id === ordersFor)?.stance;
    this.fireBtn.classList.toggle('on', st === 'fire');
    this.holdBtn.classList.toggle('on', st === 'hold');
  }

  setTop(html: string): void {
    if (this.top.innerHTML !== html) this.top.innerHTML = html;
  }

  setSheriffAmmo(text: string, urgent: boolean): void {
    this.sheriffAmmo.textContent = text;
    this.sheriffAmmo.classList.toggle('urgent', urgent);
  }

  setPad(active: boolean, kx: number, ky: number): void {
    this.aimPad.classList.toggle('active', active);
    (this.aimPad.querySelector('.knob') as HTMLElement).style.transform = `translate(${kx}px, ${ky}px)`;
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

  closeScreen(): void {
    this.screen.className = 'screen hidden';
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

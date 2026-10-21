import * as THREE from 'three';
import type { View } from '../engine/view';
import { voxelMaterial } from '../engine/voxel';
import { CharacterBatcher } from '../gfx/batcher';
import { characters } from '../gfx/character';
import { makeCharacter } from '../gfx/models';
import { buildBackdrop, buildBuilding } from '../gfx/town';
import { PAL } from '../gfx/palette';
import { audio } from '../audio';
import { Mission, MissionResult, missionWaves, SquadMember } from './mission';
import { buildInterior, ShopKind } from './interiors';
import { MapKind, MAP_NAMES } from './map';
import { TB } from './tbalance';
import {
  AMMO_NAME,
  AMMO_OF,
  AmmoType,
  autoSquads,
  Campaign,
  CARRY,
  clearCampaign,
  hire,
  loadCampaign,
  MAX_ROSTER,
  newCampaign,
  PRICES,
  refreshSaloon,
  saveCampaign,
  SHERIFF_CARRY,
  SQUAD_SIZE,
} from './campaign';

const SHOPS: { kind: ShopKind; sign: string; label: string; width: number; stories: number; bk: 'guns' | 'store' | 'saloon' | 'plain' | 'sheriff' }[] = [
  { kind: 'guns', sign: 'GUNS', label: 'ZBROJNICA', width: 44, stories: 1, bk: 'guns' },
  { kind: 'store', sign: 'STORE', label: 'OBCHOD', width: 44, stories: 2, bk: 'store' },
  { kind: 'saloon', sign: 'SALOON', label: 'SALOON', width: 52, stories: 2, bk: 'saloon' },
  { kind: 'doctor', sign: 'DOCTOR', label: 'DOKTOR', width: 44, stories: 1, bk: 'plain' },
  { kind: 'sheriff', sign: 'SHERIFF', label: 'ŠERIF', width: 44, stories: 1, bk: 'sheriff' },
];

const KEEPER_LINE: Record<ShopKind, string> = {
  guns: '„Dobrá zbraň je polovica víťazstva, šerif. Tú druhú polovicu si musíš priniesť sám.“',
  store: '„Náboje, broky, všetko na sklade. Na úver nedávam.“',
  saloon: '„Hľadáš chlapov? Pár ich tu sedí a za pár dolárov pôjdu aj do pekla.“',
  doctor: '„Prines mi ich živých a ja ich dám dokopy.“',
  sheriff: '„Kancelária je tvoja, šerif. Rozdeľ mužov a vylepši sa.“',
};

const WEAPON_NAME: Record<string, string> = { revolver: 'Revolver', rifle: 'Puška', shotgun: 'Brokovnica' };

export class TacticsApp {
  c: Campaign;
  private root = new THREE.Group();
  private ui: HTMLElement;
  private layer: HTMLElement;
  private batcher: CharacterBatcher;
  private mission: Mission | null = null;
  private mode: 'town' | 'shop' | 'mission' = 'town';
  private shop: ShopKind | null = null;
  private time = 0;
  private buildingBoxes: { kind: ShopKind; x0: number; x1: number }[] = [];
  private lastResult: string | null = null;
  private assignWeapon: 'rifle' | 'shotgun' | null = null;

  constructor(
    readonly view: View,
    ui: HTMLElement,
  ) {
    this.ui = ui;
    this.c = loadCampaign() ?? newCampaign();
    view.vfov = TB.camFov;
    view.setPixelSize(TB.pixelSize);
    view.outline = true;
    view.camera.far = 200;
    this.batcher = new CharacterBatcher(view.scene);
    this.layer = document.createElement('div');
    this.layer.className = 'hub';
    ui.appendChild(this.layer);
    view.renderer.domElement.addEventListener('pointerup', (e) => this.onTap(e));
    this.showTown();
  }

  // =====================================================================
  // Scene helpers
  // =====================================================================
  private clear(): void {
    for (const ch of [...characters]) ch.dispose();
    this.view.scene.remove(this.root);
    this.root = new THREE.Group();
    this.view.scene.add(this.root);
    this.layer.innerHTML = '';
  }

  update(dt: number): void {
    this.time += dt;
    if (this.mode === 'mission' && this.mission) {
      this.mission.update(dt);
      return;
    }
    for (const ch of characters) ch.update(dt);
    this.batcher.sync();
  }

  private readyMen() {
    return this.c.roster.filter((m) => m.wounded === 0);
  }

  // =====================================================================
  // Town
  // =====================================================================
  showTown(): void {
    this.mode = 'town';
    this.shop = null;
    this.clear();
    const scene = this.view.scene;
    scene.fog = new THREE.Fog(0xf0c890, 40, 120);
    const backdrop = buildBackdrop();
    backdrop.scale.setScalar(0.9);
    this.root.add(backdrop);
    const groundM = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: PAL.dirt }));
    groundM.rotation.x = -Math.PI / 2;
    this.root.add(groundM);
    // shop row
    let x = -SHOPS.reduce((a, s) => a + s.width * 0.125 + 0.4, 0) / 2;
    this.buildingBoxes = [];
    for (const s of SHOPS) {
      const v = buildBuilding({ kind: s.bk, sign: s.sign, width: s.width, twoStory: s.stories > 1, stories: s.stories }, 900 + s.width + s.sign.length);
      const cx = x + v.widthM / 2;
      const m = new THREE.Mesh(v.geo, voxelMaterial);
      m.position.set(cx, 0, -4);
      this.root.add(m);
      this.buildingBoxes.push({ kind: s.kind, x0: x, x1: x + v.widthM });
      x += v.widthM + 0.4;
    }
    // the posse waiting in the street
    const sheriff = makeCharacter('sheriff', 0, this.c.sheriff.weapon);
    sheriff.root.position.set(0, 0, 3);
    sheriff.root.rotation.y = 0.2;
    this.root.add(sheriff.root);
    this.readyMen().forEach((m, i) => {
      const ch = makeCharacter(m.squad === 'B' ? 'posseB' : 'posse', m.variant, m.weapon);
      const k = i + 1;
      ch.root.position.set((k % 2 ? -1 : 1) * Math.ceil(k / 2) * 1.0, 0, 3.6 + (k % 3) * 0.3);
      ch.root.rotation.y = (Math.random() - 0.5) * 0.8;
      this.root.add(ch.root);
    });
    this.view.camera.position.set(0, 4.8, 16);
    this.view.camera.lookAt(0, 2.4, -3);
    this.view.resize();

    const ready = this.readyMen().length;
    const inSquads = this.c.roster.filter((m) => m.squad && m.wounded === 0).length;
    this.layer.innerHTML = `
      <div class="h-top">
        <b>DUSTY GULCH</b> · misia ${this.c.mission + 1} · <span class="money">${this.c.money} $</span> · mužov ${ready}/${this.c.roster.length} · ${AMMO_NAME.r45}: ${this.c.ammo.r45}
      </div>
      <div class="h-shops">${SHOPS.map((s) => `<button class="t-btn" data-shop="${s.kind}">${s.label}</button>`).join('')}</div>
      <button class="btn h-go" data-go="1">NA MISIU ▶<small>${inSquads} mužov v skupinách</small></button>
      <button class="t-btn h-reset" data-reset="1">nová hra</button>
      ${this.lastResult ? `<div class="h-result panel">${this.lastResult}<div class="buttons"><button class="btn" data-close="1">OK</button></div></div>` : ''}`;
    this.bindLayer();
  }

  private onTap(e: PointerEvent): void {
    if (this.mode !== 'town') return;
    const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.view.camera);
    // facade plane z = -6 (porch front at -4)
    const t = (-6 - ray.ray.origin.z) / ray.ray.direction.z;
    if (t <= 0) return;
    const p = ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
    if (p.y < 0 || p.y > 9) return;
    const b = this.buildingBoxes.find((bb) => p.x >= bb.x0 && p.x <= bb.x1);
    if (b) this.openShop(b.kind);
  }

  private bindLayer(): void {
    this.layer.querySelectorAll<HTMLElement>('[data-shop]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        audio.unlock();
        audio.play('click');
        this.openShop(b.dataset.shop as ShopKind);
      }),
    );
    this.layer.querySelector('[data-go]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.unlock();
      this.startMission();
    });
    this.layer.querySelector('[data-reset]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Začať novú hru? Postup sa vymaže.')) return;
      clearCampaign();
      this.c = newCampaign();
      this.lastResult = null;
      this.showTown();
    });
    this.layer.querySelector('[data-close]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.lastResult = null;
      this.showTown();
    });
  }

  // =====================================================================
  // Shops
  // =====================================================================
  openShop(kind: ShopKind): void {
    this.mode = 'shop';
    this.shop = kind;
    this.assignWeapon = null;
    this.clear();
    this.view.scene.fog = null;
    const extra = kind === 'saloon' ? this.c.saloon.length : kind === 'doctor' ? Math.min(2, this.c.roster.filter((m) => m.wounded > 0).length) : 0;
    const it = buildInterior(kind, this.root, extra);
    // camera: room on the left, panel on the right
    this.view.camera.position.set(1.6, 2.0, 4.6);
    this.view.camera.lookAt(1.2, 1.25, -0.6);
    this.renderShop();
    void it;
  }

  private renderShop(): void {
    const kind = this.shop!;
    const c = this.c;
    const row = (title: string, desc: string, btn: string, action: string, disabled = false) =>
      `<div class="shoprow"><div class="info"><b>${title}</b><small>${desc}</small></div><button class="btn gold" data-a="${action}" ${disabled ? 'disabled' : ''}>${btn}</button></div>`;
    let body = '';
    switch (kind) {
      case 'guns':
        if (this.assignWeapon) {
          body += `<p><b>Komu dáš ${WEAPON_NAME[this.assignWeapon].toLowerCase()}?</b></p>`;
          for (const m of c.roster) body += row(m.name, `${WEAPON_NAME[m.weapon]}${m.wounded ? ' · zranený' : ''}`, 'DAŤ', `give:${m.id}`, m.weapon === this.assignWeapon);
          body += `<div class="buttons"><button class="btn alt" data-a="cancel">ZRUŠIŤ</button></div>`;
        } else {
          body += row('Puška', `Ďaleký dostrel (26 m), silná rana. Strelivo: ${AMMO_NAME.rifle}.`, `${PRICES.rifle} $`, 'buy:rifle', c.money < PRICES.rifle);
          body += row('Brokovnica', `Zblízka smrteľná (4 broky), krátky dostrel. Strelivo: ${AMMO_NAME.shells}.`, `${PRICES.shotgun} $`, 'buy:shotgun', c.money < PRICES.shotgun);
          body += `<p class="sub">Munícia sa kupuje v obchode (STORE).</p>`;
        }
        break;
      case 'store':
        for (const t of ['r45', 'rifle', 'shells'] as AmmoType[]) {
          const p = PRICES.ammo[t];
          const users = c.roster.filter((m) => AMMO_OF[m.weapon] === t).length + (t === 'r45' ? 1 : 0);
          body += row(`${AMMO_NAME[t]} ×${p.qty}`, `Na sklade máš ${c.ammo[t]} · používa ${users}`, `${p.price} $`, `ammo:${t}`, c.money < p.price);
        }
        body += `<p class="sub">Na misiu si každý berie až ${CARRY.r45} nábojov (puška ${CARRY.rifle}, broky ${CARRY.shells}), šerif ${SHERIFF_CARRY}.</p>`;
        break;
      case 'saloon':
        body += `<p>Mužov: <b>${c.roster.length}/${MAX_ROSTER}</b></p>`;
        c.saloon.forEach((s, i) => (body += row(s.name, `${WEAPON_NAME[s.weapon]} · pridá sa k tebe`, `${s.price} $`, `hire:${i}`, c.money < s.price || c.roster.length >= MAX_ROSTER)));
        if (!c.saloon.length) body += `<p class="sub">Dnes tu nikto nesedí. Príď po ďalšej misii.</p>`;
        break;
      case 'doctor': {
        const wounded = c.roster.filter((m) => m.wounded > 0);
        if (!wounded.length) body += `<p class="sub">Nikto nie je zranený.</p>`;
        for (const m of wounded) body += row(m.name, `Vynechá ešte ${m.wounded} misiu`, `${PRICES.healNow} $`, `heal:${m.id}`, c.money < PRICES.healNow);
        const lv = c.doctor;
        const cost = PRICES.doctorUpgrade[lv];
        body += row(`Lepšie ošetrenie ${'●'.repeat(lv)}${'○'.repeat(3 - lv)}`, '+10 % šanca, že padnutý muž prežije (len zranený)', cost ? `${cost} $` : 'MAX', 'doc', !cost || c.money < cost);
        break;
      }
      case 'sheriff': {
        const s = c.sheriff;
        const up = (key: 'hp' | 'acc' | 'reload', name: string, desc: string) => {
          const lv = s[key];
          const prices = key === 'hp' ? PRICES.sheriffHp : key === 'acc' ? PRICES.sheriffAcc : PRICES.sheriffReload;
          const cost = prices[lv];
          return row(`${name} ${'●'.repeat(lv)}${'○'.repeat(3 - lv)}`, desc, cost ? `${cost} $` : 'MAX', `sh:${key}`, !cost || c.money < cost);
        };
        body += up('hp', 'Výdrž', '+1 zásah, kým šerif padne');
        body += up('acc', 'Pevná ruka', 'Presnejšia streľba');
        body += up('reload', 'Rýchle prebíjanie', 'Rýchlejšie nabíjanie revolvera');
        body += `<h2 style="margin-top:12px">Rozdelenie mužov</h2>`;
        for (const m of c.roster)
          body += `<div class="shoprow"><div class="info"><b>${m.name}</b><small>${WEAPON_NAME[m.weapon]} · misií ${m.missions} · zásahov ${m.kills}${m.wounded ? ' · zranený' : ''}</small></div>
            <button class="btn ${m.squad === 'A' ? '' : m.squad === 'B' ? 'gold' : 'alt'}" data-a="sq:${m.id}" ${m.wounded ? 'disabled' : ''}>${m.squad ? 'SKUPINA ' + m.squad : 'DOMA'}</button></div>`;
        break;
      }
    }
    const title = SHOPS.find((s) => s.kind === kind)!.label;
    this.layer.innerHTML = `
      <div class="h-top"><b>${title}</b> · <span class="money">${c.money} $</span></div>
      <div class="h-panel panel"><p class="sub">${KEEPER_LINE[kind]}</p>${body}
        <div class="buttons"><button class="btn alt" data-a="back">◀ SPÄŤ DO MESTA</button></div></div>`;
    this.layer.querySelectorAll<HTMLElement>('[data-a]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        audio.unlock();
        this.shopAction(b.dataset.a!);
      }),
    );
  }

  private pay(n: number): boolean {
    if (this.c.money < n) return false;
    this.c.money -= n;
    audio.play('coin');
    return true;
  }

  private shopAction(a: string): void {
    const c = this.c;
    const [cmd, arg] = a.split(':');
    switch (cmd) {
      case 'back':
        audio.play('click');
        saveCampaign(c);
        this.showTown();
        return;
      case 'cancel':
        this.assignWeapon = null;
        break;
      case 'buy':
        if (c.money >= PRICES[arg as 'rifle' | 'shotgun']) this.assignWeapon = arg as 'rifle' | 'shotgun';
        break;
      case 'give': {
        const m = c.roster.find((r) => r.id === Number(arg));
        const w = this.assignWeapon;
        if (m && w && this.pay(PRICES[w])) {
          m.weapon = w;
          this.assignWeapon = null;
        }
        break;
      }
      case 'ammo': {
        const t = arg as AmmoType;
        if (this.pay(PRICES.ammo[t].price)) c.ammo[t] += PRICES.ammo[t].qty;
        break;
      }
      case 'hire': {
        const cand = c.saloon[Number(arg)];
        if (cand && c.roster.length < MAX_ROSTER && this.pay(cand.price)) {
          hire(c, cand);
          c.saloon.splice(Number(arg), 1);
          autoSquads(c);
        }
        break;
      }
      case 'heal': {
        const m = c.roster.find((r) => r.id === Number(arg));
        if (m && this.pay(PRICES.healNow)) {
          m.wounded = 0;
          autoSquads(c);
        }
        break;
      }
      case 'doc': {
        const cost = PRICES.doctorUpgrade[c.doctor];
        if (cost && this.pay(cost)) c.doctor++;
        break;
      }
      case 'sh': {
        const key = arg as 'hp' | 'acc' | 'reload';
        const prices = key === 'hp' ? PRICES.sheriffHp : key === 'acc' ? PRICES.sheriffAcc : PRICES.sheriffReload;
        const cost = prices[c.sheriff[key]];
        if (cost && this.pay(cost)) c.sheriff[key]++;
        break;
      }
      case 'sq': {
        const m = c.roster.find((r) => r.id === Number(arg));
        if (!m) break;
        const count = (s: 'A' | 'B') => c.roster.filter((r) => r.squad === s && r !== m).length;
        const order: ('A' | 'B' | null)[] = ['A', 'B', null];
        let i = order.indexOf(m.squad);
        for (let k = 0; k < 3; k++) {
          i = (i + 1) % 3;
          const s = order[i];
          if (!s || count(s) < SQUAD_SIZE) break;
        }
        m.squad = order[i];
        audio.play('click');
        break;
      }
    }
    saveCampaign(c);
    if (cmd === 'hire' || cmd === 'heal') this.openShop(this.shop!);
    else this.renderShop();
  }

  // =====================================================================
  // Mission
  // =====================================================================
  private startMission(): void {
    const c = this.c;
    autoSquads(c);
    const men = c.roster.filter((m) => m.squad && m.wounded === 0);
    const squads: SquadMember[] = men.map((m) => {
      const t = AMMO_OF[m.weapon];
      const take = Math.min(CARRY[t], c.ammo[t]);
      c.ammo[t] -= take;
      return { memberId: m.id, group: m.squad!, name: m.name, weapon: m.weapon, variant: m.variant, reserve: take };
    });
    const sheriffAmmo = Math.min(SHERIFF_CARRY, c.ammo.r45);
    c.ammo.r45 -= sheriffAmmo;
    const n = c.mission + 1;
    const mw = missionWaves(n);
    this.clear();
    this.mode = 'mission';
    const before = new Set(c.roster.filter((m) => m.wounded > 0).map((m) => m.id));
    const kinds: MapKind[] = ['plaza', 'plaza', 'desert', 'rail'];
    const mapKind: MapKind = c.mission < kinds.length ? kinds[c.mission] : (['plaza', 'desert', 'rail'] as MapKind[])[c.mission % 3];
    this.mission = new Mission(this.view, this.ui, {
      name: `Misia ${n}: ${MAP_NAMES[mapKind]}`,
      mapKind,
      seed: 1000 + c.mission * 17 + Math.floor(Math.random() * 1000),
      squads,
      sheriff: { weapon: c.sheriff.weapon, hp: TB.sheriffHp + c.sheriff.hp, reserve: sheriffAmmo, acc: c.sheriff.acc, reload: c.sheriff.reload },
      waves: mw.waves,
      enemyHp: mw.enemyHp,
      onEnd: (r) => this.endMission(r, before),
    });
    this.mission.woundedBonus = 0.1 * c.doctor;
    saveCampaign(c);
  }

  private endMission(r: MissionResult, sittingOut: Set<number>): void {
    const c = this.c;
    // ammo back to the store room
    for (const m of c.roster) {
      const left = r.ammoLeft.get(m.id);
      if (left !== undefined) c.ammo[AMMO_OF[m.weapon]] += left;
    }
    const sl = r.ammoLeft.get(-1);
    if (sl !== undefined) c.ammo.r45 += sl;
    // casualties
    const fallenNames: string[] = [];
    const woundedNames: string[] = [];
    c.roster = c.roster.filter((m) => {
      if (r.fallen.includes(m.id)) {
        c.fallen.push(m.name);
        fallenNames.push(m.name);
        return false;
      }
      return true;
    });
    for (const m of c.roster) {
      if (sittingOut.has(m.id)) m.wounded = Math.max(0, m.wounded - 1);
      if (r.wounded.includes(m.id)) {
        m.wounded = 1;
        m.squad = null;
        woundedNames.push(m.name);
      }
      if (r.ammoLeft.has(m.id) || r.wounded.includes(m.id)) m.missions++;
      m.kills += r.killsBy.get(m.id) ?? 0;
    }
    const reward = r.won ? 50 + r.kills * 5 + c.mission * 10 : r.kills * 3;
    c.money += reward;
    if (r.won) c.mission++;
    refreshSaloon(c);
    autoSquads(c);
    saveCampaign(c);
    const list = (a: string[]) => (a.length ? a.join(', ') : '–');
    this.lastResult = `<h1>${r.won ? 'VÝHRA!' : 'ÚSTUP'}</h1>
      <p>${r.won ? 'Banda je rozprášená.' : 'Šerif padol – muži ho odniesli z boja.'} Zneškodnených: <b>${r.kills}</b></p>
      <p class="coinline">+${reward} $</p>
      <p>Padli: <b>${list(fallenNames)}</b> · Zranení (doktor): <b>${list(woundedNames)}</b></p>`;
    this.mission?.dispose();
    this.mission = null;
    this.view.scene.fog = null;
    this.showTown();
  }
}

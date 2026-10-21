import * as THREE from 'three';
import { View } from './engine/view';
import { voxelMaterial } from './engine/voxel';
import { buildBackdrop, buildStreet } from './gfx/town';
import { makeCharacter } from './gfx/models';
import { Character } from './gfx/character';
import { buildBarrel, buildBarricade, buildTntCrate, buildWagon } from './gfx/props';
import { Flashes, Particles, Tracers } from './gfx/effects';
import { Label } from './gfx/label';
import { CharacterBatcher } from './gfx/batcher';
import type { WeaponKind } from './gfx/characterModels';

/**
 * Phase-1 visual showcase: a scripted loop (run down the street, take cover, shoot-out)
 * plus a close-up "lineup" view (?view=lineup) to judge model detail.
 * Not the game – it only exists so the look can be reviewed early.
 */
export function startShowcase(view: View, params: URLSearchParams): void {
  const scene = view.scene;
  const batcher = new CharacterBatcher(scene);
  const origRender = view.render.bind(view);
  view.render = () => {
    batcher.sync();
    origRender();
  };
  const particles = new Particles();
  const tracers = new Tracers();
  const flashes = new Flashes();
  scene.add(particles.mesh, tracers.group, flashes.group);

  if (params.get('view') === 'lineup') return lineup(view, params);

  scene.add(buildStreet(30, -220, 3));
  const backdrop = buildBackdrop();
  scene.add(backdrop);

  const barricade = new THREE.Mesh(buildBarricade(6).geo, voxelMaterial);
  barricade.position.set(0, 0, -27.3);
  scene.add(barricade);
  const wagon = new THREE.Mesh(buildWagon().geo, voxelMaterial);
  wagon.position.set(-1.8, 0, -38);
  scene.add(wagon);
  const barrelM = buildBarrel(4);
  const barrels = [new THREE.Vector3(2.4, 0, -36.2), new THREE.Vector3(3.3, 0, -36.4)].map((p) => {
    const m = new THREE.Mesh(barrelM.geo, voxelMaterial);
    m.position.copy(p);
    scene.add(m);
    return m;
  });
  const tntModel = buildTntCrate();
  const tnt = new THREE.Mesh(tntModel.geo, voxelMaterial);
  tnt.position.set(0.9, 0, -41);
  scene.add(tnt);

  // Posse
  const weapons: WeaponKind[] = ['revolver', 'rifle', 'revolver', 'shotgun', 'revolver', 'rifle'];
  const slots = [
    [-1.5, 0],
    [0, 0],
    [1.5, 0],
    [-0.75, 1.1],
    [0.75, 1.1],
    [2.2, 1.1],
  ];
  const posse = weapons.map((w, i) => {
    const c = makeCharacter('posse', i, w);
    c.root.rotation.y = Math.PI;
    scene.add(c.root);
    return c;
  });

  // Bandits
  interface Bandit {
    c: Character;
    base: THREE.Vector3;
    roof: boolean;
    phase: number;
    alive: boolean;
    warn: Label;
    diesAt: number;
  }
  const bdefs: [number, number, number, boolean, WeaponKind, number][] = [
    [-1.6, 0, -39.2, false, 'rifle', 99],
    [2.8, 0, -37.4, false, 'revolver', 8.6],
    [-6.1, 3.0, -46, true, 'rifle', 99],
    [6.1, 3.0, -43, true, 'revolver', 11.3],
    [1.4, 0, -42.2, false, 'dynamite', 12.9],
  ];
  const bandits: Bandit[] = bdefs.map(([x, y, z, roof, w, diesAt], i) => {
    const c = makeCharacter('bandit', i, w);
    c.root.position.set(x, y, z);
    scene.add(c.root);
    const warn = new Label('!', 0.9, { color: '#ffdd33', stroke: '#8a0000' });
    warn.sprite.visible = false;
    scene.add(warn.sprite);
    return { c, base: new THREE.Vector3(x, y, z), roof, phase: i * 0.7, alive: true, warn, diesAt };
  });

  const boss = makeCharacter('boss', 0, 'gatling');
  boss.root.scale.setScalar(1.55);
  boss.root.position.set(0, 0, -52);
  scene.add(boss.root);

  const LOOP = 16;
  const RUN_END = 5.2;
  let t = 0;
  let tntGone = false;
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const camPos = new THREE.Vector3(0, 6.5, 8.5);
  const camLook = new THREE.Vector3(0, 1, -10);

  const reset = () => {
    t = 0;
    tntGone = false;
    tnt.visible = true;
    for (const b of bandits) {
      b.alive = true;
      b.c.root.visible = true;
    }
  };

  const killBandit = (b: Bandit, force = 3.5) => {
    if (!b.alive) return;
    b.alive = false;
    b.c.root.updateMatrixWorld(true);
    tmp.copy(b.c.root.position).add(new THREE.Vector3(0, 1, 0));
    particles.burst(b.c.model.debris, b.c.root.matrixWorld, tmp.clone().add(new THREE.Vector3(0, -0.3, -0.6)), force, 0.065);
    b.c.root.visible = false;
    b.warn.sprite.visible = false;
  };

  const freezeAt = params.has('t') ? parseFloat(params.get('t')!) : -1;
  let simTime = 0;
  let last = performance.now();

  const step = (dt: number) => {
    simTime += dt;
    t += dt;
    if (t >= LOOP) reset();

    // --- posse
    const runZ = Math.max(-26, -t * 5);
    const fighting = t >= RUN_END;
    const cyc = (t - RUN_END) % 2.6;
    const aiming = fighting && cyc > 1.0;
    const target = bandits.find((b) => b.alive && b.c.pose === 'aim') ?? bandits.find((b) => b.alive);
    posse.forEach((c, i) => {
      const [sx, sz] = slots[i];
      c.root.position.set(sx, 0, runZ + sz);
      if (!fighting) {
        c.pose = 'run';
        c.root.rotation.y = Math.PI;
      } else if (aiming && target) {
        c.pose = 'aim';
        target.c.headCenter(tmp);
        const dx = tmp.x - c.root.position.x;
        const dz = tmp.z - c.root.position.z;
        c.root.rotation.y = Math.atan2(dx, dz);
        c.aimPitch = Math.atan2(tmp.y - 1.45, Math.hypot(dx, dz));
        const shotEvery = c.weapon === 'rifle' ? 0.7 : c.weapon === 'shotgun' ? 0.9 : 0.4;
        const prev = Math.floor((cyc - dt - 1.0 + i * 0.07) / shotEvery);
        const now = Math.floor((cyc - 1.0 + i * 0.07) / shotEvery);
        if (now > prev && now >= 0) {
          c.fire();
          c.getMuzzleWorld(tmp2);
          flashes.spawn(tmp2, 0.45, 0.05);
          tmp.x += (Math.random() - 0.5) * 0.5;
          tmp.y += (Math.random() - 0.5) * 0.5;
          tracers.fire(tmp2, tmp);
          if (Math.random() < 0.3) particles.dust(tmp, 3, 0xc8a070, 0.2);
        }
      } else {
        c.pose = cyc < 0.6 ? 'reload' : 'crouch';
        c.root.rotation.y = Math.PI;
      }
    });

    // --- bandits
    for (const b of bandits) {
      if (!b.alive) continue;
      if (fighting && t >= b.diesAt) {
        killBandit(b);
        continue;
      }
      const bc = (t + b.phase) % 3;
      const hidden = bc < 1.5;
      const warnPhase = bc >= 1.5 && bc < 2.0;
      b.c.root.position.copy(b.base);
      tmp.set(0, 1.2, runZ);
      const dx = tmp.x - b.base.x;
      const dz = tmp.z - b.base.z;
      b.c.root.rotation.y = Math.atan2(dx, dz);
      if (hidden) {
        b.c.pose = 'crouch';
        if (b.roof) b.c.root.position.y -= 0.35;
      } else {
        b.c.pose = b.c.weapon === 'dynamite' ? 'throw' : 'aim';
        b.c.aimPitch = Math.atan2(1.0 - (b.base.y + 1.45), Math.hypot(dx, dz));
      }
      b.warn.sprite.visible = warnPhase && fighting && Math.floor(simTime * 12) % 2 === 0;
      b.c.headCenter(tmp2);
      b.warn.sprite.position.copy(tmp2).add(new THREE.Vector3(0, 0.75, 0));
      const fireT = 2.05;
      if (fighting && bc - dt < fireT && bc >= fireT && b.c.weapon !== 'dynamite') {
        b.c.fire();
        b.c.getMuzzleWorld(tmp2);
        flashes.spawn(tmp2, 0.45, 0.05);
        const victim = posse[Math.floor(Math.random() * posse.length)];
        tmp.copy(victim.root.position).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 1.0, -0.8));
        tracers.fire(tmp2, tmp, 0xffb060);
        particles.dust(tmp, 4, 0xd8c8a0, 0.3);
      }
    }

    // --- TNT goes up
    if (fighting && !tntGone && t >= 12.9) {
      tntGone = true;
      tnt.visible = false;
      tmp.copy(tnt.position).add(new THREE.Vector3(0, 0.5, 0));
      tnt.updateMatrixWorld(true);
      particles.burst(tntModel.debris, tnt.matrixWorld, tmp.clone().add(new THREE.Vector3(0, -0.4, 0)), 7, 0.08);
      flashes.spawn(tmp, 3.5, 0.35, 6);
      for (let k = 0; k < 30; k++) particles.dust(tmp, 1, k % 2 ? 0x5a5048 : 0x8a8078, 1.6);
      view.shake(0.5, 0.4);
    }

    // boss idles far away (preview)
    boss.pose = Math.floor(t / 2) % 2 ? 'aim' : 'idle';
    boss.aimPitch = 0;

    for (const c of posse) c.update(dt);
    for (const b of bandits) b.c.update(dt);
    boss.update(dt);
    particles.update(dt);
    tracers.update(dt);
    flashes.update(dt);

    // --- camera
    const fightBlend = THREE.MathUtils.smoothstep(t, RUN_END - 0.6, RUN_END + 0.6);
    const runPos = new THREE.Vector3(0, 8.5, runZ + 6.5);
    const runLook = new THREE.Vector3(0, 0, runZ - 8);
    const fightPos = new THREE.Vector3(0, 6.6, -26 + 6.2);
    const fightLook = new THREE.Vector3(0, 0.8, -38);
    const hf = THREE.MathUtils.lerp(58, 50, fightBlend);
    if (Math.abs(view.hfov - hf) > 0.05) {
      view.hfov = hf;
      view.resize();
    }
    camPos.lerpVectors(runPos, fightPos, fightBlend);
    camLook.lerpVectors(runLook, fightLook, fightBlend);
    view.updateShake(dt);
    view.camera.position.copy(camPos).add(view.shakeOffset);
    view.camera.lookAt(camLook);
    backdrop.position.z = camPos.z;
  };

  const frame = () => {
    const now = performance.now();
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (freezeAt >= 0) {
      while (simTime < freezeAt) step(1 / 60);
      dt = 0;
    }
    if (dt > 0) step(dt);
    view.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function lineup(view: View, params: URLSearchParams): void {
  const scene = view.scene;
  scene.add(buildStreet(20, -60, 3), buildBackdrop());
  const cast: [ReturnType<typeof makeCharacter>, number, 'idle' | 'aim' | 'crouch' | 'run'][] = [
    [makeCharacter('posse', 0, 'revolver'), -2.4, 'aim'],
    [makeCharacter('posse', 1, 'rifle'), -1.2, 'idle'],
    [makeCharacter('posse', 2, 'shotgun'), 0, 'run'],
    [makeCharacter('bandit', 0, 'revolver'), 1.2, 'aim'],
    [makeCharacter('bandit', 1, 'dynamite'), 2.4, 'idle'],
  ];
  for (const [c, x, pose] of cast) {
    c.root.position.set(x, 0, 0);
    c.root.rotation.y = pose === 'aim' ? 0.5 * Math.sign(-x || 1) * 0 + 0.35 : 0.25;
    c.pose = pose;
    scene.add(c.root);
  }
  const boss = makeCharacter('boss', 0, 'gatling');
  boss.root.scale.setScalar(1.55);
  boss.root.position.set(0.4, 0, -3.2);
  boss.root.rotation.y = -0.3;
  boss.pose = 'aim';
  scene.add(boss.root);

  const v3 = (s: string | null, d: number[]) => (s ? s.split(',').map(Number) : d) as [number, number, number];
  view.camera.position.set(...v3(params.get('cam'), [0, 1.5, 4.6]));
  view.camera.lookAt(...v3(params.get('look'), [0, 1.0, -1]));
  let last = performance.now();
  const freeze = params.has('t');
  const frame = () => {
    const now = performance.now();
    const dt = freeze ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const [c] of cast) c.update(dt);
    boss.update(dt);
    view.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

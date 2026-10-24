import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { View } from '../engine/view';
import { buildCity, LANE, type City } from './city';
import { buildCar, type CarModel } from './car';
import { headlightTexture, nightSky } from './textures';
import { PizzaHud } from './hud';

/** Tuning numbers of the driving model. */
export const PB = {
  maxSpeed: 17, // m/s (~61 km/h) for the starter car
  accel: 6,
  brake: 16,
  drag: 0.15,
  wheelbase: 2.4,
  maxSteer: 0.6, // rad at standstill
  steerFalloff: 14, // steering angle shrinks with speed: max / (1 + v / falloff)
  grip: 10, // lateral velocity decay per second
  driftGrip: 1.6,
  driftYaw: 1.5,
  radius: 1.0,
  camDist: 7,
  camHeight: 3.6,
  highDist: 11,
  highHeight: 13,
};

interface Player {
  model: CarModel;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  steer: number;
  wheelRoll: number;
}

const fwd = (yaw: number, out = new THREE.Vector3()) => out.set(-Math.sin(yaw), 0, -Math.cos(yaw));

/** Spot on the street in front of the pizzeria door, on the near (right-hand) lane. */
function startSpot(city: City): { x: number; z: number; yaw: number } {
  const p = city.pizzeria;
  const facingZ = Math.abs(p.door.z - p.cz) > Math.abs(p.door.x - p.cx);
  const near = (v: number) => city.lines.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  if (facingZ) {
    const line = near(p.door.z);
    const s = Math.sign(p.door.z - line);
    return { x: p.door.x - 6, z: line + s * LANE, yaw: s > 0 ? -Math.PI / 2 : Math.PI / 2 };
  }
  const line = near(p.door.x);
  const s = Math.sign(p.door.x - line);
  return { x: line + s * LANE, z: p.door.z, yaw: s < 0 ? Math.PI : 0 };
}

export function startPizza(view: View, ui: HTMLElement, params: URLSearchParams): void {
  const renderer = view.renderer;
  view.setPixelSize(0);
  view.outline = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = view.scene;
  scene.background = nightSky();
  scene.fog = new THREE.FogExp2(0x1c1636, 0.0045);
  view.hfov = 80;
  const cam = view.camera;
  cam.near = 0.3;
  cam.far = 420;
  view.resize();

  scene.add(new THREE.HemisphereLight(0x7080d0, 0x302838, 2.6));
  const moon = new THREE.DirectionalLight(0x8090ff, 0.9);
  moon.position.set(-60, 120, 40);
  scene.add(moon);

  const seed = parseInt(params.get('seed') ?? '7', 10);
  const city = buildCity(seed);
  scene.add(city.group);

  // ---- player car ----
  const model = buildCar('pizza', 0xe8402a);
  scene.add(model.group);
  const s = startSpot(city);
  const player: Player = { model, pos: new THREE.Vector3(s.x, 0, s.z), vel: new THREE.Vector3(), yaw: s.yaw, steer: 0, wheelRoll: 0 };
  // headlights: one real spot light (lights buildings/cars) + a soft additive cone on the asphalt
  const head = new THREE.SpotLight(0xfff0d8, 90, 45, 0.55, 0.6, 1.2);
  head.position.set(0, 0.8, -1.8);
  head.target.position.set(0, 0, -14);
  model.group.add(head, head.target);
  const cone = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 16).rotateX(-Math.PI / 2).translate(0, 0.04, -9.6),
    new THREE.MeshBasicMaterial({ map: headlightTexture(), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  cone.renderOrder = 2;
  model.group.add(cone);
  // soft fill light riding with the car so its paint reads against the dark street
  const fill = new THREE.PointLight(0xc0d0ff, 6, 9, 1.5);
  fill.position.set(0, 3.2, 2.5);
  model.group.add(fill);

  // ---- post-processing: bloom on bright (emissive) pixels ----
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, cam));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    hud.setRotateHint(h > w && 'ontouchstart' in window);
  };

  const hud = new PizzaHud(ui);
  let high = params.has('high');
  hud.onCamera = () => (high = !high);
  window.addEventListener('resize', resize);
  resize();

  // keyboard (PC testing): arrows / A D steer, space brake, shift drift
  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'KeyC') high = !high;
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  const demo = params.has('demo');
  const overview = params.has('overview');
  const f = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  let time = 0;
  let camInit = false;

  const update = (dt: number) => {
    time += dt;
    // ---- input ----
    let steerIn = hud.steer;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) steerIn = -1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) steerIn = 1;
    const braking = hud.brake || keys.has('Space') || keys.has('ArrowDown');
    const drifting = hud.drift || keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (demo) steerIn = Math.sin(time * 0.4) * 0.08;
    player.steer += (steerIn - player.steer) * Math.min(1, dt * 10);

    // ---- driving model (arcade bicycle) ----
    fwd(player.yaw, f);
    let vf = player.vel.dot(f);
    const right = new THREE.Vector3(-f.z, 0, f.x);
    let vl = player.vel.dot(right);
    if (braking) vf = Math.max(0, vf - PB.brake * dt);
    else vf += (PB.accel * (1 - vf / PB.maxSpeed)) * dt;
    vf -= vf * PB.drag * dt * (drifting ? 2.5 : 1);
    const steerAngle = (player.steer * PB.maxSteer) / (1 + Math.abs(vf) / PB.steerFalloff);
    const yawRate = (vf * Math.tan(steerAngle)) / PB.wheelbase * (drifting ? PB.driftYaw : 1);
    player.yaw -= yawRate * dt;
    // the car body turned but the momentum didn't: the difference shows up as lateral slip
    const nf = fwd(player.yaw);
    const nr = new THREE.Vector3(-nf.z, 0, nf.x);
    const vel = f.clone().multiplyScalar(vf).addScaledVector(right, vl);
    vf = vel.dot(nf);
    vl = vel.dot(nr) * Math.exp(-(drifting ? PB.driftGrip : PB.grip) * dt);
    player.vel.copy(nf).multiplyScalar(vf).addScaledVector(nr, vl);
    player.pos.addScaledVector(player.vel, dt);
    collide(player, city);

    // ---- model ----
    const g = player.model.group;
    g.position.set(player.pos.x, 0, player.pos.z);
    g.rotation.y = player.yaw;
    g.rotation.z = THREE.MathUtils.clamp(-vl * 0.02, -0.06, 0.06); // body roll
    player.wheelRoll -= (vf * dt) / 0.33;
    for (const w of player.model.wheels) w.rotation.x = player.wheelRoll;
    for (const w of player.model.frontWheels) w.rotation.y = -steerAngle;
    player.model.brake.emissiveIntensity = braking ? 4 : 1.2;

    city.update(dt, time);

    // ---- chase camera ----
    const dist = high ? PB.highDist : PB.camDist, height = high ? PB.highHeight : PB.camHeight;
    const want = player.pos.clone().addScaledVector(nf, -dist).add(new THREE.Vector3(0, height, 0));
    const look = player.pos.clone().addScaledVector(nf, high ? 6 : 5).add(new THREE.Vector3(0, high ? 0 : 1.2, 0));
    if (!camInit) {
      camPos.copy(want);
      camLook.copy(look);
      camInit = true;
    }
    const k = 1 - Math.exp(-dt * 6);
    camPos.lerp(want, k);
    camLook.lerp(look, 1 - Math.exp(-dt * 10));
    cam.position.copy(camPos);
    cam.lookAt(camLook);
    if (overview) {
      cam.position.set(city.half * 0.85, 140, city.half * 0.85);
      cam.lookAt(0, 0, 0);
    }
    hud.setSpeed(Math.abs(vf) * 3.6);
  };

  (window as unknown as { pizza: unknown }).pizza = { player, city, PB, renderer, setHigh: (v: boolean) => (high = v) };
  let last = performance.now();
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    composer.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => (last = performance.now()));
}

/** Circle vs. AABB push-out; the velocity component into the wall is removed (small bounce). */
function collide(p: Player, city: City): void {
  const r = PB.radius;
  for (const c of city.colliders) {
    if (p.pos.x < c.minX - r || p.pos.x > c.maxX + r || p.pos.z < c.minZ - r || p.pos.z > c.maxZ + r) continue;
    const cx = THREE.MathUtils.clamp(p.pos.x, c.minX, c.maxX);
    const cz = THREE.MathUtils.clamp(p.pos.z, c.minZ, c.maxZ);
    let dx = p.pos.x - cx, dz = p.pos.z - cz;
    let d = Math.hypot(dx, dz);
    if (d >= r) continue;
    if (d < 1e-4) {
      // centre inside the box: push out along the shallowest axis
      const ox = Math.min(p.pos.x - c.minX, c.maxX - p.pos.x), oz = Math.min(p.pos.z - c.minZ, c.maxZ - p.pos.z);
      if (ox < oz) (dx = p.pos.x - (c.minX + c.maxX) / 2 > 0 ? 1 : -1), (dz = 0);
      else (dz = p.pos.z - (c.minZ + c.maxZ) / 2 > 0 ? 1 : -1), (dx = 0);
      d = 0;
      p.pos.x = dx > 0 ? c.maxX + r : dx < 0 ? c.minX - r : p.pos.x;
      p.pos.z = dz > 0 ? c.maxZ + r : dz < 0 ? c.minZ - r : p.pos.z;
    } else {
      dx /= d;
      dz /= d;
      p.pos.x = cx + dx * r;
      p.pos.z = cz + dz * r;
    }
    const vn = p.vel.x * dx + p.vel.z * dz;
    if (vn < 0) {
      p.vel.x -= vn * dx * 1.25;
      p.vel.z -= vn * dz * 1.25;
      p.vel.multiplyScalar(0.8);
    }
  }
}

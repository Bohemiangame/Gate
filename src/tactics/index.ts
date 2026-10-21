import * as THREE from 'three';
import type { View } from '../engine/view';
import { CharacterBatcher } from '../gfx/batcher';
import { makeCharacter } from '../gfx/models';
import { buildBackdrop } from '../gfx/town';
import { generatePlaza } from './map';

/** Tactics prototype entry (?tactics). Step 1: visual test only. */
export function startTactics(view: View, ui: HTMLElement, params: URLSearchParams): void {
  const scene = view.scene;
  view.vfov = parseFloat(params.get('fov') ?? '40');
  view.setPixelSize(parseFloat(params.get('pix') ?? '3'));
  view.outline = params.get('outline') !== '0';
  scene.fog = new THREE.Fog(0xf0c890, 60, 140);
  view.camera.far = 220;
  const batcher = new CharacterBatcher(scene);
  const backdrop = buildBackdrop();
  backdrop.scale.setScalar(0.9);
  scene.add(backdrop);
  const map = generatePlaza(parseInt(params.get('seed') ?? '7', 10), scene);

  // cast: sheriff + 2 squads (blue/green) + bandits at cover slots
  const sheriff = makeCharacter('sheriff', 0, 'revolver');
  sheriff.root.position.set(0.5, 0, 10);
  sheriff.root.rotation.y = Math.PI;
  sheriff.pose = 'aim';
  scene.add(sheriff.root);
  const slotsNear = (z: number) => map.slots.filter((s) => s.free && Math.abs(s.pos.z - z) < 4 && s.normal.z > 0.5);
  const put = (c: ReturnType<typeof makeCharacter>, s: { pos: THREE.Vector3; occupant: unknown } | undefined, facing: number, pose: 'crouch' | 'aim' | 'run' | 'idle') => {
    if (!s) return;
    s.occupant = c;
    c.root.position.copy(s.pos);
    c.root.rotation.y = facing;
    c.pose = pose;
    scene.add(c.root);
  };
  const our = slotsNear(8);
  for (let i = 0; i < 3; i++) put(makeCharacter('posse', i, i === 0 ? 'rifle' : 'revolver'), our[i], Math.PI, i % 2 ? 'aim' : 'crouch');
  for (let i = 0; i < 3; i++) put(makeCharacter('posseB', i, i === 2 ? 'shotgun' : 'revolver'), our[our.length - 1 - i], Math.PI, i % 2 ? 'crouch' : 'aim');
  const theirs = map.slots.filter((s) => s.free && s.pos.z < -2 && s.normal.z < -0.5);
  for (let i = 0; i < 6; i++) put(makeCharacter('bandit', i, i % 3 === 0 ? 'rifle' : 'revolver'), theirs[(i * 3) % theirs.length], 0, i % 2 ? 'aim' : 'crouch');
  const runner = makeCharacter('bandit', 4, 'revolver');
  runner.root.position.set(-1, 0, -14);
  runner.pose = 'run';
  scene.add(runner.root);

  const camTarget = new THREE.Vector3(0, 0, 2);
  const pitch = THREE.MathUtils.degToRad(parseFloat(params.get('pitch') ?? '52'));
  const dist = parseFloat(params.get('dist') ?? '30');
  view.camera.position.set(camTarget.x, Math.sin(pitch) * dist, camTarget.z + Math.cos(pitch) * dist);
  view.camera.lookAt(camTarget);
  backdrop.position.copy(view.camera.position).setY(0);

  let last = performance.now();
  const chars = [sheriff, runner];
  scene.traverse((o) => void o);
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const c of [...chars]) c.update(dt);
    batcher.sync();
    view.render();
    requestAnimationFrame(frame);
  };
  // update every character, not only the two named ones
  import('../gfx/character').then(({ characters }) => {
    chars.length = 0;
    for (const c of characters) chars.push(c);
  });
  requestAnimationFrame(frame);
  void ui;
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { bayPoint, gatePoint, dispatchPoint, parkingPoint, tankPoint, MAX_TANKS, MAX_TRUCKS, type Playback, type TruckPose, type Point } from './playback';

export const COLORS = { diesel: 0x45c1e5, gasoline: 0xefae56, idle: 0x59dbba, loading: 0x45c1e5, paused: 0xff755d, closed: 0x5b6b79 };

/** Shared geometries and merged static meshes keep the detailed terminal inexpensive. */
class Factory {
  geometries = new Set<THREE.BufferGeometry>();
  materials = new Set<THREE.Material>();
  textures = new Set<THREE.Texture>();
  cache = new Map<string, THREE.BufferGeometry>();
  mat(color: number, metalness = .1, roughness = .6, emissive = 0) {
    const material = new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive, emissiveIntensity: 1.4 });
    this.materials.add(material); return material;
  }
  geometry(key: string, create: () => THREE.BufferGeometry) {
    let geometry = this.cache.get(key);
    if (!geometry) { geometry = create(); this.cache.set(key, geometry); this.geometries.add(geometry); }
    return geometry;
  }
  mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  box(parent: THREE.Object3D, material: THREE.Material, size: [number, number, number], at: [number, number, number]) {
    return this.mesh(this.geometry(`b${size}`, () => new THREE.BoxGeometry(...size)), material, parent, ...at);
  }
  roundedBox(parent: THREE.Object3D, material: THREE.Material, size: [number, number, number], at: [number, number, number], radius = .1) {
    return this.mesh(this.geometry(`r${size}`, () => new RoundedBoxGeometry(...size, 2, radius)), material, parent, ...at);
  }
  cylinder(parent: THREE.Object3D, material: THREE.Material, r: number, height: number, at: [number, number, number], rTop = r, segments = 32) {
    return this.mesh(this.geometry(`c${r},${height},${rTop},${segments}`, () => new THREE.CylinderGeometry(rTop, r, height, segments)), material, parent, ...at);
  }
  sphere(parent: THREE.Object3D, material: THREE.Material, r: number, at: [number, number, number]) {
    return this.mesh(this.geometry(`s${r}`, () => new THREE.SphereGeometry(r, 16, 12)), material, parent, ...at);
  }
  beam(parent: THREE.Object3D, material: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, radius = .08) {
    const mesh = this.cylinder(parent, material, radius, a.distanceTo(b), [0, 0, 0], radius, 8);
    mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); return mesh;
  }
  pipe(parent: THREE.Object3D, material: THREE.Material, points: number[][], radius = .12) {
    for (let i = 1; i < points.length; i++) this.beam(parent, material, new THREE.Vector3(...points[i - 1]), new THREE.Vector3(...points[i]), radius);
    points.slice(1, -1).forEach(p => this.sphere(parent, material, radius, p as [number, number, number]));
  }
  text(parent: THREE.Object3D, text: string, position: [number, number, number], width = 7, color = '#e4f2fa', background = '#142937', sprite = true) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, 512, 96); }
    ctx.font = '600 38px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
    ctx.fillText(text, 256, 50, 480);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; this.textures.add(texture);
    if (sprite) {
      const material = new THREE.SpriteMaterial({ map: texture, depthTest: true, transparent: true }); this.materials.add(material);
      const object = new THREE.Sprite(material); object.position.set(...position); object.scale.set(width, width * 96 / 512, 1); parent.add(object); return object;
    }
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide }); this.materials.add(material);
    return this.mesh(this.geometry(`p${width}`, () => new THREE.PlaneGeometry(width, width * 96 / 512)), material, parent, ...position);
  }
  merge(root: THREE.Group) {
    root.updateMatrixWorld(true);
    const groups = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[]; poi?: string }>();
    const objects: THREE.Mesh[] = [];
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
      let parent: THREE.Object3D | null = object, poi: string | undefined;
      while (parent && parent !== root.parent) { if (parent.userData.poi) poi = parent.userData.poi; parent = parent.parent; }
      const key = `${object.material.uuid}:${poi ?? ''}`;
      if (!groups.has(key)) groups.set(key, { material: object.material, geometries: [], poi });
      const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
      // Consistent attributes permit primitives and cylinders to share a batch.
      if (geometry.index) { const expanded = geometry.toNonIndexed(); geometry.dispose(); groups.get(key)!.geometries.push(expanded); }
      else groups.get(key)!.geometries.push(geometry);
      objects.push(object);
    });
    objects.forEach(mesh => mesh.removeFromParent());
    for (const { material, geometries, poi } of groups.values()) {
      const geometry = mergeGeometries(geometries); geometries.forEach(g => g.dispose());
      if (!geometry) continue;
      this.geometries.add(geometry);
      const mesh = this.mesh(geometry, material, root); mesh.userData.poi = poi;
    }
  }
  dispose() { this.geometries.forEach(g => g.dispose()); this.materials.forEach(m => m.dispose()); this.textures.forEach(t => t.dispose()); }
}

export interface BayVisual { signal: THREE.MeshStandardMaterial; progress: THREE.Mesh; arm: THREE.Group; rotor: THREE.Group; flow: THREE.Mesh[]; point: Point }
export interface TankVisual { id: string; level: THREE.Mesh; signal: THREE.MeshStandardMaterial }
export interface TerminalWorld {
  scene: THREE.Scene; factory: Factory; bays: BayVisual[]; tanks: TankVisual[]; labels: THREE.Group; roofs: THREE.Group;
  routes: THREE.Group; pickables: THREE.Object3D[]; selection: THREE.Mesh; barriers: { group: THREE.Group; index: number; exit: boolean }[];
  fleet: { update: (poses: { pose: TruckPose; color: number; id: string }[]) => void; meshes: THREE.InstancedMesh[] };
  setLighting: (night: boolean) => void; dispose: () => void;
}

export function buildWorld(renderer: THREE.WebGLRenderer, playback: Playback, reflectionSize = 128): TerminalWorld {
  const result = playback.result, f = new Factory(), scene = new THREE.Scene();
  const terrain = new THREE.Group(); scene.add(terrain);
  const labels = new THREE.Group(); scene.add(labels);
  const roofs = new THREE.Group(); scene.add(roofs);
  const routes = new THREE.Group(); scene.add(routes);
  const concrete = f.mat(0x6d7e83, .05, .95), curb = f.mat(0xa1abb0), asphalt = f.mat(0x26343d, .03, .95);
  const dark = f.mat(0x192b36, .55, .5), steel = f.mat(0x9baab1, .76, .36), silver = f.mat(0xd4dfe3, .63, .32);
  const white = f.mat(0xd9e2df), blue = f.mat(0x147191, .4), yellow = f.mat(0xcdaa59), black = f.mat(0x14202a);
  const diesel = f.mat(COLORS.diesel, .45), gasoline = f.mat(COLORS.gasoline, .45), green = f.mat(0x263e3c, .05, 1);
  const glass = f.mat(0x23536b, .7, .18), roof = f.mat(0x304f61, .55, .48);
  const lamps = f.mat(0xffe3aa, .1, .4, 0xffc878);
  const surface = document.createElement('canvas'); surface.width = surface.height = 256;
  const context = surface.getContext('2d')!, pixels = context.createImageData(256, 256);
  let noise = 78123;
  for (let i = 0; i < pixels.data.length; i += 4) {
    noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
    const shade = 180 + noise % 65;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = shade; pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const grain = new THREE.CanvasTexture(surface); grain.wrapS = grain.wrapT = THREE.RepeatWrapping; grain.repeat.set(18, 18);
  grain.colorSpace = THREE.SRGBColorSpace; f.textures.add(grain); asphalt.map = grain;
  const staticRoot = new THREE.Group(); scene.add(staticRoot);
  const lampMeshes: THREE.Mesh[] = [];
  const bottom = 28 + playback.parkingRows * 10;
  const ids = Array.from(new Set(result.batches.map(b => b.tankId))).slice(0, MAX_TANKS);
  const back = 43 + Math.max(0, Math.ceil(ids.length / 4) - 1) * 15;

  f.box(terrain, dark, [110, 1.2, bottom + back], [0, -1, (bottom - back) / 2]);
  f.box(terrain, concrete, [108, .3, bottom + back - 2], [0, -.25, (bottom - back) / 2]);
  f.box(terrain, asphalt, [103, .08, bottom + back - 6], [0, -.04, (bottom - back) / 2]);
  f.box(terrain, asphalt, [154, .1, 12], [0, -.04, 15]);
  const backdrop = f.mat(0x14242e, .05, 1);
  f.box(terrain, backdrop, [2000, .2, 2000], [0, -1.9, 0]);

  // Quiet grid around the plinth, physically separate from the terminal's roads.
  const grid = new THREE.GridHelper(300, 60, 0x2c4550, 0x213740); grid.position.y = -1.78; scene.add(grid);
  f.geometries.add(grid.geometry);
  (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach(material => f.materials.add(material));
  for (let x = -72; x <= 72; x += 5) f.box(staticRoot, white, [2.2, .025, .12], [x, .04, 15]);
  for (const x of [-37, 29, 48]) for (let z = -13; z < bottom - 3; z += 5) f.box(staticRoot, white, [.12, .025, 2.1], [x, .03, z]);
  // Loading apron, storm drains, safety lanes, and parking markings.
  f.box(staticRoot, concrete, [50, .16, 21], [-2, .04, -2]);
  for (let i = 0; i < 6; i++) {
    const [x] = bayPoint(i);
    for (const offset of [-3.2, 3.2]) f.box(staticRoot, yellow, [.1, .03, 16], [x + offset, .15, -2]);
  }
  for (let row = 0; row < playback.parkingRows; row++) for (let col = 0; col < 10; col++) {
    const [x, z] = parkingPoint(row * 10 + col);
    for (const side of [-2.5, 2.5]) f.box(staticRoot, white, [.08, .02, 6.8], [x + side, .03, z]);
    f.box(staticRoot, yellow, [4.9, .02, .14], [x, .035, z + 3.4]);
  }
  for (const z of [-13, 10]) {
    f.box(staticRoot, dark, [51, .02, .28], [-2, .16, z]);
    for (let x = -27; x < 24; x += .8) f.box(staticRoot, steel, [.1, .025, .28], [x, .18, z]);
  }

  // Fence, bollards, shrubs and floodlights give the site a legible perimeter.
  for (const x of [-51, 51]) for (let z = -back + 4; z < bottom; z += 5) {
    if (z > 8 && z < 25) continue;
    f.cylinder(staticRoot, steel, .075, 2.6, [x, 1.3, z], .075, 8);
    for (const y of [.5, 1.4, 2.4]) f.box(staticRoot, steel, [.05, .04, 4.9], [x, y, z + 2.5]);
    for (let v = 1; v < 5; v++) f.box(staticRoot, dark, [.035, 2.1, .035], [x, 1.35, z + v]);
  }
  for (const z of [-back + 3, bottom]) {
    f.box(staticRoot, curb, [103, .25, .5], [0, .1, z]);
    for (let x = -50; x <= 50; x += 5) {
      f.cylinder(staticRoot, steel, .07, 2.4, [x, 1.2, z], .07, 8);
      for (const y of [.6, 1.5, 2.3]) f.box(staticRoot, steel, [4.9, .035, .035], [x + 2.5, y, z]);
    }
  }
  for (const x of [-49, 49]) for (const z of [-34, 1, bottom - 5]) {
    f.cylinder(staticRoot, dark, .13, 10, [x, 5, z], .09, 8);
    f.box(staticRoot, steel, [4, .14, .2], [x, 10, z]);
    for (const dx of [-1.5, 1.5]) {
      f.box(staticRoot, dark, [.9, .3, .7], [x + dx, 9.9, z]);
      lampMeshes.push(f.box(staticRoot, lamps, [.8, .05, .6], [x + dx, 9.72, z]));
    }
  }
  for (const x of [-55, 55]) for (let z = -35; z < bottom; z += 8) {
    if (z > 5 && z < 26) continue;
    f.box(staticRoot, green, [2.1, .5, 2.8], [x, -.5, z]);
    const shrub = f.sphere(staticRoot, green, 1.1, [x, .1, z]); shrub.scale.y = .6;
  }
  // Crosswalk at the gate and road-direction arrows.
  for (let z = 10; z <= 20; z += 1.1) f.box(staticRoot, white, [3.2, .03, .5], [-34, .06, z]);
  function arrow(x: number, z: number, direction = 0) {
    const group = new THREE.Group(); group.position.set(x, .08, z); group.rotation.y = direction; staticRoot.add(group);
    f.box(group, white, [.22, .025, 2.4], [0, 0, 0]);
    for (const sign of [-1, 1]) { const part = f.box(group, white, [.18, .025, 1.3], [sign * .44, 0, -.75]); part.rotation.y = sign * Math.PI / 4; }
  }
  arrow(-59, 12.5, -Math.PI / 2); arrow(57, 12.5, -Math.PI / 2); arrow(-35, 2); arrow(30, 2, Math.PI);

  function building(id: string, x: number, z: number, w: number, d: number, name: string, accent: THREE.Material) {
    const group = new THREE.Group(); group.userData.poi = id; group.position.set(x, 0, z); staticRoot.add(group);
    f.box(group, curb, [w + 1, .4, d + 1], [0, .15, 0]);
    f.box(group, white, [w, 3.9, d], [0, 2.1, 0]);
    f.box(group, accent, [w + .7, .32, d + .7], [0, 4.15, 0]);
    for (let a = -w / 2 + 1; a < w / 2 - .5; a += 1.8) {
      f.box(group, dark, [1.4, 1.5, .08], [a, 2.5, d / 2 + .04]);
      f.box(group, glass, [1.2, 1.3, .1], [a, 2.5, d / 2 + .09]);
      f.box(group, white, [.06, 1.35, .12], [a, 2.5, d / 2 + .16]);
    }
    f.box(group, dark, [1.1, 2.5, .12], [w / 2 + .04, 1.45, 0]).rotation.y = Math.PI / 2;
    f.box(group, steel, [1.9, .7, 1.5], [1, 4.6, 0]);
    for (let i = 0; i < 6; i++) f.box(group, dark, [1.6, .04, .06], [1, 4.5 + i * .08, .78]);
    f.text(labels, name, [x, 6, z], w + 2);
    return group;
  }
  building('gate', -44, 5, 9, 5.5, '01 / РЕГИСТРАЦИЯ', blue);
  building('lab', -43, -25, 10, 9, '02 / ЛАБОРАТОРИЯ', diesel);
  building('dispatch', 43, -20, 10, 6, '04 / КОНТРОЛЬ', blue);
  building('pump', 32, -30, 7, 9, 'НАСОСНАЯ', dark);

  const barriers: TerminalWorld['barriers'] = [];
  function barrier(x: number, z: number, index: number, exit: boolean) {
    f.box(staticRoot, yellow, [.65, 1.6, .65], [x, .8, z]);
    const group = new THREE.Group(); group.position.set(x, 1.6, z); scene.add(group);
    f.box(group, white, [.16, .16, 4.1], [0, 0, 2]);
    for (let k = 0; k < 4; k++) f.box(group, gasoline, [.18, .18, .4], [0, 0, .5 + k]);
    barriers.push({ group, index, exit });
  }
  for (let i = 0; i < Math.min(24, result.scenario.gateCount); i++) {
    const [x, z] = gatePoint(i); barrier(x + 4, z - 2, i, false);
    f.box(staticRoot, dark, [6.5, .1, 3.3], [x, .1, z]);
  }
  for (let i = 0; i < Math.min(24, result.scenario.dispatchCount); i++) {
    const [x, z] = dispatchPoint(i); barrier(x - 2, z + 4, i, true);
    f.box(staticRoot, steel, [3.8, .12, 6.5], [x, .1, z]);
    for (let j = -2; j <= 2; j++) f.box(staticRoot, dark, [3.7, .03, .12], [x, .18, z + j]);
  }

  const tanks: TankVisual[] = [];
  ids.forEach((id, i) => {
    const [x, z] = tankPoint(i), product = result.batches.find(b => b.tankId === id)!.product;
    const accent = product === 'diesel' ? diesel : gasoline;
    const group = new THREE.Group(); group.position.set(x, 0, z); group.userData.poi = id; staticRoot.add(group);
    f.box(group, concrete, [13, .25, 13], [0, .1, 0]);
    for (const dx of [-6.4, 6.4]) f.box(group, curb, [.25, .8, 13], [dx, .4, 0]);
    for (const dz of [-6.4, 6.4]) f.box(group, curb, [13, .8, .25], [0, .4, dz]);
    f.cylinder(group, dark, 5.2, .4, [0, .4, 0]);
    f.cylinder(group, silver, 4.7, 8, [0, 4.55, 0]);
    for (const y of [1.5, 3.5, 5.5, 7.5]) f.cylinder(group, steel, 4.73, .055, [0, y, 0]);
    f.cylinder(group, accent, 4.75, .65, [0, 6.5, 0]);
    f.cylinder(group, white, 4.83, .35, [0, 8.65, 0], 4.4);
    f.cylinder(group, silver, 4.4, .75, [0, 9.2, 0], .5);
    f.cylinder(group, dark, .22, .8, [0, 9.9, 0]);
    f.cylinder(group, steel, .65, .12, [0, 10.3, 0], .1);
    // Roof guardrails and external maintenance ladder.
    for (let a = 0; a < 24; a++) {
      const angle = a / 24 * Math.PI * 2, next = (a + 1) / 24 * Math.PI * 2;
      const px = Math.cos(angle) * 4.55, pz = Math.sin(angle) * 4.55;
      f.cylinder(group, yellow, .035, 1, [px, 9.25, pz], .035, 6);
      f.beam(group, yellow, new THREE.Vector3(px, 9.75, pz), new THREE.Vector3(Math.cos(next) * 4.55, 9.75, Math.sin(next) * 4.55), .035);
    }
    for (const dx of [-.5, .5]) f.box(group, steel, [.07, 9.5, .07], [dx, 4.8, 4.92]);
    for (let y = .4; y < 9.5; y += .4) f.box(group, steel, [1.05, .06, .07], [0, y, 4.93]);
    f.pipe(group, accent, [[3.5, .8, 3.5], [3.5, .8, 7], [3.5, 1.2, 9]], .2);
    f.text(labels, `${id}  /  ${product === 'diesel' ? 'ДТ' : 'АИ-95'}`, [x, 11.5, z], 10);
    // A separate gauge shows unallocated stock, never an invented fluid surface.
    f.box(group, dark, [.8, 6, .22], [2.6, 4.5, 4.2]);
    const level = f.box(scene, accent, [.45, 1, .25], [x + 2.6, 1.5, z + 4.35]);
    const signal = f.mat(0xffc670, .1, .4, 0xffc670);
    f.sphere(scene, signal, .22, [x + 2.6, 7.8, z + 4.4]);
    tanks.push({ id, level, signal });
  });

  // Product headers, supports and valves connect storage to the loading rack.
  for (const [z, material] of [[-16.8, diesel], [-17.5, gasoline]] as const) {
    f.pipe(staticRoot, material, [[-31, 1.5, z], [27, 1.5, z], [27, 1.5, -30]], .22);
    for (let x = -28; x <= 26; x += 6) {
      f.box(staticRoot, dark, [.25, 1.4, 1.6], [x, .7, z]);
      f.cylinder(staticRoot, steel, .33, .16, [x + 1, 1.5, z]).rotation.z = Math.PI / 2;
    }
  }
  const bays: BayVisual[] = [];
  for (let i = 0; i < 6; i++) {
    const [x, z] = bayPoint(i), active = i < result.scenario.bayCount;
    const group = new THREE.Group(); group.position.set(x, 0, z); group.userData.poi = `loading-${i + 1}`; staticRoot.add(group);
    const accent = active ? blue : dark;
    f.box(roofs, dark, [7.5, .35, 10.5], [x, 6.8, z]);
    f.box(roofs, roof, [7.7, .2, 10.8], [x, 7, z]);
    f.box(group, accent, [7.5, .75, .24], [0, 6.65, 5.2]);
    for (const dx of [-3.1, 3.1]) for (const dz of [-4.5, 4.5]) {
      f.box(group, steel, [.23, 6.8, .23], [dx, 3.4, dz]);
      f.box(group, yellow, [.32, 1.2, .32], [dx, .6, dz]);
      f.beam(group, steel, new THREE.Vector3(dx, 5.2, dz), new THREE.Vector3(dx + (dx < 0 ? 1.3 : -1.3), 6.7, dz), .09);
    }
    for (let dz = -4; dz <= 4; dz += 2) f.box(group, steel, [6.3, .16, .12], [0, 6.5, dz]);
    f.text(labels, `${String(i + 1).padStart(2, '0')}  ${active ? (!result.scenario.dedicatedBays || i % 3 === 0 ? 'ДТ / АИ' : i % 3 === 1 ? 'ДТ' : 'АИ-95') : 'РЕЗЕРВ'}`, [x, 8.4, z + 1], 7);
    // Meter cabinet and motor, with an actual rotating coupling while loading.
    f.box(group, accent, [1.1, 2.3, 1.2], [-2.2, 1.15, -2.8]);
    f.box(group, black, [.75, .6, .06], [-2.2, 1.8, -2.15]);
    f.box(group, diesel, [.55, .25, .08], [-2.2, 1.85, -2.1]);
    f.box(group, dark, [1.2, .3, 2.1], [2.3, .3, -3.4]);
    f.cylinder(group, steel, .43, 1.6, [2.3, .75, -3.4]).rotation.x = Math.PI / 2;
    for (let j = 0; j < 8; j++) f.cylinder(group, dark, .46, .045, [2.3, .75, -4 + j * .17]).rotation.x = Math.PI / 2;
    f.pipe(group, diesel, [[2.3, .75, -4.3], [2.3, 1.5, -6], [2.3, 1.5, -14.8]], .13);
    const rotor = new THREE.Group(); rotor.position.set(x + 2.3, .75, z - 2.55); scene.add(rotor);
    f.box(rotor, yellow, [.65, .08, .08], [0, 0, 0]); f.box(rotor, yellow, [.08, .65, .08], [0, 0, 0]);
    const arm = new THREE.Group(); arm.position.set(x - 2.2, 4, z - 2.8); scene.add(arm);
    f.pipe(arm, yellow, [[0, -1.7, 0], [0, 0, 0], [1.5, 0, 0], [2, -.6, .5], [2, -1.1, 1.1]], .11);
    f.sphere(arm, steel, .2, [1.5, 0, 0]);
    const hose = f.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(2, -1.1, 1.1), new THREE.Vector3(2.4, -2.2, 1.7), new THREE.Vector3(1.6, -2.7, 2)]), 12, .09, 6, false), black, arm);
    f.geometries.add(hose.geometry);
    const signal = f.mat(active ? COLORS.idle : COLORS.closed, .1, .35, active ? COLORS.idle : 0);
    f.sphere(scene, signal, .25, [x + 2.7, 5.7, z + 4.7]);
    f.box(group, dark, [5.6, .18, .2], [0, 5.9, 5.36]);
    const progress = f.box(scene, diesel, [1, .14, .22], [x - 2.8, 5.9, z + 5.38]);
    const flow: THREE.Mesh[] = [];
    for (let j = 0; j < 3; j++) flow.push(f.sphere(scene, lamps, .13, [x + 2.3, 1.5, -16 + j * 3]));
    bays.push({ signal, progress, rotor, arm, flow, point: [x, z] });
    // Fire protection cabinet and bollards.
    f.box(group, f.mat(0x9c473c), [.7, 1.1, .5], [3.2, .8, 4.4]);
    for (const dx of [-2.7, 2.7]) f.cylinder(group, yellow, .1, 1, [dx, .5, 5.5], .1, 8);
  }

  f.text(labels, '03 / НАЛИВНАЯ ЭСТАКАДА', [-2, .2, 10], 26, '#c3d1d4', '', false).rotation.x = -Math.PI / 2;
  f.text(labels, 'ОЖИДАНИЕ ДОПУСКА И ПОСТА', [-2, .12, bottom - 5], 29, '#9aaeb7', '', false).rotation.x = -Math.PI / 2;
  f.text(labels, 'ПОТОК  /  ТЕРМИНАЛ 01', [0, -.45, bottom + .65], 24, '#9db5c2', '#1a2c37', false);

  const routeMaterial = new THREE.MeshBasicMaterial({ color: 0x57d6e3, transparent: true, opacity: .38, depthWrite: false }); f.materials.add(routeMaterial);
  const guide = [[-65, 15], [-36, 15], [-36, 10], [-22, 10], [-22, -12], [43, -12], [43, 15], [65, 15]];
  for (let i = 1; i < guide.length; i++) f.beam(routes, routeMaterial, new THREE.Vector3(guide[i - 1][0], .24, guide[i - 1][1]), new THREE.Vector3(guide[i][0], .24, guide[i][1]), .1);
  routes.visible = false;

  f.merge(staticRoot); f.merge(terrain); f.merge(roofs);
  const pickables: THREE.Object3D[] = staticRoot.children.filter(m => m.userData.poi);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x7be3ee, transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false }); f.materials.add(ringMaterial);
  const selection = f.mesh(new THREE.RingGeometry(2.8, 2.95, 64), ringMaterial, scene); f.geometries.add(selection.geometry);
  selection.rotation.x = -Math.PI / 2; selection.visible = false;

  const fleet = buildFleet(f, scene); pickables.push(...fleet.meshes);
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer); const environmentMap = pmrem.fromScene(environment, .04, .1, 100, { size: reflectionSize });
  scene.environment = environmentMap.texture; environment.dispose(); pmrem.dispose();
  const sky = new THREE.HemisphereLight(0xb6d9ea, 0x394249, 2); scene.add(sky);
  const sun = new THREE.DirectionalLight(0xffedd2, 3.4); sun.position.set(-42, 65, 28); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -85; sun.shadow.camera.right = 85; sun.shadow.camera.top = 85; sun.shadow.camera.bottom = -85;
  sun.shadow.camera.far = 220; sun.shadow.normalBias = .08; sun.shadow.bias = -.0001; sun.shadow.radius = 3;
  sun.target.position.set(0, 0, 5); scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight(0x67c7ed, 1.4); rim.position.set(45, 25, -40); scene.add(rim);
  const nightLights: THREE.PointLight[] = [];
  for (const x of [-23, 18, -44, 43]) {
    const light = new THREE.PointLight(0xffd28b, 0, 38, 2); light.position.set(x, 7, x === -44 ? 9 : 0); scene.add(light); nightLights.push(light);
  }
  const setLighting = (night: boolean) => {
    scene.background = new THREE.Color(night ? 0x07151f : 0x172e3b);
    scene.fog = new THREE.FogExp2(night ? 0x07151f : 0x172e3b, .0025);
    sky.intensity = night ? .32 : 1.15; sun.intensity = night ? .5 : 3.2; rim.intensity = night ? 1.3 : .85;
    sun.color.setHex(night ? 0xa8c9f6 : 0xffd8ad); scene.environmentIntensity = night ? .3 : .55;
    lamps.emissiveIntensity = night ? 3 : .45; nightLights.forEach(l => l.intensity = night ? 210 : 0);
    renderer.toneMappingExposure = night ? 1.05 : 1.02;
  };
  setLighting(false);
  return { scene, factory: f, bays, tanks, labels, roofs, routes, pickables, selection, barriers, fleet, setLighting,
    dispose() { environmentMap.dispose(); fleet.meshes.forEach(mesh => mesh.dispose()); f.dispose(); scene.clear(); } };
}

function buildFleet(f: Factory, scene: THREE.Scene) {
  const template = new THREE.Group();
  const chassis = f.mat(0x202c33, .5), rubber = f.mat(0x10191e, .05, .95), chrome = f.mat(0xb5c6cd, .85, .28);
  const paint = f.mat(0xffffff, .4, .38), tank = f.mat(0xc9d8dc, .72, .3), glass = f.mat(0x173648, .65, .17);
  const stripe = f.mat(0x257892, .3), headlights = f.mat(0xffedb7, .1, .3, 0xffdfa0), rearLights = f.mat(0xf45f48, .1, .4, 0x9f2012);
  // Local +Z is forward. Independent tractor and cylindrical semitrailer silhouette.
  f.box(template, chassis, [1.8, .28, 5.8], [0, .65, -.1]);
  f.roundedBox(template, paint, [1.95, 1.7, 1.55], [0, 1.65, 2.4]);
  f.roundedBox(template, paint, [1.85, .35, 1.6], [0, 2.66, 2.35]);
  f.box(template, glass, [1.65, .65, .06], [0, 2.15, 3.2]);
  f.box(template, chassis, [1.6, .42, .08], [0, 1.38, 3.22]);
  for (let i = 0; i < 3; i++) f.box(template, chrome, [1.5, .045, .09], [0, 1.25 + i * .14, 3.28]);
  f.box(template, chrome, [2, .18, .22], [0, .94, 3.2]);
  f.box(template, tank, [.48, .13, .03], [0, .91, 3.34]);
  f.cylinder(template, chrome, .085, 1.8, [-.85, 1.75, 1.43], .085, 8);
  for (const x of [-.65, .65]) f.box(template, chassis, [.12, .5, .12], [x, .65, .45]);
  for (const x of [-1, 1]) {
    f.box(template, glass, [.06, .7, 1.05], [x, 2.15, 2.45]);
    f.box(template, chrome, [.16, .1, 1.1], [x, .9, 2.2]);
    f.box(template, chrome, [.3, .08, .08], [x * 1.1, 2.2, 2.9]);
    f.box(template, chassis, [.13, .36, .23], [x * 1.25, 2.2, 2.9]);
    f.box(template, headlights, [.42, .22, .08], [x * .7, 1.05, 3.34]);
    f.box(template, rearLights, [.3, .16, .08], [x * .7, .85, -3.2]);
  }
  const barrel = f.cylinder(template, tank, .92, 3.7, [0, 1.78, -.9], .92, 24); barrel.rotation.x = Math.PI / 2;
  for (const z of [-2.75, .95]) { const cap = f.sphere(template, tank, .92, [0, 1.78, z]); cap.scale.z = .32; }
  for (const z of [-2.3, -1, .4]) {
    const band = f.cylinder(template, chrome, .935, .08, [0, 1.78, z], .935, 24); band.rotation.x = Math.PI / 2;
    f.cylinder(template, chassis, .23, .12, [0, 2.74, z]);
  }
  for (const x of [-.92, .92]) f.box(template, stripe, [.045, .22, 3.3], [x, 1.8, -.9]);
  f.box(template, chrome, [.55, .08, 3.5], [0, 2.83, -.9]);
  for (const x of [-.55, .55]) {
    f.box(template, chrome, [.045, .045, 3.6], [x, 3.08, -.9]);
    for (const z of [-2.4, -.8, .7]) f.box(template, chrome, [.045, .28, .045], [x, 2.96, z]);
  }
  f.box(template, f.mat(0xdd8c35), [.5, .34, .04], [0, 1.25, -3.07]);
  for (const x of [-.42, .42]) f.box(template, chrome, [.045, 1.6, .045], [x, 1.4, -3.12]);
  for (let y = .7; y < 2.3; y += .28) f.box(template, chrome, [.9, .04, .04], [0, y, -3.13]);
  const axlePositions = [2.55, .8, -1.8, -2.55];
  const wheelParts: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
  const wheelTemplate = new THREE.Group();
  const tyre = f.cylinder(wheelTemplate, rubber, .44, .28, [0, 0, 0], .44, 16); tyre.rotation.z = Math.PI / 2;
  const hub = f.cylinder(wheelTemplate, chrome, .24, .3, [0, 0, 0], .24, 12); hub.rotation.z = Math.PI / 2;
  const spoke = f.box(wheelTemplate, chassis, [.32, .07, .35], [0, 0, 0]);
  wheelTemplate.updateMatrixWorld(true);
  for (const part of [tyre, hub, spoke]) {
    const geometry = part.geometry.clone().applyMatrix4(part.matrixWorld); f.geometries.add(geometry); wheelParts.push({ geometry, material: part.material as THREE.Material });
  }
  f.merge(template);
  const meshes: THREE.InstancedMesh[] = [], bodyMeshes: THREE.InstancedMesh[] = [], wheelMeshes: THREE.InstancedMesh[] = [];
  for (const child of template.children) if (child instanceof THREE.Mesh) {
    const mesh = new THREE.InstancedMesh(child.geometry, child.material, MAX_TRUCKS); mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.userData.fleet = 'body';
    mesh.userData.paint = child.material === paint; mesh.count = 0; scene.add(mesh); meshes.push(mesh); bodyMeshes.push(mesh);
  }
  for (const part of wheelParts) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, MAX_TRUCKS * 8); mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true; mesh.frustumCulled = false; mesh.userData.fleet = 'wheels'; mesh.count = 0; scene.add(mesh); meshes.push(mesh); wheelMeshes.push(mesh);
  }
  const object = new THREE.Object3D(), wheel = new THREE.Object3D(), matrix = new THREE.Matrix4(), color = new THREE.Color();
  return { meshes, update(vehicles: { pose: TruckPose; color: number; id: string }[]) {
    const entries = vehicles.slice(0, MAX_TRUCKS);
    bodyMeshes.forEach(m => { m.count = entries.length; m.userData.orderIds = entries.map(e => e.id); });
    wheelMeshes.forEach(m => { m.count = entries.length * 8; m.userData.orderIds = entries.map(e => e.id); });
    entries.forEach(({ pose, color: tint }, i) => {
      object.position.set(pose.position[0], .17, pose.position[1]); object.rotation.set(0, pose.heading, 0); object.updateMatrix();
      bodyMeshes.forEach(m => { m.setMatrixAt(i, object.matrix); if (m.userData.paint) m.setColorAt(i, color.setHex(tint)); });
      axlePositions.forEach((z, axle) => [-1, 1].forEach((x, side) => {
        wheel.position.set(x, .46, z); wheel.rotation.set(pose.distance / .44, 0, 0); wheel.updateMatrix(); matrix.multiplyMatrices(object.matrix, wheel.matrix);
        wheelMeshes.forEach(m => m.setMatrixAt(i * 8 + axle * 2 + side, matrix));
      }));
    });
    meshes.forEach(m => { m.instanceMatrix.needsUpdate = true; m.boundingSphere = null; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
  } };
}

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildWorld, COLORS } from './world';
import { bayPoint, bayStateAt, createPlayback, MAX_TRUCKS, tankPoint, tankStockAt, truckPose, type Point } from './playback';
import type { SimulationResult } from '../engine/types';

export type CameraView = 'overview' | 'loading' | 'storage' | 'gate' | 'plan';
export interface ViewState { time: number; selected: string | null; night: boolean; labels: boolean; roofs: boolean; routes: boolean; follow: boolean; orbit: boolean; quality: 'auto' | 'high' | 'economy' }
export interface SceneController { view: (view: CameraView) => void; zoom: (factor: number) => void; dispose: () => void }

export function createTerminalRenderer(container: HTMLDivElement, result: SimulationResult, getState: () => ViewState,
  onSelect: (id: string) => void, onHover: (label: string) => void, onFailure: () => void, onManualCamera: () => void): SceneController {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const gl = renderer.getContext(), debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const softwareRenderer = debugInfo ? /swiftshader|llvmpipe|software/i.test(String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))) : false;
  const canvas = renderer.domElement; canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '3D-терминал. Перетаскивание — вращение, колесо — масштаб, стрелки — сдвиг. Клавиши 1–5 — ракурсы.');
  container.appendChild(canvas);
  const playback = createPlayback(result);
  let world: ReturnType<typeof buildWorld>;
  try { world = buildWorld(renderer, playback, softwareRenderer ? 64 : 128); } catch (error) { renderer.dispose(); canvas.remove(); throw error; }
  const camera = new THREE.PerspectiveCamera(42, 1, .3, 1800);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = .075; controls.minDistance = 10; controls.maxDistance = 230;
  controls.maxPolarAngle = Math.PI * .48; controls.minPolarAngle = .025;
  controls.screenSpacePanning = false; controls.enablePan = true; controls.keyPanSpeed = 12; controls.listenToKeyEvents(canvas);
  controls.target.set(0, 0, 8); camera.position.set(100, 83, 110);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let targetCamera: THREE.Vector3 | null = null, targetLook: THREE.Vector3 | null = null;
  let needsRender = true;
  const view = (name: CameraView) => {
    const rowOffset = Math.max(0, playback.parkingRows - 3) * 5;
    const presets: Record<CameraView, [number[], number[]]> = {
      overview: [[85 + rowOffset * .3, 66 + rowOffset * .3, 88 + rowOffset * .3], [-2, 0, 1]],
      loading: [[29, 12, 29], [-4, 2, -2]], storage: [[30, 30, 10], [-7, 3, -25]],
      gate: [[-65, 18, 41], [-40, 1, 13]], plan: [[0, 125 + rowOffset, 8.1], [0, 0, 8]],
    };
    targetCamera = new THREE.Vector3(...presets[name][0]); targetLook = new THREE.Vector3(...presets[name][1]);
    needsRender = true;
    if (reducedMotion) { camera.position.copy(targetCamera); controls.target.copy(targetLook); targetCamera = targetLook = null; }
  };
  view('overview');
  if (targetCamera && targetLook) { camera.position.copy(targetCamera); controls.target.copy(targetLook); }
  targetCamera = targetLook = null;
  const resize = () => {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h); camera.aspect = w / h;
    camera.zoom = Math.min(1, camera.aspect / 1.3); camera.updateProjectionMatrix();
    needsRender = true;
  };
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  let visible = true;
  const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true; }); intersection.observe(container);
  const trackMap = new Map(playback.tracks.map(t => [t.order.id, t]));
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let pointerDown: { x: number; y: number } | null = null, hoverAt = 0;
  function pick(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(world.pickables, false)[0];
    if (!hit) return null;
    if (hit.object.userData.fleet && hit.instanceId !== undefined) {
      const index = hit.object.userData.fleet === 'wheels' ? Math.floor(hit.instanceId / 8) : hit.instanceId;
      return hit.object.userData.orderIds?.[index] as string | undefined;
    }
    return hit.object.userData.poi as string | undefined;
  }
  const down = (e: PointerEvent) => { pointerDown = { x: e.clientX, y: e.clientY }; };
  const up = (e: PointerEvent) => {
    if (!pointerDown || Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) > 5) return;
    const id = pick(e); if (id && id !== 'pump') onSelect(id);
    pointerDown = null;
  };
  const hover = (e: PointerEvent) => {
    if (performance.now() - hoverAt < 120 || e.buttons) return; hoverAt = performance.now();
    const id = pick(e); canvas.style.cursor = id ? 'pointer' : 'grab';
    onHover(id && id !== 'pump' ? id : '');
  };
  const leave = () => onHover('');
  const manual = () => { targetCamera = targetLook = null; onManualCamera(); };
  controls.addEventListener('start', manual);
  const key = (e: KeyboardEvent) => { const names: CameraView[] = ['overview', 'loading', 'storage', 'gate', 'plan']; if (names[Number(e.key) - 1]) { e.preventDefault(); onManualCamera(); view(names[Number(e.key) - 1]); } };
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointermove', hover); canvas.addEventListener('pointerleave', leave); canvas.addEventListener('keydown', key);
  let disposed = false, contextLost = false, frame = 0;
  const lost = (event: Event) => { event.preventDefault(); contextLost = true; onFailure(); };
  canvas.addEventListener('webglcontextlost', lost);
  let previousTime = NaN, previousSelected: string | null = null, previousNight: boolean | null = null, previousQuality = '';
  let previousLabels: boolean | null = null, previousRoutes: boolean | null = null, previousRoofs: boolean | null = null;
  let lastFrame = performance.now();
  const render = (now: number) => {
    if (disposed) return;
    frame = requestAnimationFrame(render);
    if (contextLost || !visible || document.hidden) { lastFrame = now; return; }
    const state = getState(), delta = Math.min(.25, (now - lastFrame) / 1000); lastFrame = now;
    let dirty = needsRender; needsRender = false;
    if (previousNight !== state.night) { world.setLighting(state.night); previousNight = state.night; dirty = true; }
    if (state.quality !== previousQuality) {
      const detailed = state.quality === 'high' || (state.quality === 'auto' && !softwareRenderer);
      renderer.setPixelRatio(detailed ? Math.min(window.devicePixelRatio, 1.5) : 1);
      renderer.shadowMap.enabled = detailed; previousQuality = state.quality; resize();
      renderer.shadowMap.needsUpdate = true; dirty = true;
    }
    world.labels.visible = state.labels; world.routes.visible = state.routes;
    if (previousRoofs !== state.roofs) { world.roofs.visible = state.roofs; dirty = true; renderer.shadowMap.needsUpdate = true; previousRoofs = state.roofs; }
    if (previousLabels !== state.labels || previousRoutes !== state.routes) dirty = true;
    previousLabels = state.labels; previousRoutes = state.routes;
    if (previousTime !== state.time || previousSelected !== state.selected) {
      dirty = true; renderer.shadowMap.needsUpdate = true;
      const vehicles = playback.tracks.map(track => ({ pose: truckPose(track, state.time, result), color: COLORS[track.order.product], id: track.order.id }))
        .filter(v => v.pose.visible)
        .sort((a, b) => Number(b.id === state.selected) - Number(a.id === state.selected) || Number(b.pose.state === 'loading' || b.pose.state === 'paused') - Number(a.pose.state === 'loading' || a.pose.state === 'paused'))
        .slice(0, MAX_TRUCKS);
      world.fleet.update(vehicles);
      world.bays.forEach((bay, i) => {
        const data = bayStateAt(result, i, state.time), color = COLORS[data.state];
        bay.signal.color.setHex(color); bay.signal.emissive.setHex(data.state === 'closed' ? 0 : color);
        bay.progress.visible = !!data.order; bay.progress.scale.x = Math.max(.001, data.progress * 5.6);
        bay.progress.position.x = bay.point[0] - 2.8 + data.progress * 2.8;
        const working = data.state === 'loading';
        // Absolute active time: rotor and flow freeze during an outage and on pause.
        const active = data.order ? data.progress * data.order.load!.activeMinutes : 0;
        bay.rotor.rotation.z = active * 5;
        bay.arm.rotation.y = data.order ? -.15 : -1.45;
        bay.flow.forEach((particle, k) => { particle.visible = working; particle.position.z = -16 + ((active * 2 + k * 3) % 10); });
      });
      world.tanks.forEach(tank => {
        const stock = tankStockAt(result, tank.id, state.time), fraction = stock.initial ? stock.remaining / stock.initial : 0;
        tank.level.scale.y = Math.max(.001, fraction * 5.6); tank.level.position.y = 1.5 + fraction * 2.8;
        tank.signal.color.setHex(stock.available > 0 ? COLORS.idle : COLORS.gasoline);
        tank.signal.emissive.copy(tank.signal.color);
      });
      world.barriers.forEach(({ group, index, exit }) => {
        const visits = result.orders.map(o => exit ? o.dispatch : o.gate).filter(v => v?.resourceId === `${exit ? 'dispatch' : 'gate'}-${index + 1}`);
        let openness = 0;
        for (const visit of visits) if (visit) {
          // Open during presentation approach/departure, stay closed during service.
          const fromStart = state.time - visit.start, fromEnd = state.time - visit.end;
          if (fromStart >= 0 && fromStart < 1.7) openness = Math.max(openness, Math.sin(fromStart / 1.7 * Math.PI));
          if (fromEnd >= -.6 && fromEnd < 1.4) openness = Math.max(openness, Math.sin((fromEnd + .6) / 2 * Math.PI));
        }
        group.rotation.x = -openness * Math.PI * .47;
      });
      previousTime = state.time; previousSelected = state.selected;
    }
    let selectedPoint: Point | undefined;
    const track = state.selected ? trackMap.get(state.selected) : undefined;
    if (track) { const pose = truckPose(track, state.time, result); if (pose.visible) selectedPoint = pose.position; }
    else if (state.selected?.startsWith('loading-')) selectedPoint = bayPoint(Number(state.selected.split('-')[1]) - 1);
    else if (state.selected) { const i = world.tanks.findIndex(t => t.id === state.selected); if (i >= 0) selectedPoint = tankPoint(i); }
    world.selection.visible = !!selectedPoint;
    if (selectedPoint) { world.selection.position.set(selectedPoint[0], .25, selectedPoint[1]); world.selection.scale.setScalar(track ? 1 : 1.6); }
    if (state.follow && track && selectedPoint) {
      const desired = new THREE.Vector3(selectedPoint[0], 1.4, selectedPoint[1]);
      const alpha = reducedMotion ? 1 : 1 - Math.exp(-delta * 4);
      controls.target.lerp(desired, alpha);
      camera.position.lerp(desired.clone().add(new THREE.Vector3(14, 10, 18)), alpha);
      targetCamera = targetLook = null;
    } else if (targetCamera && targetLook) {
      const alpha = 1 - Math.exp(-delta * 4);
      camera.position.lerp(targetCamera, alpha); controls.target.lerp(targetLook, alpha);
      if (camera.position.distanceTo(targetCamera) < .04) { targetCamera = targetLook = null; }
    }
    controls.autoRotate = state.orbit && !reducedMotion && !state.follow && !targetCamera; controls.autoRotateSpeed = .4;
    const changed = controls.update(delta);
    if (dirty || changed) renderer.render(world.scene, camera);
  };
  frame = requestAnimationFrame(render);
  return { view, zoom(factor) { camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target); }, dispose() {
    disposed = true; cancelAnimationFrame(frame); observer.disconnect(); intersection.disconnect(); controls.removeEventListener('start', manual); controls.dispose();
    canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointermove', hover); canvas.removeEventListener('pointerleave', leave); canvas.removeEventListener('keydown', key); canvas.removeEventListener('webglcontextlost', lost);
    world.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
  } };
}

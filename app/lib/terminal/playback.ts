import { orderStateAt, snapshotAt } from '../engine/projection.ts';
import type { OrderResult, SimulationResult, Visit } from '../engine/types.ts';

/** Presentation coordinates only. Travel never changes the DES calendar or its KPI. */
export type Point = readonly [number, number];
export const MAX_TRUCKS = 80;
export const MAX_TANKS = 12;
export const bayPoint = (index: number): Point => [-22 + index * 8, -2];
export const parkingPoint = (slot: number): Point => [-29 + (slot % 10) * 6.3, 22 + Math.floor(slot / 10) * 10];
export const tankPoint = (index: number): Point => [-28 + (index % 4) * 15, -27 - Math.floor(index / 4) * 15];
export const gatePoint = (index: number): Point => [-43 - Math.floor(index / 4) * 7, 15 + (index % 4) * 4.8];
export const dispatchPoint = (index: number): Point => [43 + Math.floor(index / 4) * 6, -5 + (index % 4) * 7];
const resourceIndex = (visit?: Visit) => Math.max(0, Number(visit?.resourceId.split('-').at(-1) ?? 1) - 1);
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mix = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export interface Route { points: Point[]; lengths: number[]; length: number }
interface Move { start: number; end: number; route: Route }
export interface TruckTrack { order: OrderResult; moves: Move[]; parkingSlot: number }
export interface Playback { result: SimulationResult; tracks: TruckTrack[]; parkingRows: number }
export interface TruckPose { position: Point; heading: number; distance: number; moving: boolean; visible: boolean; state: string; progress: number }

/** Round corners without overshoot, then sample by arc length, not spline parameter. */
export function makeRoute(input: Point[]): Route {
  const waypoints = input.filter((p, i) => !i || distance(p, input[i - 1]) > .001);
  const points: Point[] = waypoints.length ? [waypoints[0]] : [[0, 0]];
  for (let i = 1; i < waypoints.length - 1; i++) {
    const a = waypoints[i - 1], b = waypoints[i], c = waypoints[i + 1];
    const radius = Math.min(2.2, distance(a, b) * .35, distance(b, c) * .35);
    const enter = mix(b, a, radius / distance(a, b));
    const leave = mix(b, c, radius / distance(b, c));
    points.push(enter);
    for (let k = 1; k <= 8; k++) {
      const t = k / 8;
      points.push(mix(mix(enter, b, t), mix(b, leave, t), t));
    }
  }
  if (waypoints.length > 1) points.push(waypoints.at(-1)!);
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + distance(points[i - 1], points[i]));
  return { points, lengths, length: lengths.at(-1)! };
}

export function sampleRoute(route: Route, progress: number) {
  const d = clamp(progress) * route.length;
  let i = 1;
  while (i < route.lengths.length - 1 && route.lengths[i] < d) i++;
  const a = route.points[Math.max(0, i - 1)], b = route.points[Math.min(i, route.points.length - 1)];
  const span = distance(a, b);
  return { position: mix(a, b, span ? clamp((d - (route.lengths[i - 1] ?? 0)) / span) : 0), heading: span ? Math.atan2(b[0] - a[0], b[1] - a[1]) : 0, distance: d };
}

/** Stable interval colouring: parked vehicles do not reshuffle when another leaves. */
function slotsFor(result: SimulationResult, start: (o: OrderResult) => number | undefined, end: (o: OrderResult) => number | undefined) {
  const slots = new Map<string, number>(), freeAt: number[] = [];
  const orders = result.orders.filter(o => start(o) !== undefined).sort((a, b) => start(a)! - start(b)! || a.id.localeCompare(b.id));
  for (const order of orders) {
    const from = start(order)!, until = end(order) ?? Infinity;
    if (until <= from) continue;
    let slot = freeAt.findIndex(t => t <= from);
    if (slot < 0) slot = freeAt.length;
    freeAt[slot] = until;
    slots.set(order.id, slot);
  }
  return slots;
}

export function createPlayback(result: SimulationResult): Playback {
  const parking = slotsFor(result, o => o.gate?.end, o => o.load?.start);
  const gateQueue = slotsFor(result, o => o.arrivalMin, o => o.gate?.start);
  const dispatchQueue = slotsFor(result, o => o.load?.end, o => o.dispatch?.start);
  const tracks = result.orders.map(order => {
    const moves: Move[] = [];
    let position: Point = [-65, 15];
    const move = (start: number, end: number, points: Point[]) => {
      const route = makeRoute([position, ...points]);
      moves.push({ start, end: Math.max(start, end), route });
      position = points.at(-1) ?? position;
    };
    const gate = gatePoint(resourceIndex(order.gate));
    const slot = parking.get(order.id) ?? 0;
    const park = parkingPoint(slot);
    const gateWait = (order.gate?.start ?? Infinity) - order.arrivalMin;
    if (gateWait > 0) {
      const q = gateQueue.get(order.id) ?? 0;
      const point: Point = [-53 - Math.floor(q / 3) * 7, 15 + q % 3 * 4.8];
      move(order.arrivalMin, order.arrivalMin + Math.min(2, gateWait), [[-63, point[1]], point]);
    }
    if (order.gate) {
      const g = order.gate;
      move(g.start, g.start + Math.min(1.4, (g.end - g.start) * .35), [[gate[0] - 8, gate[1]], gate]);
      const wait = (order.load?.start ?? Infinity) - g.end;
      if (wait > 0) move(g.end, g.end + Math.min(2.5, wait), [[-37, gate[1]], [-37, park[1] + 4], [park[0], park[1] + 4], park]);
    }
    if (order.load) {
      const l = order.load, bay = bayPoint(resourceIndex(l));
      const fromParking = (order.load.start - (order.gate?.end ?? order.load.start)) > 0;
      move(l.start, l.start + Math.min(2.8, (l.end - l.start) * .15), fromParking
        ? [[position[0], position[1] - 4], [-35, position[1] - 4], [-35, 9], [bay[0], 9], bay]
        : [[-35, position[1]], [-35, 9], [bay[0], 9], bay]);
      const wait = (order.dispatch?.start ?? Infinity) - l.end;
      if (wait > 0) {
        const q = dispatchQueue.get(order.id) ?? 0;
        const point: Point = [33 + (q % 2) * 5, 20 + Math.floor(q / 2) * 8];
        move(l.end, l.end + Math.min(2.5, wait), [[bay[0], -12], [32, -12], [32, point[1] + 4], [point[0], point[1] + 4], point]);
      }
    }
    if (order.dispatch) {
      const d = order.dispatch, dest = dispatchPoint(resourceIndex(d));
      move(d.start, d.start + Math.min(2, (d.end - d.start) * .2), order.load && d.start === order.load.end
        ? [[position[0], -12], [dest[0], -12], dest]
        : [[position[0], -12], [dest[0], -12], dest]);
    }
    if (order.completedAt !== undefined) move(order.completedAt, order.completedAt + 4, [[position[0], 15], [65, 15]]);
    return { order, moves, parkingSlot: slot };
  });
  return { result, tracks, parkingRows: Math.min(8, Math.max(3, Math.ceil((Math.max(-1, ...parking.values()) + 1) / 10))) };
}

/** Active operation progress, NOT a measured or simulated liquid level. */
export function loadingProgress(order: OrderResult, time: number, result: SimulationResult): number {
  if (!order.load || time <= order.load.start) return 0;
  if (time >= order.load.end) return 1;
  const { start, end, resourceId } = order.load;
  const outage = result.scenario.outage;
  const overlap = (until: number) => outage && resourceId === `loading-${outage.bayIndex + 1}`
    ? Math.max(0, Math.min(until, outage.startMin + outage.durationMin) - Math.max(start, outage.startMin)) : 0;
  return clamp((time - start - overlap(time)) / Math.max(.000001, end - start - overlap(end)));
}

export function truckPose(track: TruckTrack, time: number, result: SimulationResult): TruckPose {
  const { order, moves } = track;
  let current = moves[0], travelled = 0;
  for (const move of moves) {
    if (move.start > time) break;
    if (current !== move) travelled += current.route.length;
    current = move;
  }
  const progress = current ? clamp((time - current.start) / Math.max(.000001, current.end - current.start)) : 0;
  // Gentle acceleration and braking; absolute model time makes seeking exact.
  const eased = progress * progress * (3 - 2 * progress);
  const pose = current ? sampleRoute(current.route, eased) : { position: [-65, 15] as Point, heading: Math.PI / 2, distance: 0 };
  return { ...pose, distance: travelled + pose.distance, moving: !!current && time >= current.start && time < current.end,
    visible: time >= order.arrivalMin && (order.completedAt === undefined || time < order.completedAt + 4),
    state: orderStateAt(order, time, result), progress: loadingProgress(order, time, result) };
}

export function tankStockAt(result: SimulationResult, tankId: string, time: number) {
  const batches = result.batches.filter(b => b.tankId === tankId);
  const ids = new Set(batches.map(b => b.id));
  const initial = batches.reduce((s, b) => s + b.tonnes, 0);
  const released = batches.filter(b => b.releasedAt !== null && b.releasedAt <= time).reduce((s, b) => s + b.tonnes, 0);
  let allocated = 0;
  for (const order of result.orders) if (order.load && order.load.start <= time) {
    for (const a of order.allocations) if (ids.has(a.batchId)) allocated += a.tonnes;
  }
  return { initial, remaining: Math.max(0, initial - allocated), available: Math.max(0, released - allocated), allocated, released };
}

export function bayStateAt(result: SimulationResult, index: number, time: number) {
  if (index >= result.scenario.bayCount) return { state: 'closed' as const, order: undefined, progress: 0 };
  const outage = result.scenario.outage;
  const paused = outage && outage.bayIndex === index && time >= outage.startMin && time < outage.startMin + outage.durationMin;
  const order = result.orders.find(o => o.load?.resourceId === `loading-${index + 1}` && o.load.start <= time && o.load.end > time);
  return { state: paused ? 'paused' as const : order ? 'loading' as const : 'idle' as const, order, progress: order ? loadingProgress(order, time, result) : 0 };
}

export function nextEventTime(result: SimulationResult, time: number, direction: -1 | 1) {
  if (direction === 1) return result.events.find(e => e.at > time + .00001)?.at ?? result.horizonMin;
  return result.events.findLast(e => e.at < time - .00001)?.at ?? 0;
}

export function terminalStats(result: SimulationResult, time: number) {
  const snapshot = snapshotAt(result, time);
  return { ...snapshot, queue: snapshot.gateQueue + snapshot.supplyWait + snapshot.loadingQueue + snapshot.dispatchQueue };
}

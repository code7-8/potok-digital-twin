import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../lib/engine/simulation.ts';
import { BASE_SCENARIO, createDataset } from '../lib/engine/fixtures.ts';
import { orderStateAt, snapshotAt } from '../lib/engine/projection.ts';
import { bayStateAt, createPlayback, loadingProgress, makeRoute, nextEventTime, sampleRoute, tankStockAt, terminalStats, truckPose } from '../lib/terminal/playback.ts';

const baseline = simulate(createDataset(), BASE_SCENARIO, 42);
const playback = createPlayback(baseline);
const times = [...new Set([0, 120, 250, 719.99, 720, ...baseline.events.flatMap(e => [Math.max(0, e.at - .00001), e.at, Math.min(720, e.at + .00001)])])];

test('3D states and counters use exactly the calculation calendar, including boundaries', () => {
  for (const time of times) {
    const stats = terminalStats(baseline, time), snapshot = snapshotAt(baseline, time);
    assert.equal(stats.completed, baseline.orders.filter(o => orderStateAt(o, time, baseline) === 'completed').length);
    assert.equal(stats.shippedTonnes, snapshot.shippedTonnes);
    assert.equal(stats.queue, snapshot.gateQueue + snapshot.supplyWait + snapshot.loadingQueue + snapshot.dispatchQueue);
    for (const track of playback.tracks) {
      const pose = truckPose(track, time, baseline);
      assert.equal(pose.state, orderStateAt(track.order, time, baseline));
      assert.ok([...pose.position, pose.heading, pose.distance, pose.progress].every(Number.isFinite));
      assert.ok(pose.progress >= 0 && pose.progress <= 1);
    }
  }
});

test('seeking backwards or playing in any order gives identical positions and progress', () => {
  const before = JSON.stringify(baseline);
  const reference = playback.tracks.map(track => truckPose(track, 250, baseline));
  for (const time of [720, 0, 180, 250, 45]) playback.tracks.forEach(track => truckPose(track, time, baseline));
  assert.deepEqual(playback.tracks.map(track => truckPose(track, 250, baseline)), reference);
  assert.equal(JSON.stringify(baseline), before, 'Presentation must never mutate the model');
});

test('trucks enter on arrival and depart visibly only after calculated completion', () => {
  const track = playback.tracks.find(t => t.order.completedAt !== undefined)!;
  assert.equal(truckPose(track, track.order.arrivalMin - .01, baseline).visible, false);
  assert.equal(truckPose(track, track.order.arrivalMin, baseline).visible, true);
  const at = track.order.completedAt!;
  assert.equal(truckPose(track, at + 1, baseline).state, 'completed');
  assert.equal(truckPose(track, at + 1, baseline).visible, true);
  assert.equal(truckPose(track, at + 4, baseline).visible, false);
});

test('routes are continuous at every non-zero-duration transition', () => {
  for (const track of playback.tracks) for (const move of track.moves) {
    if (move.start <= track.order.arrivalMin || move.end === move.start) continue;
    for (const time of [move.start, move.end]) {
      const before = truckPose(track, time - .000001, baseline).position;
      const after = truckPose(track, time + .000001, baseline).position;
      assert.ok(Math.hypot(before[0] - after[0], before[1] - after[1]) < .01, `${track.order.id} at ${time}`);
    }
  }
});

test('simultaneously waiting trucks have distinct stable parking spaces', () => {
  for (const time of [100, 180, 250, 400, 550, 719]) {
    const waiting = playback.tracks.filter(t => orderStateAt(t.order, time, baseline) === 'waiting');
    assert.equal(new Set(waiting.map(t => t.parkingSlot)).size, waiting.length);
  }
});

test('tank stock accounts for reservation exactly at the load start, with no future leakage', () => {
  const ids = [...new Set(baseline.batches.map(b => b.tankId))];
  for (const time of times) {
    const stocks = ids.map(id => tankStockAt(baseline, id, time));
    const allocated = baseline.orders.filter(o => o.load && o.load.start <= time).reduce((sum, o) => sum + o.tonnes, 0);
    assert.ok(Math.abs(stocks.reduce((sum, s) => sum + s.allocated, 0) - allocated) < 1e-7);
    assert.ok(Math.abs(stocks.reduce((sum, s) => sum + s.remaining + s.allocated, 0) - baseline.metrics.initialStockTonnes) < 1e-7);
    for (const stock of stocks) assert.ok(stock.available >= 0 && stock.available <= stock.remaining + 1e-7);
  }
  const final = ids.reduce((sum, id) => sum + tankStockAt(baseline, id, 720).remaining, 0);
  assert.ok(Math.abs(final - baseline.metrics.remainingStockTonnes) < 1e-7);
});

test('outage freezes operation progress on its bay and resumes without a jump', () => {
  const result = simulate(createDataset(), { ...BASE_SCENARIO, outage: { bayIndex: 0, startMin: 240, durationMin: 120 } }, 42);
  const order = result.orders.find(o => o.load?.resourceId === 'loading-1' && o.load.start < 240 && o.load.end > 360)!;
  assert.ok(order);
  assert.equal(bayStateAt(result, 0, 250).state, 'paused');
  assert.notEqual(bayStateAt(result, 1, 250).state, 'paused');
  assert.equal(loadingProgress(order, 240, result), loadingProgress(order, 359, result));
  assert.equal(loadingProgress(order, 240, result), loadingProgress(order, 360, result));
  assert.ok(loadingProgress(order, 361, result) > loadingProgress(order, 360, result));
  assert.equal(loadingProgress(order, order.load!.end, result), 1);
});

test('closed, idle, occupied and unavailable posts remain distinct', () => {
  assert.equal(bayStateAt(baseline, 5, 120).state, 'closed');
  assert.equal(bayStateAt(baseline, 0, 0).state, 'idle');
  const order = baseline.orders.find(o => o.load)!;
  const index = Number(order.load!.resourceId.split('-')[1]) - 1;
  assert.equal(bayStateAt(baseline, index, order.load!.start).order?.id, order.id);
  assert.equal(bayStateAt(baseline, index, order.load!.start).state, 'loading');
});

test('event stepping excludes other events at the same instant and clamps to the shift', () => {
  for (const time of [0, 120, 250, 719, 720]) {
    const next = nextEventTime(baseline, time, 1), previous = nextEventTime(baseline, time, -1);
    assert.ok(next > time || time === 720);
    assert.ok(previous < time || time === 0);
    assert.ok(next <= 720 && previous >= 0);
  }
});

test('empty demand, zero resources and instant operations produce finite deterministic scenes', () => {
  for (const result of [
    simulate(createDataset(0), BASE_SCENARIO, 42),
    simulate(createDataset(), { ...BASE_SCENARIO, gateCount: 0, bayCount: 0, dispatchCount: 0 }, 42),
    simulate(createDataset(), { ...BASE_SCENARIO, gateMinutes: 0, dispatchMinutes: 0, loadingSetupMinutes: 0 }, 42),
  ]) {
    const view = createPlayback(result);
    for (const time of [0, 100, 720]) for (const track of view.tracks) assert.ok(truckPose(track, time, result).position.every(Number.isFinite));
  }
});

test('rounded routes preserve endpoints and handle coincident points', () => {
  const route = makeRoute([[0, 0], [0, 0], [10, 0], [10, 10]]);
  assert.deepEqual(sampleRoute(route, 0).position, [0, 0]);
  assert.deepEqual(sampleRoute(route, 1).position, [10, 10]);
  assert.ok(route.length > 17 && route.length < 20);
  assert.deepEqual(sampleRoute(makeRoute([[3, 4], [3, 4]]), .5).position, [3, 4]);
});

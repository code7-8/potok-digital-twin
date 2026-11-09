import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_SCENARIO, createDataset } from '../lib/engine/fixtures.ts';
import { comparePaired, makeSeeds } from '../lib/engine/experiments.ts';
import { simulate } from '../lib/engine/simulation.ts';
import { bottleneck, comparisonMatches, sameScenario, scenarioChanges } from '../lib/decision-review.ts';
import { runDemonstration } from '../lib/demonstration.ts';

test('comparison freshness covers seed, operations, prices, outages and compatibility, independent of names and key order', () => {
  const base = structuredClone(BASE_SCENARIO);
  const comparison = comparePaired(createDataset(), base, base, makeSeeds(42, 3));
  assert.equal(comparisonMatches(comparison, { ...base, id: 'renamed', name: 'Новое название' }, 42), true);
  assert.equal(comparisonMatches(comparison, base, 43), false);
  for (const changed of [
    { ...base, bayCount: 4 }, { ...base, policy: 'due-date' as const }, { ...base, loadingSetupMinutes: 9 },
    { ...base, dedicatedBays: !base.dedicatedBays }, { ...base, costs: { ...base.costs, waitingPerTruckHour: 100 } },
    { ...base, outage: { bayIndex: 0, startMin: 120, durationMin: 60 } },
  ]) {
    assert.equal(comparisonMatches(comparison, changed, 42), false);
    assert.ok(scenarioChanges(base, changed).length > 0);
  }
  assert.equal(sameScenario(base, { ...base, costs: Object.fromEntries(Object.entries(base.costs).reverse()) as typeof base.costs }), true);
  assert.deepEqual(scenarioChanges(base, { ...base, name: 'Переименован' }), []);
});

test('queue analysis points to actual waiting and does not invent a bottleneck for empty demand', () => {
  const data = createDataset();
  const result = simulate(data, BASE_SCENARIO, 42);
  const info = bottleneck(result);
  assert.equal(info.stage, 'loading');
  assert.equal(info.minutes, result.metrics.waitsByStage.loading);
  assert.equal(info.peak.count, Math.max(...result.snapshots.map(s => s.gateQueue + s.supplyWait + s.loadingQueue + s.dispatchQueue)));
  const empty = bottleneck(simulate({ ...data, orders: [] }, BASE_SCENARIO, 42));
  assert.equal(empty.stage, null); assert.equal(empty.peak.count, 0);
});

test('demo baseline and queue step reproduce the exact same shift and preserve mass', () => {
  const data = createDataset(), before = JSON.stringify(data);
  const baseline = runDemonstration(data, 'baseline');
  const queue = runDemonstration(data, 'bottleneck');
  assert.deepEqual(baseline.simulation, queue.simulation);
  assert.equal(baseline.simulation.metrics.shippedTonnes, 1123);
  assert.equal(queue.focusTime, bottleneck(queue.simulation).peak.at);
  assert.equal(queue.comparison, null);
  assert.equal(JSON.stringify(data), before);
});

test('demo alternative and outage use actual paired simulations with equal disturbances', () => {
  const data = createDataset();
  const alternative = runDemonstration(data, 'alternative');
  const outage = runDemonstration(data, 'outage');
  for (const result of [alternative, outage]) {
    const c = result.comparison!;
    assert.equal(c.candidate.samples.length, 30);
    assert.deepEqual(c.baseline.seeds, c.candidate.seeds);
    assert.deepEqual(result.simulation.metrics, c.candidate.samples[0].metrics);
    assert.ok(c.candidate.samples.every(x => Math.abs(x.metrics.massBalanceErrorTonnes) < 1e-7));
    assert.deepEqual(result.simulation, simulate(data, result.simulation.scenario, 42));
  }
  assert.deepEqual(outage.comparison!.baseline.scenario.outage, outage.comparison!.candidate.scenario.outage);
  assert.equal(outage.simulation.scenario.outage?.durationMin, 120);
  assert.ok(outage.comparison!.candidate.estimates.serviceLevel.mean < alternative.comparison!.candidate.estimates.serviceLevel.mean);
  assert.ok(outage.focusTime > 240 && outage.focusTime < 360);
  assert.deepEqual(runDemonstration(data, 'outage'), outage);
});

test('demo fits a short shift and handles empty demand without fixed demo results', () => {
  const source = createDataset();
  const short = { ...source, horizonMin: 60, orders: [], batches: source.batches.map(b => ({ ...b, sampleReadyMin: 0 })) };
  const result = runDemonstration(short, 'outage');
  assert.equal(result.simulation.metrics.shippedTonnes, 0);
  assert.equal(result.simulation.scenario.outage?.durationMin, 10);
  assert.equal(result.focusTime, 25);
  assert.equal(result.comparison!.candidate.estimates.shippedTonnes.mean, 0);
});

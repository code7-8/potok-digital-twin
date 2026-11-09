import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { BASE_SCENARIO, createDataset } from '../lib/engine/fixtures.ts';
import { simulate } from '../lib/engine/simulation.ts';
import { comparePaired, makeSeeds, resourceGrid, searchGrid } from '../lib/engine/experiments.ts';
import { executeComputation } from '../lib/compute-task.ts';

test('compute tasks preserve single and paired results across the worker extraction', () => {
  const data = createDataset(), scenario = { ...BASE_SCENARIO, bayCount: 4 };
  const input = { data, scenario, baseline: BASE_SCENARIO, seed: 47 };
  assert.deepEqual(executeComputation({ ...input, kind: 'single' }).result, simulate(data, scenario, 47));
  assert.deepEqual(executeComputation({ ...input, kind: 'compare' }).result, comparePaired(data, BASE_SCENARIO, scenario, makeSeeds(47, 30)));
  assert.throws(() => executeComputation({ ...input, kind: 'demo' }), /шаг/);
});

test('full search preserves the reference candidate, independent validation and explicit failed stress target', () => {
  const data = createDataset(), before = JSON.stringify(data), progress: number[] = [];
  const output = executeComputation({ kind: 'search', data, scenario: BASE_SCENARIO, baseline: BASE_SCENARIO, seed: 42 }, value => progress.push(value));
  assert.equal(output.kind, 'search');
  if (output.kind !== 'search') throw new Error('Wrong output kind');
  const r = output.result;
  assert.deepEqual(r.candidates, searchGrid(data, resourceGrid(BASE_SCENARIO), makeSeeds(20261109, 12)));
  assert.equal(r.candidates.length, 48);
  assert.equal(r.selected.scenario.id, 'b6-d2-l1-due-date');
  assert.equal(r.comparison.candidate.seeds.length, 30);
  const training = new Set(makeSeeds(20261109, 12));
  assert.ok(r.comparison.candidate.seeds.every(s => !training.has(s)));
  assert.ok(r.comparison.candidate.estimates.serviceLevel.mean >= .85);
  assert.ok(r.stress.candidate.estimates.serviceLevel.mean < .85);
  assert.ok(progress.every((v, i) => i === 0 || v >= progress[i - 1]));
  assert.deepEqual(r.sourceScenario, BASE_SCENARIO);
  assert.equal(JSON.stringify(data), before);
});

test('production worker handler transfers real results and survives a rejected input', { timeout: 15000 }, async t => {
  const worker = new Worker(new URL('./helpers/compute-thread.mjs', import.meta.url));
  t.after(() => worker.terminate());
  assert.deepEqual((await once(worker, 'message'))[0], { ready: true });
  const data = createDataset();
  const exchange = async (message: unknown) => {
    const reply = once(worker, 'message'); worker.postMessage(message); return (await reply)[0];
  };
  const bad = await exchange({ id: 7, kind: 'single', data, scenario: { ...BASE_SCENARIO, bayCount: -1 }, baseline: BASE_SCENARIO, seed: 42 });
  assert.equal(bad.id, 7); assert.equal(typeof bad.error, 'string');
  const good = await exchange({ id: 8, kind: 'demo', demoStep: 'alternative', data, scenario: BASE_SCENARIO, baseline: BASE_SCENARIO, seed: 42 });
  assert.equal(good.id, 8); assert.equal(good.kind, 'demo');
  assert.equal(good.result.comparison.candidate.samples.length, 30);
  assert.deepEqual(good.result.simulation.metrics, good.result.comparison.candidate.samples[0].metrics);
});

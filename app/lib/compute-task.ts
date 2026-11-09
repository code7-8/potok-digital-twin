import { simulate } from './engine/simulation.ts';
import { evaluate, comparePaired, makeSeeds, paretoFront, resourceGrid, summarizeCandidate, waitingCostSensitivity, type PairedComparison, type SearchCandidate } from './engine/experiments.ts';
import type { Dataset, Scenario } from './engine/types.ts';
import { runDemonstration, type DemoStep } from './demonstration.ts';

export type ComputeKind = 'single' | 'compare' | 'search' | 'demo';
export interface ComputeInput { kind: ComputeKind; data: Dataset; scenario: Scenario; baseline: Scenario; seed: number; demoStep?: DemoStep }
export interface SearchResult {
  candidates: SearchCandidate[]; selected: SearchCandidate; comparison: PairedComparison; stress: PairedComparison;
  targetFeasible: boolean; sensitivity: ReturnType<typeof waitingCostSensitivity>; sourceScenario: Scenario;
}
export function executeComputation(input: ComputeInput, progress: (value: number, message: string) => void = () => {}) {
  const { kind, data, scenario, baseline, seed } = input;
  if (kind === 'single') return { kind, result: simulate(data, scenario, seed) };
  if (kind === 'compare') return { kind, result: comparePaired(data, baseline, scenario, makeSeeds(seed, 30)) };
  if (kind === 'demo') {
    if (!input.demoStep || !['baseline', 'bottleneck', 'alternative', 'outage'].includes(input.demoStep)) throw new Error('Неизвестный шаг демонстрации');
    return { kind, result: runDemonstration(data, input.demoStep) };
  }
  const grid = resourceGrid(scenario), seeds = makeSeeds(20261109, 12);
  const candidates = grid.map((s, i) => {
    const e = evaluate(data, s, seeds);
    progress(Math.round((i + 1) / grid.length * 85), `Проверено ${i + 1} из ${grid.length} вариантов`);
    return summarizeCandidate(e);
  });
  const front = new Set(paretoFront(candidates));
  const scored = candidates.map(c => ({ ...c, pareto: front.has(c) }));
  const feasible = scored.filter(x => x.service >= .85).sort((a, b) => a.cost - b.cost);
  const selected = feasible[0] ?? [...scored].sort((a, b) => b.service - a.service || a.cost - b.cost)[0];
  progress(90, 'Независимая проверка выбранного варианта');
  const validationSeeds = makeSeeds(987654321, 30);
  const comparison = comparePaired(data, baseline, selected.scenario, validationSeeds);
  const outage = { bayIndex: 0, startMin: Math.min(240, data.horizonMin / 3), durationMin: Math.min(120, data.horizonMin / 6) };
  const stress = comparePaired(data, { ...baseline, outage }, { ...selected.scenario, outage }, validationSeeds);
  const result: SearchResult = { candidates: scored, selected, comparison, stress, sensitivity: waitingCostSensitivity(scored), targetFeasible: feasible.length > 0, sourceScenario: structuredClone(scenario) };
  return { kind, result };
}

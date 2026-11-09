import { BASE_SCENARIO } from './engine/fixtures.ts';
import { comparePaired, makeSeeds, type PairedComparison } from './engine/experiments.ts';
import { simulate } from './engine/simulation.ts';
import type { Dataset, SimulationResult } from './engine/types.ts';
import { bottleneck } from './decision-review.ts';

export type DemoStep = 'baseline' | 'bottleneck' | 'alternative' | 'outage';
export interface DemoResult { step: DemoStep; simulation: SimulationResult; comparison: PairedComparison | null; focusTime: number }
export const DEMO_SEED = 42;
export const DEMO_STEPS: Array<{ id: DemoStep; label: string }> = [
  { id: 'baseline', label: 'Базовая смена' }, { id: 'bottleneck', label: 'Причина очереди' },
  { id: 'alternative', label: 'Изменение мощности' }, { id: 'outage', label: 'Проверка сбоя' },
];
/** A fixed demonstrative alternative, not the outcome of an optimization. */
export function runDemonstration(data: Dataset, step: DemoStep): DemoResult {
  const baseline = structuredClone(BASE_SCENARIO);
  const candidate = { ...structuredClone(BASE_SCENARIO), id: 'demo-capacity', name: '6 постов · 2 оформления · по сроку', bayCount: 6, dispatchCount: 2, policy: 'due-date' as const };
  if (step === 'outage') {
    const outage = { bayIndex: 0, startMin: Math.min(240, data.horizonMin / 3), durationMin: Math.min(120, data.horizonMin / 6) };
    baseline.outage = { ...outage }; baseline.name = 'Базовая смена со сбоем';
    candidate.outage = { ...outage }; candidate.name = 'Альтернатива со сбоем';
  }
  const compare = step === 'alternative' || step === 'outage';
  const simulation = simulate(data, compare ? candidate : baseline, DEMO_SEED);
  const comparison = compare ? comparePaired(data, baseline, candidate, makeSeeds(DEMO_SEED, 30)) : null;
  const focusTime = step === 'bottleneck' ? bottleneck(simulation).peak.at
    : step === 'outage' ? candidate.outage!.startMin + candidate.outage!.durationMin / 2
    : Math.min(120, data.horizonMin);
  return { step, simulation, comparison, focusTime };
}

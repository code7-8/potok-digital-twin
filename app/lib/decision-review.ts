import { makeSeeds, type PairedComparison } from './engine/experiments.ts';
import type { Scenario, SimulationResult, Stage } from './engine/types.ts';

export const POLICY_LABELS = { fifo: 'По прибытию', 'due-date': 'По сроку', product: 'По продукту' };
export const STAGE_LABELS: Record<Stage, string> = { gate: 'Регистрация', supply: 'Продукт и качество', loading: 'Посты налива', dispatch: 'Оформление' };
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}
/** Names/IDs do not affect the model; all numerical and operational inputs do. */
export function sameScenario(a: Scenario, b: Scenario): boolean {
  const { id: _a, name: _an, ...left } = a;
  const { id: _b, name: _bn, ...right } = b;
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}
export function comparisonMatches(comparison: PairedComparison, scenario: Scenario, seed: number): boolean {
  return sameScenario(comparison.candidate.scenario, scenario)
    && JSON.stringify(comparison.candidate.seeds) === JSON.stringify(makeSeeds(seed, comparison.candidate.seeds.length));
}
export function scenarioChanges(a: Scenario, b: Scenario) {
  const numbers: Array<[keyof Scenario, string, string]> = [
    ['bayCount', 'Посты налива', ''], ['dispatchCount', 'Оформление', ''], ['labCount', 'Лаборатория', ''], ['gateCount', 'Регистрация', ''],
    ['loadingTonnesPerHour', 'Скорость налива', ' т/ч'], ['gateMinutes', 'Регистрация', ' мин'], ['dispatchMinutes', 'Оформление', ' мин'],
    ['loadingSetupMinutes', 'Подготовка поста', ' мин'], ['productSwitchMinutes', 'Смена продукта', ' мин'], ['labTimeFactor', 'Время лаборатории', ' ×'], ['variability', 'Разброс длительностей', ''],
  ];
  const changes = numbers.filter(([key]) => a[key] !== b[key]).map(([key, label, unit]) => ({ key, label, before: `${a[key]}${unit}`, after: `${b[key]}${unit}` }));
  if (a.policy !== b.policy) changes.push({ key: 'policy', label: 'Очередь', before: POLICY_LABELS[a.policy], after: POLICY_LABELS[b.policy] });
  if (a.dedicatedBays !== b.dedicatedBays) changes.push({ key: 'dedicatedBays', label: 'Совместимость постов', before: a.dedicatedBays ? 'Учтена' : 'Все универсальные', after: b.dedicatedBays ? 'Учтена' : 'Все универсальные' });
  const outage = (s: Scenario) => s.outage ? `Пост ${s.outage.bayIndex + 1}, с ${s.outage.startMin} мин на ${s.outage.durationMin} мин` : 'Нет';
  if (outage(a) !== outage(b)) changes.push({ key: 'outage', label: 'Сбой', before: outage(a), after: outage(b) });
  const costLabels: Record<keyof Scenario['costs'], string> = { gatePerHour: 'Регистрация, ₽/ч', labPerHour: 'Лаборатория, ₽/ч', bayPerHour: 'Пост, ₽/ч', dispatchPerHour: 'Оформление, ₽/ч', waitingPerTruckHour: 'Ожидание, ₽/маш.-ч', perTonne: 'Обработка, ₽/т' };
  for (const key of Object.keys(costLabels) as Array<keyof Scenario['costs']>) {
    if (a.costs[key] !== b.costs[key]) changes.push({ key: 'costs', label: costLabels[key], before: String(a.costs[key]), after: String(b.costs[key]) });
  }
  return changes;
}
/** No queue is labelled a bottleneck when the entire shift has no waiting. */
export function bottleneck(result: SimulationResult) {
  const [stage, minutes] = Object.entries(result.metrics.waitsByStage).sort((a, b) => b[1] - a[1])[0] as [Stage, number];
  const peak = result.snapshots.reduce((best, s) => {
    const count = s.gateQueue + s.supplyWait + s.loadingQueue + s.dispatchQueue;
    return count > best.count ? { count, at: s.at } : best;
  }, { count: 0, at: 0 });
  return { stage: minutes > 0 ? stage : null, minutes, peak };
}

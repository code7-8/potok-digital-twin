import type { Dataset, Scenario, Metrics, SimulationResult } from './types.ts';
import { ENGINE_VERSION, simulate } from './simulation.ts';

export interface SavedRun {
  id:string;
  scenario_id:string;
  engine_version:string;
  seed:number;
  summary:{metrics:Metrics;dataHash:string};
  created_at:number;
}
export interface RunReplay { data:Dataset; scenario:Scenario; run:SavedRun }

/** Never silently replace a historical result with output from a different engine. */
export function replaySavedRun({data,scenario,run}:RunReplay):SimulationResult {
  if(run.engine_version!==ENGINE_VERSION)throw new Error(`Расчёт создан ядром ${run.engine_version}; текущее ядро — ${ENGINE_VERSION}. Скачайте исходную запись для анализа.`);
  const result=simulate(data,scenario,run.seed);
  if(!equalMetrics(result.metrics,run.summary.metrics))throw new Error('Повторный расчёт не совпал с сохранёнными показателями. Исходная запись сохранена без изменений.');
  return result;
}
function equalMetrics(a:unknown,b:unknown):boolean {
  if(a===b)return true;
  if(typeof a==='number'&&typeof b==='number')return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
  if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
  const aa=a as Record<string,unknown>,bb=b as Record<string,unknown>;
  return Object.keys(aa).length===Object.keys(bb).length&&Object.keys(aa).every(k=>Object.hasOwn(bb,k)&&equalMetrics(aa[k],bb[k]));
}

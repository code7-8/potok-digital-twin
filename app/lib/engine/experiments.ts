import type { Dataset, Metrics, Scenario } from './types.ts';
import { simulate } from './simulation.ts';
import { quantile } from './random.ts';

export interface Estimate {
  n: number; mean: number; sd: number; ci95Low: number; ci95High: number;
  p10: number; p90: number;
}
export type MetricKey = 'shippedTonnes'|'completedOrders'|'serviceLevel'|'totalCostRub'|'meanWaitMinutes'|'unfinishedOrders';
export const COMPARED_METRICS:MetricKey[]=['shippedTonnes','completedOrders','serviceLevel','totalCostRub','meanWaitMinutes','unfinishedOrders'];

// Two-sided Student t 97.5% critical values, df=1..30; asymptotic expansion above.
function critical95(df:number):number {
  const t=[0,12.7062,4.3027,3.1824,2.7764,2.5706,2.4469,2.3646,2.3060,2.2622,2.2281,2.2010,2.1788,2.1604,2.1448,2.1314,2.1199,2.1098,2.1009,2.0930,2.0860,2.0796,2.0739,2.0687,2.0639,2.0595,2.0555,2.0518,2.0484,2.0452,2.0423];
  if(df<=30)return t[df];
  const z=1.959963984540054;return z+(z**3+z)/(4*df)+(5*z**5+16*z**3+3*z)/(96*df**2);
}

export function estimate(values:number[]):Estimate {
  if(values.length<2||values.some(v=>!Number.isFinite(v)))throw new Error('Для интервала нужны минимум два конечных наблюдения');
  const n=values.length,mean=values.reduce((a,b)=>a+b,0)/n;
  const sd=Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/(n-1));
  const half=critical95(n-1)*sd/Math.sqrt(n);
  return {n,mean,sd,ci95Low:mean-half,ci95High:mean+half,p10:quantile(values,0.1)!,p90:quantile(values,0.9)!};
}

function checkSeeds(seeds:number[]){
  if(seeds.length<2||seeds.length>200||new Set(seeds).size!==seeds.length||seeds.some(n=>!Number.isInteger(n)||n<0||n>4294967295))throw new Error('Нужны 2–200 различных seeds в диапазоне uint32');
}

export function makeSeeds(start:number,count:number):number[]{return Array.from({length:count},(_,i)=>(start+Math.imul(i,104729))>>>0);}

export interface ExperimentResult {
  scenario:Scenario;
  seeds:number[];
  estimates:Record<MetricKey,Estimate>;
  samples:Array<{seed:number;metrics:Metrics}>;
}
export function evaluate(data:Dataset,scenario:Scenario,seeds:number[]):ExperimentResult {
  checkSeeds(seeds);
  const samples=seeds.map(seed=>({seed,metrics:simulate(data,scenario,seed).metrics}));
  return {scenario:structuredClone(scenario),seeds:[...seeds],samples,
    estimates:Object.fromEntries(COMPARED_METRICS.map(key=>[key,estimate(samples.map(s=>s.metrics[key]))])) as Record<MetricKey,Estimate>};
}

export interface PairedComparison {baseline:ExperimentResult;candidate:ExperimentResult;delta:Record<MetricKey,Estimate>}
/** Positive delta always means candidate minus baseline; interpretation depends on metric. */
export function comparePaired(data:Dataset,baseline:Scenario,candidate:Scenario,seeds:number[]):PairedComparison {
  const a=evaluate(data,baseline,seeds),b=evaluate(data,candidate,seeds);
  return {baseline:a,candidate:b,delta:Object.fromEntries(COMPARED_METRICS.map(key=>[key,estimate(seeds.map((_,i)=>b.samples[i].metrics[key]-a.samples[i].metrics[key]))])) as Record<MetricKey,Estimate>};
}

/** Pareto objectives: minimize modelled total cost, maximize on-time fraction of ALL demand. */
export function paretoFront<T extends {cost:number;service:number}>(items:T[]):T[]{
  return items.filter((x,i)=>!items.some((y,j)=>i!==j&&y.cost<=x.cost&&y.service>=x.service&&(y.cost<x.cost||y.service>x.service)));
}

export interface SearchCandidate {scenario:Scenario;cost:number;service:number;shipped:number;pareto:boolean;fixedAndHandlingCost:number;queueHours:number}
export function searchGrid(data:Dataset,scenarios:Scenario[],seeds:number[]):SearchCandidate[]{
  checkSeeds(seeds);
  if(!scenarios.length||scenarios.length>120)throw new Error('Сетка должна содержать 1–120 сценариев');
  if(new Set(scenarios.map(s=>s.id)).size!==scenarios.length)throw new Error('ID сценариев в сетке должны различаться');
  const candidates=scenarios.map(s=>{const e=evaluate(data,s,seeds);return summarizeCandidate(e);});
  const front=new Set(paretoFront(candidates));return candidates.map(c=>({...c,pareto:front.has(c)}));
}

export function summarizeCandidate(e:ExperimentResult):SearchCandidate {
  return {scenario:e.scenario,cost:e.estimates.totalCostRub.mean,service:e.estimates.serviceLevel.mean,shipped:e.estimates.shippedTonnes.mean,pareto:false,
    fixedAndHandlingCost:e.samples.reduce((n,x)=>n+x.metrics.resourceCostRub+x.metrics.handlingCostRub,0)/e.samples.length,
    queueHours:e.samples.reduce((n,x)=>n+Object.values(x.metrics.waitsByStage).reduce((a,b)=>a+b,0)/60,0)/e.samples.length};
}
/** Reprice identical physical results. Costs never drive queue ordering in this model. */
export function waitingCostSensitivity(candidates:SearchCandidate[],rates=[150,300,600,900]){
  if(!candidates.length)throw new Error('Для анализа чувствительности нужен хотя бы один сценарий');
  if(rates.some(r=>!Number.isFinite(r)||r<0))throw new Error('Некорректная стоимость ожидания');
  return rates.map(rate=>{
    const repriced=candidates.map(c=>({...c,cost:c.fixedAndHandlingCost+c.queueHours*rate}));
    const feasible=repriced.filter(c=>c.service>=.85).sort((a,b)=>a.cost-b.cost);
    const selected=feasible[0]??[...repriced].sort((a,b)=>b.service-a.service||a.cost-b.cost)[0];
    return {rate,selectedId:selected.scenario.id,selectedScenario:selected.scenario,meanCost:selected.cost,meanService:selected.service,paretoCount:paretoFront(repriced).length,targetFeasible:feasible.length>0};
  });
}

export function resourceGrid(base:Scenario):Scenario[]{
  const candidates:Scenario[]=[];
  for(const bayCount of [3,4,5,6])for(const dispatchCount of [1,2])for(const labCount of [1,2])for(const policy of ['fifo','due-date','product'] as const){
    candidates.push({...structuredClone(base),id:`b${bayCount}-d${dispatchCount}-l${labCount}-${policy}`,name:`${bayCount} поста · ${dispatchCount} оформление · ${labCount} лаборатория · ${policy}`,bayCount,dispatchCount,labCount,policy});
  }
  return candidates;
}

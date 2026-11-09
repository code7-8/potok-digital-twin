import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { simulate, createDataset, BASE_SCENARIO, resourceGrid, searchGrid, makeSeeds, comparePaired, waitingCostSensitivity } from '../lib/engine/index.ts';

const dir=new URL('../outputs/experiments/',import.meta.url);mkdirSync(dir,{recursive:true});
const data=createDataset(),start=performance.now();
const base=simulate(data,BASE_SCENARIO,42);
const training=makeSeeds(20261109,12),validation=makeSeeds(987654321,30);
const grid=searchGrid(data,resourceGrid(BASE_SCENARIO),training);
// Explicit decision rule: among candidates with mean SLA >= 85%, lowest model cost.
const feasible=grid.filter(x=>x.service>=0.85).sort((a,b)=>a.cost-b.cost);
const candidate=feasible[0]??[...grid].sort((a,b)=>b.service-a.service||a.cost-b.cost)[0];
const comparison=comparePaired(data,BASE_SCENARIO,candidate.scenario,validation);
const stress={bayIndex:0,startMin:240,durationMin:120};
const stressed=comparePaired(data,{...BASE_SCENARIO,outage:stress},{...candidate.scenario,outage:stress},validation);
const result={generatedAt:new Date().toISOString(),data,baseline:base,trainingSeeds:training,validationSeeds:validation,selectionRule:'Minimize modelled mean cost at training mean SLA >= 0.85; if infeasible, maximize SLA, then minimize cost',targetFeasible:feasible.length>0,grid,candidate,comparison,stressed,sensitivity:waitingCostSensitivity(grid),elapsedMs:performance.now()-start};
writeFileSync(new URL('reference-experiment.json',dir),JSON.stringify(result,null,2));
writeFileSync(new URL('synthetic-dataset.json',dir),JSON.stringify(data,null,2));
console.log(JSON.stringify({baseline:base.metrics,candidate:candidate.scenario,trainingFeasible:feasible.length,paretoCount:grid.filter(x=>x.pareto).length,validationDelta:comparison.delta,stressDelta:stressed.delta,elapsedMs:result.elapsedMs},null,2));

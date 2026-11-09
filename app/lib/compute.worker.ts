import { simulate } from './engine/simulation.ts';
import { evaluate, comparePaired, makeSeeds, paretoFront, resourceGrid, summarizeCandidate, waitingCostSensitivity } from './engine/experiments.ts';
import type { Dataset, Scenario } from './engine/types.ts';
self.onmessage=(event:MessageEvent<{id:number;kind:'single'|'compare'|'search';data:Dataset;scenario:Scenario;baseline:Scenario;seed:number}>)=>{
  const {id,kind,data,scenario,baseline,seed}=event.data;
  try{
    if(kind==='single'){self.postMessage({id,kind,result:simulate(data,scenario,seed)});return;}
    if(kind==='compare'){
      const result=comparePaired(data,baseline,scenario,makeSeeds(seed,30));self.postMessage({id,kind,result});return;
    }
    const grid=resourceGrid(scenario),seeds=makeSeeds(20261109,12);
    const candidates=grid.map((s,i)=>{
      const e=evaluate(data,s,seeds);self.postMessage({id,progress:Math.round((i+1)/grid.length*85),message:`Проверено ${i+1} из ${grid.length} вариантов`});
      return summarizeCandidate(e);
    });
    const front=new Set(paretoFront(candidates));const scored=candidates.map(c=>({...c,pareto:front.has(c)}));
    const feasible=scored.filter(x=>x.service>=.85).sort((a,b)=>a.cost-b.cost);
    const selected=feasible[0]??[...scored].sort((a,b)=>b.service-a.service||a.cost-b.cost)[0];
    self.postMessage({id,progress:90,message:'Независимая проверка выбранного варианта'});
    const validationSeeds=makeSeeds(987654321,30);
    const comparison=comparePaired(data,baseline,selected.scenario,validationSeeds);
    const outage={bayIndex:0,startMin:Math.min(240,data.horizonMin/3),durationMin:Math.min(120,data.horizonMin/6)};
    const stress=comparePaired(data,{...baseline,outage},{...selected.scenario,outage},validationSeeds);
    self.postMessage({id,kind,result:{candidates:scored,selected,comparison,stress,sensitivity:waitingCostSensitivity(scored),targetFeasible:feasible.length>0}});
  }catch(e){self.postMessage({id,error:e instanceof Error?e.message:'Не удалось рассчитать модель'});}
};

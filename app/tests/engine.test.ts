import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, BASE_SCENARIO, createDataset, ModelValidationError, comparePaired, estimate, paretoFront, searchGrid, makeSeeds, evaluate, summarizeCandidate, waitingCostSensitivity } from '../lib/engine/index.ts';
import type { Dataset, Scenario, SimulationResult } from '../lib/engine/types.ts';

const close=(a:number,b:number,eps=1e-7)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
test('waiting-cost repricing agrees with a full rerun and preserves physical KPIs',()=>{
  const data=createDataset(18),seeds=makeSeeds(17,6),scenario=structuredClone(BASE_SCENARIO);
  const original=summarizeCandidate(evaluate(data,scenario,seeds));
  for(const rate of [0,150,900]){
    const priced=waitingCostSensitivity([original],[rate])[0];
    const rerun=evaluate(data,{...scenario,costs:{...scenario.costs,waitingPerTruckHour:rate}},seeds);
    close(priced.meanCost,rerun.estimates.totalCostRub.mean);
    close(priced.meanService,rerun.estimates.serviceLevel.mean);
    close(original.shipped,rerun.estimates.shippedTonnes.mean);
  }
});
test('sensitivity exposes a decision reversal and validates missing candidates',()=>{
  const candidate=(id:string,fixed:number,queue:number)=>({scenario:{...BASE_SCENARIO,id},cost:fixed+queue*900,service:.9,shipped:100,pareto:false,fixedAndHandlingCost:fixed,queueHours:queue});
  const rows=waitingCostSensitivity([candidate('lean',1000,10),candidate('fast',2500,1)],[100,500]);
  assert.equal(rows[0].selectedId,'lean');close(rows[0].meanCost,2000);
  assert.equal(rows[1].selectedId,'fast');close(rows[1].meanCost,3000);
  assert.throws(()=>waitingCostSensitivity([]));
  assert.throws(()=>waitingCostSensitivity([candidate('x',1,1)],[-1]));
});
function tiny(n=1):Dataset{return {id:'tiny',version:'1',provenance:'synthetic',horizonMin:100,
  tanks:[{id:'tank',product:'diesel',capacityTonnes:1000}],batches:[{id:'batch',tankId:'tank',product:'diesel',tonnes:1000,sampleReadyMin:0,labMinutes:0}],
  orders:Array.from({length:n},(_,i)=>({id:`order-${i}`,product:'diesel',tonnes:10,arrivalMin:0,dueMin:100}))};}
function simple(overrides:Partial<Scenario>={}):Scenario{return {...structuredClone(BASE_SCENARIO),gateCount:1,labCount:1,bayCount:1,dispatchCount:1,gateMinutes:2,loadingSetupMinutes:0,productSwitchMinutes:0,loadingTonnesPerHour:60,dispatchMinutes:3,variability:0,dedicatedBays:false,...overrides};}

function invariants(r:SimulationResult){
  close(r.metrics.massBalanceErrorTonnes,0);
  assert.equal(r.metrics.completedOrders+r.metrics.unfinishedOrders+r.metrics.notArrivedOrders,r.metrics.demandOrders);
  close(r.metrics.initialStockTonnes,r.metrics.remainingStockTonnes+r.metrics.reservedTonnes+r.metrics.loadedInSystemTonnes+r.metrics.shippedTonnes);
  for(const b of r.batches){assert.ok(b.remainingTonnes>=-1e-7);close(b.tonnes,b.remainingTonnes+b.allocatedTonnes);}
  for(const o of r.orders){
    if(o.gate)assert.ok(o.gate.start>=o.arrivalMin);
    if(o.load){assert.ok(o.load.start>=o.gate!.end);close(o.allocations.reduce((a,x)=>a+x.tonnes,0),o.tonnes);for(const a of o.allocations){const b=r.batches.find(b=>b.id===a.batchId)!;assert.equal(b.product,o.product);assert.ok(b.releasedAt!==null&&b.releasedAt<=o.load.start);}}
    if(o.dispatch)assert.ok(o.dispatch.start>=o.load!.end);
    if(o.completedAt!==undefined){assert.equal(o.completedAt,o.dispatch!.end);assert.ok(o.completedAt<=r.horizonMin);}
    for(const wait of Object.values(o.waits))assert.ok(wait>=0&&Number.isFinite(wait));
  }
  for(let i=1;i<r.events.length;i++)assert.ok(r.events[i].at>=r.events[i-1].at);
  for(const resource of r.resources){assert.ok(resource.utilization>=-1e-8&&resource.utilization<=1+1e-8,`${resource.id} utilization ${resource.utilization}`);
    const visits=r.orders.flatMap(o=>[o.gate,o.load,o.dispatch].filter(v=>v?.resourceId===resource.id)).sort((a,b)=>a!.start-b!.start);
    for(let i=1;i<visits.length;i++)assert.ok(visits[i]!.start>=visits[i-1]!.end-1e-8,`overlap ${resource.id}`);
  }
}

test('one order has exact analytical cycle and resource utilization',()=>{
  const r=simulate(tiny(),simple());invariants(r);close(r.orders[0].completedAt!,15);close(r.metrics.meanCycleMinutes!,15);close(r.metrics.meanWaitMinutes,0);
  close(r.resources.find(x=>x.id==='loading-1')!.busyMinutes,10);close(r.resources.find(x=>x.id==='loading-1')!.utilization,0.1);close(r.metrics.shippedTonnes,10);
});
test('two simultaneous orders produce exact queue waits',()=>{
  const r=simulate(tiny(2),simple());invariants(r);assert.deepEqual(r.orders.map(o=>o.completedAt),[15,25]);close(r.orders[1].waits.gate,2);close(r.orders[1].waits.loading,8);close(r.metrics.meanWaitMinutes,5);
});
test('quality release is shared across orders, not a laboratory visit per truck',()=>{
  const d=tiny(2);d.batches[0].labMinutes=20;const r=simulate(d,simple({bayCount:2}));invariants(r);assert.equal(r.events.filter(e=>e.type==='quality-release').length,1);close(r.orders[0].load!.start,20);close(r.orders[1].load!.start,20);close(r.orders[0].waits.supply,18);close(r.orders[1].waits.supply,16);
});
test('parallel bays cannot consume the same stock twice',()=>{
  const d=tiny(3);d.batches[0].tonnes=15;const r=simulate(d,simple({bayCount:3,gateMinutes:0}));invariants(r);assert.equal(r.metrics.completedOrders,1);assert.equal(r.metrics.unfinishedOrders,2);close(r.metrics.remainingStockTonnes,5);
});
test('allocation may span multiple released batches of the same product',()=>{
  const d=tiny();d.batches[0].tonnes=4;d.batches.push({...d.batches[0],id:'batch-2',tonnes:6});const r=simulate(d,simple());invariants(r);assert.equal(r.orders[0].allocations.length,2);close(r.metrics.shippedTonnes,10);
});
test('unreleased stock cannot be used to complete a partial allocation',()=>{
  const d=tiny();d.batches[0].tonnes=4;d.batches.push({...d.batches[0],id:'batch-2',tonnes:6,sampleReadyMin:40});const r=simulate(d,simple());invariants(r);close(r.orders[0].load!.start,40);close(r.orders[0].waits.supply,38);
});
test('horizon cuts active loading: reserved mass and active time stay correct',()=>{
  const d=tiny();d.horizonMin=8;d.orders[0].dueMin=20;const r=simulate(d,simple());invariants(r);close(r.metrics.reservedTonnes,10);close(r.metrics.shippedTonnes,0);close(r.resources.find(x=>x.id==='loading-1')!.busyMinutes,6);assert.equal(r.metrics.meanCycleMinutes,null);
});
test('loaded but not dispatched product remains in system at horizon',()=>{
  const d=tiny();d.horizonMin=13;d.orders[0].dueMin=20;const r=simulate(d,simple());invariants(r);close(r.metrics.loadedInSystemTonnes,10);close(r.metrics.reservedTonnes,0);close(r.metrics.handlingCostRub,280);
});
test('completion exactly at horizon counts as completed',()=>{
  const d=tiny();d.horizonMin=15;d.orders[0].dueMin=15;const r=simulate(d,simple());invariants(r);assert.equal(r.metrics.completedOrders,1);assert.equal(r.metrics.onTimeOrders,1);
});
test('orders arriving after horizon remain visible in demand and SLA denominator',()=>{
  const d=tiny(2);d.orders[1].arrivalMin=120;d.orders[1].dueMin=140;const r=simulate(d,simple());invariants(r);assert.equal(r.metrics.notArrivedOrders,1);assert.equal(r.metrics.serviceLevel,0.5);
});
test('no gate means all arrived orders wait until horizon',()=>{
  const r=simulate(tiny(2),simple({gateCount:0}));invariants(r);close(r.metrics.waitsByStage.gate,200);assert.equal(r.metrics.completedOrders,0);
});
test('no laboratory means batches never release',()=>{
  const r=simulate(tiny(),simple({labCount:0}));invariants(r);assert.equal(r.batches[0].releasedAt,null);assert.equal(r.orders[0].state,'supply-wait');close(r.orders[0].waits.supply,98);
});
test('no loading capacity means loading queue, not missing stock',()=>{
  const r=simulate(tiny(),simple({bayCount:0}));invariants(r);assert.equal(r.orders[0].state,'loading-queue');close(r.orders[0].waits.loading,98);
});
test('no dispatch capacity preserves loaded inventory and final waiting',()=>{
  const r=simulate(tiny(),simple({dispatchCount:0}));invariants(r);assert.equal(r.orders[0].state,'dispatch-queue');close(r.orders[0].waits.dispatch,88);close(r.metrics.loadedInSystemTonnes,10);
});
test('outage pauses an active load and excludes downtime from utilization',()=>{
  const r=simulate(tiny(),simple({outage:{bayIndex:0,startMin:5,durationMin:20}}));invariants(r);close(r.orders[0].load!.end,32);close(r.orders[0].completedAt!,35);const bay=r.resources.find(x=>x.id==='loading-1')!;close(bay.busyMinutes,10);close(bay.unavailableMinutes,20);close(bay.utilization,10/80);
});
test('load finishing exactly when outage starts is not paused',()=>{
  const r=simulate(tiny(),simple({outage:{bayIndex:0,startMin:12,durationMin:20}}));invariants(r);close(r.orders[0].completedAt!,15);
});
test('idle bay cannot start a load during outage',()=>{
  const r=simulate(tiny(),simple({outage:{bayIndex:0,startMin:0,durationMin:20}}));invariants(r);close(r.orders[0].load!.start,20);close(r.orders[0].completedAt!,33);
});
test('outage crossing horizon clips unavailable and productive minutes',()=>{
  const d=tiny();d.horizonMin=10;d.orders[0].dueMin=20;const r=simulate(d,simple({outage:{bayIndex:0,startMin:5,durationMin:10}}));invariants(r);const bay=r.resources.find(x=>x.id==='loading-1')!;close(bay.busyMinutes,3);close(bay.unavailableMinutes,5);close(bay.utilization,0.6);
});
test('resource costs use explicit units and waiting includes unfinished orders',()=>{
  const r=simulate(tiny(2),simple({gateCount:0}));const h=100/60;close(r.metrics.resourceCostRub,h*(1100+1700+650));close(r.metrics.waitingCostRub,200/60*900);close(r.metrics.handlingCostRub,0);assert.equal(r.metrics.unitCostRubPerTonne,null);
});
test('empty demand is valid and produces finite metrics',()=>{
  const r=simulate(tiny(0),simple());invariants(r);assert.equal(r.metrics.meanCycleMinutes,null);assert.equal(r.metrics.meanWaitMinutes,0);assert.equal(r.metrics.serviceLevel,0);
});
test('same inputs produce deeply identical output and do not mutate inputs',()=>{
  const d=createDataset(),s=structuredClone(BASE_SCENARIO),before=JSON.stringify({d,s});const a=simulate(d,s,99),b=simulate(d,s,99);assert.deepEqual(a,b);assert.equal(JSON.stringify({d,s}),before);
});
test('noise is attached to entity/operation across resource changes',()=>{
  const d=createDataset(12),a=simulate(d,BASE_SCENARIO,33),b=simulate(d,{...BASE_SCENARIO,gateCount:4},33);for(const o of a.orders){const other=b.orders.find(x=>x.id===o.id)!;close(o.gate!.activeMinutes,other.gate!.activeMinutes);}
});
test('invalid capacity, duplicate IDs, NaN, missing references and overfilled tanks reject',()=>{
  assert.throws(()=>simulate(tiny(),simple({bayCount:-1})),ModelValidationError);
  assert.throws(()=>simulate(tiny(),simple({loadingTonnesPerHour:NaN})),ModelValidationError);
  const d=tiny(2);d.orders[1].id=d.orders[0].id;assert.throws(()=>simulate(d,simple()),ModelValidationError);
  const e=tiny();e.batches[0].tankId='missing';assert.throws(()=>simulate(e,simple()),ModelValidationError);
  const f=tiny();f.tanks[0].capacityTonnes=2;assert.throws(()=>simulate(f,simple()),ModelValidationError);
});
test('dedicated bays never load an incompatible product',()=>{
  const r=simulate(createDataset(90),BASE_SCENARIO,7);invariants(r);for(const o of r.orders){if(o.load?.resourceId==='loading-2')assert.equal(o.product,'diesel');if(o.load?.resourceId==='loading-3')assert.equal(o.product,'gasoline');}
});
test('model invariants hold across seeds, policies, resource changes and disruptions',()=>{
  const d=createDataset(100);for(const seed of makeSeeds(100,12))for(const policy of ['fifo','due-date','product'] as const){const s={...BASE_SCENARIO,policy,bayCount:2+seed%5,dispatchCount:1+seed%2,outage:{bayIndex:0,startMin:180,durationMin:90}};invariants(simulate(d,s,seed));}
});
test('identical paired scenarios have exactly zero deltas and interval',()=>{
  const c=comparePaired(tiny(),simple(),simple(),[1,2,3]);for(const e of Object.values(c.delta)){close(e.mean,0);close(e.ci95Low,0);close(e.ci95High,0);}
});
test('confidence interval is for mean, wider than zero when sample varies',()=>{
  const e=estimate([1,2,3,4,5]);close(e.mean,3);close(e.sd,Math.sqrt(2.5));assert.ok(e.ci95Low<3&&e.ci95High>3);assert.equal(e.n,5);assert.throws(()=>estimate([1]));
});
test('Pareto rejects dominated points but keeps genuine trade-offs and ties',()=>{
  const a={cost:10,service:.7},b={cost:20,service:.9},c={cost:25,service:.8},d={cost:10,service:.7};assert.deepEqual(paretoFront([a,b,c,d]),[a,b,d]);
});
test('experiment rejects duplicate seeds and search rejects duplicate scenario IDs',()=>{
  assert.throws(()=>comparePaired(tiny(),simple(),simple(),[1,1]));assert.throws(()=>searchGrid(tiny(),[simple(),simple()],[1,2]));
});

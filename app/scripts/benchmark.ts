import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createDataset, BASE_SCENARIO } from '../lib/engine/fixtures.ts';
import { ENGINE_VERSION, simulate } from '../lib/engine/simulation.ts';
import type { Dataset, Scenario } from '../lib/engine/types.ts';

const large=createDataset(2000);
large.id='benchmark-boundary';large.horizonMin=10080;
large.tanks=Array.from({length:100},(_,i)=>({id:`T${i}`,product:i%2?'gasoline':'diesel',capacityTonnes:3000}));
large.batches=Array.from({length:300},(_,i)=>({id:`B${i}`,tankId:`T${i%100}`,product:i%2?'gasoline':'diesel',tonnes:1000,sampleReadyMin:i/10,labMinutes:2}));
const fast={...BASE_SCENARIO,gateCount:24,labCount:24,bayCount:6,dispatchCount:24,loadingTonnesPerHour:120,loadingSetupMinutes:0,dispatchMinutes:2};
const congested={...fast,gateCount:1,labCount:1,bayCount:3,dispatchCount:1,loadingTonnesPerHour:42,dispatchMinutes:10};
const workloads:Array<{name:string;data:Dataset;scenario:Scenario}>=[
  {name:'reference-84',data:createDataset(),scenario:BASE_SCENARIO},
  {name:'limit-2000-orders-300-batches-100-tanks',data:large,scenario:fast},
  {name:'limit-congested',data:{...large,horizonMin:720},scenario:congested},
];
const results=workloads.map(({name,data,scenario})=>{
  const times:number[]=[];let sample;
  for(let i=0;i<3;i++){
    const start=performance.now();sample=simulate(data,scenario,42);times.push(performance.now()-start);
    assert.ok(Math.abs(sample.metrics.massBalanceErrorTonnes)<1e-7);
    assert.equal(sample.metrics.arrivedOrders,sample.metrics.completedOrders+sample.metrics.unfinishedOrders);
    assert.ok(sample.resources.every(r=>r.utilization>=0&&r.utilization<=1+1e-9));
  }
  times.sort((a,b)=>a-b);
  return {name,orders:data.orders.length,batches:data.batches.length,tanks:data.tanks.length,horizonMin:data.horizonMin,medianMs:times[1],minMs:times[0],maxMs:times[2],completed:sample!.metrics.completedOrders,events:sample!.events.length,outputBytes:Buffer.byteLength(JSON.stringify(sample)),resultSha256:createHash('sha256').update(JSON.stringify(sample)).digest('hex'),massBalanceError:sample!.metrics.massBalanceErrorTonnes};
});
let comparison:unknown=null;
const beforePath='outputs/benchmarks/before-stock-cache.json';
if(existsSync(beforePath)){
  const before=JSON.parse(readFileSync(beforePath,'utf8'));
  if(before.engineVersion===ENGINE_VERSION){
    comparison=results.map(r=>{
      const previous=before.results.find((p:{name:string})=>p.name===r.name);
      assert.equal(r.resultSha256,previous?.resultSha256,`Full result changed: ${r.name}`);
      return {name:r.name,identicalResult:true,speedup:previous.medianMs/r.medianMs};
    });
  }
}
const report={measuredAt:new Date().toISOString(),engineVersion:ENGINE_VERSION,node:process.version,platform:platform(),arch:arch(),cpu:cpus()[0]?.model,note:'Node measurements on this computer, three repetitions per workload. Not browser timings, service-level guarantees or worst-case bounds.',results,comparison};
mkdirSync('outputs/benchmarks',{recursive:true});writeFileSync('outputs/benchmarks/latest.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));

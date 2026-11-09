import type { Allocation, BatchResult, Dataset, EventRecord, OrderResult, Product, ResourceResult, Scenario, SimulationResult, Snapshot, Stage, Visit } from './types.ts';
import { durationFactor, quantile } from './random.ts';
import { validateModel } from './validation.ts';

export const ENGINE_VERSION = '1.0.0';
const EPS = 1e-8;
type InternalEvent = {at:number; kind:'arrival'|'gate-end'|'load-end'|'dispatch-end'|'release'|'wake'; id:number; resource?:number; serial:number};
type Server = {id:string; busy:boolean; lastProduct?:Product; result:ResourceResult};

/** Stable min heap. Complete all same-time events before dispatching queues. */
class Calendar {
  values: InternalEvent[] = [];
  private less(a:InternalEvent,b:InternalEvent) {return a.at < b.at || (a.at === b.at && a.serial < b.serial);}
  push(e:InternalEvent) {
    const a=this.values; a.push(e); let i=a.length-1;
    while(i>0){const p=(i-1)>>1;if(!this.less(a[i],a[p]))break;[a[i],a[p]]=[a[p],a[i]];i=p;}
  }
  peek(){return this.values[0];}
  pop(){const a=this.values;const first=a[0];const last=a.pop();if(a.length&&last){a[0]=last;let i=0;for(;;){let c=i*2+1;if(c>=a.length)break;if(c+1<a.length&&this.less(a[c+1],a[c]))c++;if(!this.less(a[c],a[i]))break;[a[i],a[c]]=[a[c],a[i]];i=c;}}return first;}
}

function overlap(a:number,b:number,c:number,d:number){return Math.max(0,Math.min(b,d)-Math.max(a,c));}

export function simulate(data: Dataset, scenario: Scenario, seed = 42): SimulationResult {
  validateModel(data,scenario,seed);
  const s=structuredClone(scenario), horizon=data.horizonMin;
  const orders: OrderResult[]=data.orders.map(o=>({...o,allocations:[],waits:{gate:0,supply:0,loading:0,dispatch:0},state:'not-arrived'}));
  const batches: BatchResult[]=data.batches.map(b=>({...b,releasedAt:null,labStart:null,labResource:null,remainingTonnes:b.tonnes,allocatedTonnes:0}));
  const makeServers=(n:number,stage:ResourceResult['stage']):Server[]=>Array.from({length:n},(_,i)=>({id:`${stage}-${i+1}`,busy:false,result:{id:`${stage}-${i+1}`,stage,busyMinutes:0,unavailableMinutes:0,utilization:0}}));
  const gates=makeServers(s.gateCount,'gate'), bays=makeServers(s.bayCount,'loading'), dispatchers=makeServers(s.dispatchCount,'dispatch'), labs=makeServers(s.labCount,'lab');
  const calendar=new Calendar();let serial=0;
  const schedule=(at:number,kind:InternalEvent['kind'],id:number,resource?:number)=>calendar.push({at,kind,id,resource,serial:serial++});
  const events:EventRecord[]=[],snapshots:Snapshot[]=[];
  const gateQueue:number[]=[], loadQueue:number[]=[], dispatchQueue:number[]=[];
  let now=0,completed=0,shipped=0;
  const outage=s.outage;
  const noise=(id:string,operation:string)=>durationFactor(seed,`${id}:${operation}`,s.variability);
  const labAvailable=labs.map(()=>0);
  // Laboratory is an independent FCFS release process over physically present batches.
  [...batches.keys()].sort((a,b)=>batches[a].sampleReadyMin-batches[b].sampleReadyMin||batches[a].id.localeCompare(batches[b].id)).forEach(i=>{
    if(!labs.length)return;
    const b=batches[i];let k=0;for(let j=1;j<labs.length;j++)if(labAvailable[j]<labAvailable[k])k=j;
    const start=Math.max(b.sampleReadyMin,labAvailable[k]);
    const end=start+b.labMinutes*s.labTimeFactor*noise(b.id,'lab');
    b.labStart=start;b.labResource=labs[k].id;b.releasedAt=end;labAvailable[k]=end;
    labs[k].result.busyMinutes+=overlap(start,end,0,horizon);
    schedule(end,'release',i);
  });
  orders.forEach((o,i)=>schedule(o.arrivalMin,'arrival',i));
  if(outage){schedule(outage.startMin,'wake',-1);schedule(outage.startMin+outage.durationMin,'wake',-2);bays[outage.bayIndex].result.unavailableMinutes=overlap(outage.startMin,outage.startMin+outage.durationMin,0,horizon);}
  // Eligibility queries share the same time and inventory until an allocation changes it.
  // Recompute using the original reduction order, rather than maintaining a running sum:
  // this preserves floating-point results and every allocation decision exactly.
  const stockCache=new Map<Product,number>();
  const stock=(p:Product)=>{
    if(!stockCache.has(p))stockCache.set(p,batches.reduce((a,b)=>a+(b.product===p&&b.releasedAt!==null&&b.releasedAt<=now+EPS?b.remainingTonnes:0),0));
    return stockCache.get(p)!;
  };
  const eligible=(o:OrderResult)=>stock(o.product)+EPS>=o.tonnes;
  const compatible=(bay:number,p:Product)=>!s.dedicatedBays||bay%3===0||(bay%3===1&&p==='diesel')||(bay%3===2&&p==='gasoline');
  const isDown=(bay:number)=>outage?.bayIndex===bay&&now>=outage.startMin-EPS&&now<outage.startMin+outage.durationMin-EPS;
  const allocate=(o:OrderResult):Allocation[]=>{
    let remaining=o.tonnes;const allocation:Allocation[]=[];
    for(const b of [...batches].sort((a,b)=>(a.releasedAt??Infinity)-(b.releasedAt??Infinity)||a.id.localeCompare(b.id))){
      if(b.product!==o.product||b.releasedAt===null||b.releasedAt>now+EPS||b.remainingTonnes<=EPS)continue;
      const amount=Math.min(remaining,b.remainingTonnes); b.remainingTonnes-=amount;b.allocatedTonnes+=amount;allocation.push({batchId:b.id,tonnes:amount});remaining-=amount;if(remaining<=EPS)break;
    }
    if(remaining>EPS)throw new Error('Internal invariant: insufficient stock on allocation');
    stockCache.delete(o.product);
    return allocation;
  };
  const priority=(a:number,b:number,resource?:Server)=>{
    const x=orders[a],y=orders[b];
    if(s.policy==='due-date'&&x.dueMin!==y.dueMin)return x.dueMin-y.dueMin;
    if(s.policy==='product'&&resource?.lastProduct){const v=Number(y.product===resource.lastProduct)-Number(x.product===resource.lastProduct);if(v)return v;}
    return x.arrivalMin-y.arrivalMin||x.id.localeCompare(y.id);
  };
  const startVisit=(o:OrderResult,server:Server,duration:number,stage:Exclude<Stage,'supply'>,index:number,kind:InternalEvent['kind']):Visit=>{
    let end=now+duration;
    // Preempt-and-resume: an active load pauses during this bay's outage. No product loss.
    if(stage==='loading'&&outage?.bayIndex===index&&now<outage.startMin&&end>outage.startMin)end+=outage.durationMin;
    const stopped=stage==='loading'&&outage?.bayIndex===index?overlap(now,Math.min(end,horizon),outage.startMin,outage.startMin+outage.durationMin):0;
    server.result.busyMinutes+=overlap(now,end,0,horizon)-stopped;server.busy=true;
    events.push({at:now,type:'start',entityId:o.id,stage,resourceId:server.id});schedule(end,kind,orders.indexOf(o),index);
    return {start:now,end,resourceId:server.id,activeMinutes:duration};
  };
  const assign=()=>{
    stockCache.clear(); // A release event or a time advance may have changed availability.
    gateQueue.sort((a,b)=>priority(a,b));
    gates.forEach((r,i)=>{if(r.busy||!gateQueue.length)return;const o=orders[gateQueue.shift()!];o.state='gate';o.gate=startVisit(o,r,s.gateMinutes*noise(o.id,'gate'),'gate',i,'gate-end');});
    bays.forEach((r,i)=>{
      if(r.busy||isDown(i))return;
      const candidates=loadQueue.filter(j=>compatible(i,orders[j].product)&&eligible(orders[j])).sort((a,b)=>priority(a,b,r));
      if(!candidates.length)return;
      const j=candidates[0],o=orders[j];loadQueue.splice(loadQueue.indexOf(j),1);o.allocations=allocate(o);o.state='loading';
      const setup=s.loadingSetupMinutes+(r.lastProduct&&r.lastProduct!==o.product?s.productSwitchMinutes:0);
      const duration=(setup+o.tonnes/s.loadingTonnesPerHour*60)*noise(o.id,'loading');
      o.load=startVisit(o,r,duration,'loading',i,'load-end');r.lastProduct=o.product;
    });
    dispatchQueue.sort((a,b)=>priority(a,b));
    dispatchers.forEach((r,i)=>{if(r.busy||!dispatchQueue.length)return;const o=orders[dispatchQueue.shift()!];o.state='dispatch';o.dispatch=startVisit(o,r,s.dispatchMinutes*noise(o.id,'dispatch'),'dispatch',i,'dispatch-end');});
    for(const j of loadQueue)orders[j].state=eligible(orders[j])?'loading-queue':'supply-wait';
  };
  const advance=(to:number)=>{
    const dt=to-now;
    if(dt<-EPS)throw new Error('Internal invariant: event time decreased');
    for(const o of orders){if(o.state==='gate-queue')o.waits.gate+=dt;else if(o.state==='supply-wait')o.waits.supply+=dt;else if(o.state==='loading-queue')o.waits.loading+=dt;else if(o.state==='dispatch-queue')o.waits.dispatch+=dt;}
    now=to;
  };
  const snapshot=()=>snapshots.push({at:now,completed,shippedTonnes:shipped,gateQueue:gateQueue.length,supplyWait:orders.filter(o=>o.state==='supply-wait').length,loadingQueue:orders.filter(o=>o.state==='loading-queue').length,loading:bays.filter(r=>r.busy).length,dispatchQueue:dispatchQueue.length,dispatching:dispatchers.filter(r=>r.busy).length,stockTonnes:batches.reduce((a,b)=>a+b.remainingTonnes,0)});
  snapshot();
  while(calendar.peek()&&calendar.peek().at<=horizon){
    advance(calendar.peek().at);
    do{
      const e=calendar.pop(),o=orders[e.id];
      if(e.kind==='arrival'){o.state='gate-queue';gateQueue.push(e.id);events.push({at:now,type:'arrival',entityId:o.id,stage:'gate'});}
      else if(e.kind==='gate-end'){gates[e.resource!].busy=false;loadQueue.push(e.id);events.push({at:now,type:'finish',entityId:o.id,stage:'gate',resourceId:gates[e.resource!].id});}
      else if(e.kind==='load-end'){bays[e.resource!].busy=false;dispatchQueue.push(e.id);o.state='dispatch-queue';events.push({at:now,type:'finish',entityId:o.id,stage:'loading',resourceId:bays[e.resource!].id});}
      else if(e.kind==='dispatch-end'){dispatchers[e.resource!].busy=false;o.state='completed';o.completedAt=now;completed++;shipped+=o.tonnes;events.push({at:now,type:'finish',entityId:o.id,stage:'dispatch',resourceId:dispatchers[e.resource!].id});}
      else if(e.kind==='release')events.push({at:now,type:'quality-release',entityId:batches[e.id].id,stage:'lab',resourceId:batches[e.id].labResource!});
      else events.push({at:now,type:e.id===-1?'outage-start':'outage-end',entityId:bays[outage!.bayIndex].id,stage:'loading'});
    }while(calendar.peek()&&calendar.peek().at===now);
    assign();snapshot();
  }
  advance(horizon);snapshot();
  const allResources=[...gates,...labs,...bays,...dispatchers].map(r=>({...r.result,utilization:horizon-r.result.unavailableMinutes>EPS?r.result.busyMinutes/(horizon-r.result.unavailableMinutes):0}));
  const completedOrders=orders.filter(o=>o.completedAt!==undefined),arrived=orders.filter(o=>o.arrivalMin<=horizon);
  const cycles=completedOrders.map(o=>o.completedAt!-o.arrivalMin);
  const waits={gate:0,supply:0,loading:0,dispatch:0};for(const o of orders)for(const stage of Object.keys(waits) as Stage[])waits[stage]+=o.waits[stage];
  const totalWait=Object.values(waits).reduce((a,b)=>a+b,0), hours=horizon/60;
  const resourceCost=hours*(s.gateCount*s.costs.gatePerHour+s.labCount*s.costs.labPerHour+s.bayCount*s.costs.bayPerHour+s.dispatchCount*s.costs.dispatchPerHour);
  const waitingCost=totalWait/60*s.costs.waitingPerTruckHour;
  const initialStock=data.batches.reduce((a,b)=>a+b.tonnes,0),remainingStock=batches.reduce((a,b)=>a+b.remainingTonnes,0);
  const reserved=orders.filter(o=>o.load&&o.load.end>horizon).reduce((a,o)=>a+o.tonnes,0);
  const loadedInSystem=orders.filter(o=>o.load&&o.load.end<=horizon&&o.completedAt===undefined).reduce((a,o)=>a+o.tonnes,0);
  const handled=orders.filter(o=>o.load&&o.load.end<=horizon).reduce((a,o)=>a+o.tonnes,0),handlingCost=handled*s.costs.perTonne;
  const onTime=completedOrders.filter(o=>o.completedAt!<=o.dueMin+EPS).length;
  return {engineVersion:ENGINE_VERSION,datasetId:data.id,datasetVersion:data.version,scenario:s,seed,horizonMin:horizon,
    metrics:{demandOrders:orders.length,arrivedOrders:arrived.length,completedOrders:completed,unfinishedOrders:arrived.length-completed,notArrivedOrders:orders.length-arrived.length,onTimeOrders:onTime,serviceLevel:orders.length?onTime/orders.length:0,shippedTonnes:shipped,demandTonnes:orders.reduce((a,o)=>a+o.tonnes,0),throughputTonnesPerHour:shipped/hours,
      meanCycleMinutes:cycles.length?cycles.reduce((a,b)=>a+b,0)/cycles.length:null,p95CycleMinutes:quantile(cycles,0.95),meanWaitMinutes:arrived.length?totalWait/arrived.length:0,waitsByStage:waits,
      resourceCostRub:resourceCost,waitingCostRub:waitingCost,handlingCostRub:handlingCost,totalCostRub:resourceCost+waitingCost+handlingCost,unitCostRubPerTonne:shipped?(resourceCost+waitingCost+handlingCost)/shipped:null,
      massBalanceErrorTonnes:initialStock-remainingStock-reserved-loadedInSystem-shipped,initialStockTonnes:initialStock,remainingStockTonnes:remainingStock,reservedTonnes:reserved,loadedInSystemTonnes:loadedInSystem},
    orders,batches,resources:allResources,events,snapshots};
}

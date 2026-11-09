import type { OrderResult, SimulationResult, Snapshot } from './types.ts';
export function snapshotAt(result:SimulationResult,time:number):Snapshot{
  let found=result.snapshots[0];for(const s of result.snapshots){if(s.at>time)break;found=s;}return found;
}
export function orderStateAt(o:OrderResult,time:number,result:SimulationResult):string{
  if(time<o.arrivalMin)return 'not-arrived';
  if(o.completedAt!==undefined&&time>=o.completedAt)return 'completed';
  if(o.dispatch&&time>=o.dispatch.start)return 'dispatch';
  if(o.load&&time>=o.load.end)return 'dispatch-queue';
  if(o.load&&time>=o.load.start){const outage=result.scenario.outage;return outage&&o.load.resourceId===`loading-${outage.bayIndex+1}`&&time>=outage.startMin&&time<outage.startMin+outage.durationMin?'paused':'loading';}
  if(o.gate&&time>=o.gate.end)return 'waiting';
  if(o.gate&&time>=o.gate.start)return 'gate';
  return 'gate-queue';
}
export const STATE_LABELS:Record<string,string>={'not-arrived':'Ожидается прибытие','completed':'Отгружено','dispatch':'Контроль и оформление','dispatch-queue':'Ожидает оформления','loading':'Налив','paused':'Налив приостановлен','waiting':'Ожидает продукт или пост','gate':'Регистрация','gate-queue':'Очередь регистрации'};

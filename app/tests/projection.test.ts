import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate} from '../lib/engine/simulation.ts';
import {BASE_SCENARIO,createDataset} from '../lib/engine/fixtures.ts';
import {orderStateAt,snapshotAt} from '../lib/engine/projection.ts';

test('projection never reveals future completions and matches final counters',()=>{
  const r=simulate(createDataset(),BASE_SCENARIO,42);
  for(const t of [0,45,150,240,719,720]){const count=r.orders.filter(o=>orderStateAt(o,t,r)==='completed').length;assert.equal(count,snapshotAt(r,t).completed);}
  assert.equal(snapshotAt(r,720).completed,r.metrics.completedOrders);
});
test('each visit projects to the correct stage at its boundaries',()=>{
  const r=simulate(createDataset(),BASE_SCENARIO,42),o=r.orders.find(o=>o.completedAt)!;
  assert.equal(orderStateAt(o,o.arrivalMin-.01,r),'not-arrived');
  assert.equal(orderStateAt(o,o.gate!.start,r),'gate');
  assert.equal(orderStateAt(o,o.load!.start,r),'loading');
  assert.equal(orderStateAt(o,o.dispatch!.start,r),'dispatch');
  assert.equal(orderStateAt(o,o.completedAt!,r),'completed');
});
test('a paused load is shown as paused only during the affected outage',()=>{
  const r=simulate(createDataset(),{...BASE_SCENARIO,outage:{bayIndex:0,startMin:240,durationMin:120}},42);
  const o=r.orders.find(o=>o.load?.resourceId==='loading-1'&&o.load.start<240&&o.load.end>360)!;
  assert.ok(o);assert.equal(orderStateAt(o,250,r),'paused');assert.equal(orderStateAt(o,360,r),'loading');
});

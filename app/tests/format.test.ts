import test from 'node:test';
import assert from 'node:assert/strict';
import { timeLabel } from '../lib/format.ts';
test('shift clock carries midnight and multi-day horizons without invalid hours',()=>{
  assert.equal(timeLabel(0),'08:00');assert.equal(timeLabel(720),'20:00');
  assert.equal(timeLabel(959.9),'23:59');assert.equal(timeLabel(960),'00:00 (+1 д.)');
  assert.equal(timeLabel(10080),'08:00 (+7 д.)');
});

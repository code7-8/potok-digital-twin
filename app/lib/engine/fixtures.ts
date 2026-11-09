import type { Dataset, Scenario } from './types.ts';
import { uniform } from './random.ts';

export const BASE_SCENARIO: Scenario = {
  id: 'baseline', name: 'Базовая смена', gateCount: 1, labCount: 1, bayCount: 3,
  dispatchCount: 1, gateMinutes: 4, loadingTonnesPerHour: 42,
  loadingSetupMinutes: 6, productSwitchMinutes: 5, dispatchMinutes: 10,
  labTimeFactor: 1, variability: 0.25, policy: 'fifo', dedicatedBays: true,
  outage: null,
  costs: { gatePerHour: 550, labPerHour: 1100, bayPerHour: 1700,
    dispatchPerHour: 650, waitingPerTruckHour: 900, perTonne: 28 },
};

/** Fixture-generation seed is independent from the experiment seed. */
export function createDataset(count = 84, seed = 20261109): Dataset {
  if (!Number.isInteger(count) || count < 0 || count > 2000) throw new Error('count must be 0..2000');
  const horizonMin = 720;
  const orders = Array.from({length: count}, (_, i) => {
    const id = `TR-${String(i + 1).padStart(3,'0')}`;
    const u = uniform(seed, id + ':arrival');
    // A 40% morning peak; all orders and due dates are preserved between scenarios.
    const arrivalMin = Math.round((u < 0.4 ? 35 + u / 0.4 * 145 : 180 + (u - 0.4) / 0.6 * 400) * 10) / 10;
    // Three explicit synthetic urgency classes, independent of the random arrival order.
    const serviceWindow = [90,150,240][(i+1)%3];
    return { id, product: uniform(seed,id + ':product') < 0.62 ? 'diesel' as const : 'gasoline' as const,
      tonnes: 20 + Math.floor(uniform(seed,id + ':volume') * 9), arrivalMin, dueMin: Math.min(horizonMin, arrivalMin + serviceWindow) };
  }).sort((a,b) => a.arrivalMin - b.arrivalMin || a.id.localeCompare(b.id));
  return {
    id:'terminal-synthetic-v1-1', version:'1.1.0', provenance:'synthetic', horizonMin,
    orders,
    tanks:[{id:'T-D1',product:'diesel',capacityTonnes:1200},{id:'T-D2',product:'diesel',capacityTonnes:1200},
      {id:'T-G1',product:'gasoline',capacityTonnes:1000},{id:'T-G2',product:'gasoline',capacityTonnes:1000}],
    batches:[
      {id:'B-D1',tankId:'T-D1',product:'diesel',tonnes:900,sampleReadyMin:0,labMinutes:38},
      {id:'B-G1',tankId:'T-G1',product:'gasoline',tonnes:650,sampleReadyMin:0,labMinutes:42},
      {id:'B-D2',tankId:'T-D2',product:'diesel',tonnes:900,sampleReadyMin:150,labMinutes:55},
      {id:'B-G2',tankId:'T-G2',product:'gasoline',tonnes:650,sampleReadyMin:200,labMinutes:45},
    ],
  };
}

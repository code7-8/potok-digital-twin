/** Minutes, tonnes and rubles are the only internal units. No wall clock or IO. */
export type Product = 'diesel' | 'gasoline';
export type Policy = 'fifo' | 'due-date' | 'product';
export type Stage = 'gate' | 'supply' | 'loading' | 'dispatch';
export interface Order {
  id: string;
  product: Product;
  tonnes: number;
  arrivalMin: number;
  dueMin: number;
}
export interface Tank { id: string; product: Product; capacityTonnes: number }
export interface Batch {
  id: string;
  tankId: string;
  product: Product;
  tonnes: number;
  sampleReadyMin: number;
  labMinutes: number;
}
export interface Dataset {
  id: string;
  version: string;
  provenance: 'synthetic';
  horizonMin: number;
  orders: Order[];
  tanks: Tank[];
  batches: Batch[];
}
export interface Outage { bayIndex: number; startMin: number; durationMin: number }
export interface Scenario {
  id: string;
  name: string;
  gateCount: number;
  labCount: number;
  bayCount: number;
  dispatchCount: number;
  gateMinutes: number;
  loadingTonnesPerHour: number;
  loadingSetupMinutes: number;
  productSwitchMinutes: number;
  dispatchMinutes: number;
  labTimeFactor: number;
  variability: number;
  policy: Policy;
  /** Bay compatibility repeats: flexible, diesel, gasoline, flexible... */
  dedicatedBays: boolean;
  outage: Outage | null;
  costs: {
    gatePerHour: number;
    labPerHour: number;
    bayPerHour: number;
    dispatchPerHour: number;
    waitingPerTruckHour: number;
    perTonne: number;
  };
}
export interface Visit {
  start: number;
  end: number;
  resourceId: string;
  activeMinutes: number;
}
export interface Allocation { batchId: string; tonnes: number }
export interface OrderResult extends Order {
  gate?: Visit;
  load?: Visit;
  dispatch?: Visit;
  allocations: Allocation[];
  waits: Record<Stage, number>;
  completedAt?: number;
  state: 'not-arrived' | 'gate-queue' | 'gate' | 'supply-wait' | 'loading-queue' | 'loading' | 'dispatch-queue' | 'dispatch' | 'completed';
}
export interface BatchResult extends Batch {
  releasedAt: number | null;
  labStart: number | null;
  labResource: string | null;
  remainingTonnes: number;
  allocatedTonnes: number;
}
export interface ResourceResult {
  id: string;
  stage: Exclude<Stage, 'supply'> | 'lab';
  busyMinutes: number;
  unavailableMinutes: number;
  utilization: number;
}
export interface EventRecord {
  at: number;
  type: 'arrival' | 'start' | 'finish' | 'quality-release' | 'outage-start' | 'outage-end';
  entityId: string;
  stage: Stage | 'lab';
  resourceId?: string;
}
export interface Snapshot {
  at: number;
  completed: number;
  shippedTonnes: number;
  gateQueue: number;
  supplyWait: number;
  loadingQueue: number;
  loading: number;
  dispatchQueue: number;
  dispatching: number;
  stockTonnes: number;
}
export interface Metrics {
  demandOrders: number;
  arrivedOrders: number;
  completedOrders: number;
  unfinishedOrders: number;
  notArrivedOrders: number;
  onTimeOrders: number;
  serviceLevel: number;
  shippedTonnes: number;
  demandTonnes: number;
  throughputTonnesPerHour: number;
  meanCycleMinutes: number | null;
  p95CycleMinutes: number | null;
  meanWaitMinutes: number;
  waitsByStage: Record<Stage, number>;
  resourceCostRub: number;
  waitingCostRub: number;
  handlingCostRub: number;
  totalCostRub: number;
  unitCostRubPerTonne: number | null;
  massBalanceErrorTonnes: number;
  initialStockTonnes: number;
  remainingStockTonnes: number;
  reservedTonnes: number;
  loadedInSystemTonnes: number;
}
export interface SimulationResult {
  engineVersion: string;
  datasetId: string;
  datasetVersion: string;
  scenario: Scenario;
  seed: number;
  horizonMin: number;
  metrics: Metrics;
  orders: OrderResult[];
  batches: BatchResult[];
  resources: ResourceResult[];
  events: EventRecord[];
  snapshots: Snapshot[];
}

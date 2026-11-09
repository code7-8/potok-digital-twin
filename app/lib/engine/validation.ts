import type { Dataset, Scenario } from './types.ts';

export class ModelValidationError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super(issues.join('; ')); this.name = 'ModelValidationError'; this.issues = issues;
  }
}

export function validateModel(data: Dataset, s: Scenario, seed: number): void {
  const issues: string[] = [];
  const number = (value: unknown, name: string, min: number, max: number, integer = false) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) issues.push(`${name}: ожидается ${integer ? 'целое ' : ''}число от ${min} до ${max}`);
  };
  if (!data || !s) throw new ModelValidationError(['Нужны набор данных и сценарий']);
  if (typeof data !== 'object' || typeof s !== 'object') throw new ModelValidationError(['Набор данных и сценарий должны быть объектами']);
  for (const [label, value] of [['dataset.id',data.id],['dataset.version',data.version],['scenario.id',s.id],['scenario.name',s.name]]) if(typeof value!=='string'||!value.trim()||value.length>128)issues.push(`${label}: нужна непустая строка до 128 символов`);
  number(seed, 'seed', 0, 4294967295, true);
  number(data.horizonMin, 'horizonMin', 1, 10080);
  if (data.provenance !== 'synthetic') issues.push('Эта версия принимает только явно обозначенные синтетические данные');
  for (const [key, max] of [['orders', 2000], ['batches', 300], ['tanks', 100]] as const) {
    if (!Array.isArray(data[key]) || data[key].length > max) issues.push(`${key}: ожидается массив, не более ${max} элементов`);
  }
  if (issues.length) throw new ModelValidationError(issues);
  for (const key of ['orders','batches','tanks'] as const) if(data[key].some(item=>!item||typeof item!=='object'||Array.isArray(item))) issues.push(`${key}: каждый элемент должен быть объектом`);
  if(issues.length)throw new ModelValidationError(issues);
  const ids = new Set<string>();
  const id = (value: unknown, path: string) => {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) issues.push(`${path}: недопустимый ID`);
    else if (ids.has(value)) issues.push(`${path}: повтор ID ${value}`);
    else ids.add(value);
  };
  for (const o of data.orders) {
    id(o.id, 'order');
    if (!['diesel','gasoline'].includes(o.product)) issues.push(`${o.id}: неизвестный продукт`);
    number(o.tonnes, `${o.id}.tonnes`, 0.01, 100);
    number(o.arrivalMin, `${o.id}.arrivalMin`, 0, data.horizonMin * 2);
    number(o.dueMin, `${o.id}.dueMin`, o.arrivalMin, data.horizonMin * 3);
  }
  for (const t of data.tanks) {
    id(t.id, 'tank'); number(t.capacityTonnes, `${t.id}.capacityTonnes`, 0.01, 1000000);
    if (!['diesel','gasoline'].includes(t.product)) issues.push(`${t.id}: неизвестный продукт`);
  }
  for (const b of data.batches) {
    id(b.id, 'batch');
    number(b.tonnes, `${b.id}.tonnes`, 0.01, 1000000);
    number(b.sampleReadyMin, `${b.id}.sampleReadyMin`, 0, data.horizonMin * 2);
    number(b.labMinutes, `${b.id}.labMinutes`, 0, 1440);
    const tank = data.tanks.find(t => t.id === b.tankId);
    if (!tank || tank.product !== b.product) issues.push(`${b.id}: резервуар отсутствует или содержит другой продукт`);
  }
  for (const t of data.tanks) {
    if (data.batches.filter(b => b.tankId === t.id).reduce((n,b) => n+b.tonnes,0) > t.capacityTonnes + 1e-8) issues.push(`${t.id}: начальный запас превышает ёмкость`);
  }
  for (const key of ['gateCount','labCount','bayCount','dispatchCount'] as const) number(s[key], key, 0, 24, true);
  if(s.bayCount>6)issues.push('bayCount: в модели участка не более 6 постов');
  for (const key of ['gateMinutes','loadingSetupMinutes','productSwitchMinutes','dispatchMinutes'] as const) number(s[key], key, 0, 1440);
  number(s.loadingTonnesPerHour, 'loadingTonnesPerHour', 0.01, 10000);
  number(s.labTimeFactor, 'labTimeFactor', 0, 20);
  number(s.variability, 'variability', 0, 0.95);
  if (!['fifo','due-date','product'].includes(s.policy)) issues.push('Неизвестное правило очереди');
  if (typeof s.dedicatedBays !== 'boolean') issues.push('dedicatedBays: ожидается boolean');
  if (!s.costs || typeof s.costs !== 'object') issues.push('Отсутствуют расценки');
  else for (const key of ['gatePerHour','labPerHour','bayPerHour','dispatchPerHour','waitingPerTruckHour','perTonne'] as const) number(s.costs[key], `costs.${key}`, 0, 1000000);
  if (s.outage) {
    number(s.outage.bayIndex, 'outage.bayIndex', 0, Math.max(0,s.bayCount - 1), true);
    if (!s.bayCount) issues.push('Нельзя отключить отсутствующий пост');
    number(s.outage.startMin, 'outage.startMin', 0, data.horizonMin);
    number(s.outage.durationMin, 'outage.durationMin', 0.01, data.horizonMin);
  }
  if (issues.length) throw new ModelValidationError(issues);
}

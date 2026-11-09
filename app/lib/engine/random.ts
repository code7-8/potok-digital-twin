/** Stable keyed uniforms: changing scheduling must not change a job's random draw. */
export function uniform(seed: number, key: string): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return ((h >>> 0) + 0.5) / 4294967296;
}

/** Symmetric triangular noise in [1-v,1+v], expected value 1. */
export function durationFactor(seed: number, key: string, variability: number): number {
  return 1 + variability * (uniform(seed, key + ':a') + uniform(seed, key + ':b') - 1);
}

export function quantile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const x = (sorted.length - 1) * p;
  const i = Math.floor(x);
  return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (x - i);
}

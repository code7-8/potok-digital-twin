import { executeComputation, type ComputeInput } from './compute-task.ts';

self.onmessage = (event: MessageEvent<ComputeInput & { id: number }>) => {
  const { id } = event.data;
  try {
    const output = executeComputation(event.data, (progress, message) => self.postMessage({ id, progress, message }));
    self.postMessage({ id, ...output });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Не удалось рассчитать модель' });
  }
};

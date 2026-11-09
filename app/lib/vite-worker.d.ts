/** Vite resolves this constructor to a same-origin worker in dev and a bundled asset in production. */
declare module '*?worker' {
  const WorkerConstructor: { new(options?: WorkerOptions): Worker };
  export default WorkerConstructor;
}

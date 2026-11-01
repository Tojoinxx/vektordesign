/// <reference lib="webworker" />
import { SimRunner } from './runner';
import type { ToWorker } from './protocol';

/** Simulations-Worker: rechnet den Stoff neben der Oberfläche, ohne sie auszubremsen. */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const runner = new SimRunner((m, transfer) => scope.postMessage(m, transfer ?? []));

scope.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'start') runner.start(m.id, m.ex, m.opts);
  else runner.stop();
};

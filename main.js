// Qollab entry point (JS / Qiskit). The quantum work is Python in engine/bridge.py;
// `backend` is the machine picked in Select QPU.
// main.js waits for the first in-page Run, because IonQ jobs must be sent while main.js is still
// running (Qollab docs, JS / Qiskit projects, "Waiting for user input").
import * as bridge from 'engine.bridge';
import { start } from './src/js/ui.js';

const call = async (fn, kwargs = {}) => JSON.parse(await fn.callPromisingKwargs(kwargs));

await new Promise((resolve) => start({
  run: async (opts) => { try { return await call(bridge.run, { backend, ...opts }); } finally { resolve(); } },
}));

// Qollab entry point (JS / Qiskit). The quantum work is Python in engine/bridge.py;
// `backend` is the machine picked in Select QPU.
import * as bridge from 'engine.bridge';
import { start } from './ui.js';

const call = async (fn, kwargs = {}) => JSON.parse(await fn.callPromisingKwargs(kwargs));

start({ run: (opts) => call(bridge.run, { backend, ...opts }) });

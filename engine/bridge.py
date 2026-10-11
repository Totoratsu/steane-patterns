"""What the page calls. Returns JSON strings. On Qollab, main.js passes the selected `backend`."""

import json
import random

import numpy as np
from qiskit import QuantumCircuit, transpile
from qiskit.quantum_info import Statevector

from . import decoders, steane
from .circuit import BLOCKS, CHECKS, build
from .noise import CHANNELS

MAX_ROUNDS = 5
MAX_SHOTS = 256


def _ideal(logical: list, basis: str) -> dict:
    qc = QuantumCircuit(2)
    for name, *args in logical:
        angles, qubits = ([float(args[0])], args[1:]) if name[0] == "r" else ([], args)
        getattr(qc, name)(*angles, *(int(i) for i in qubits))
    if basis == "X":
        qc.h([0, 1])
    # Qiskit keys are "q1q0"; we show logical 0 first.
    return {k[::-1]: round(v, 4) for k, v in Statevector(qc).probabilities_dict().items() if v > 1e-9}


def _backend_problem(backend):
    name = str(getattr(backend, "name", backend)).lower()
    ops = getattr(getattr(backend, "target", None), "operation_names", ())
    if "ionq" in name or "reset" not in ops:
        return (f"'{name}' is not supported: repeated QEC rounds need mid-circuit measurement and reset on one reused "
                "ancilla, and only the built-in Qiskit simulator has been tested. Pick that one.")
    return None


def run(backend, logical: str = '[["h",0],["cx",0,1]]', channel: str = "depolarizing", p: float = 0.01,
        rounds: int = 3, basis: str = "Z", shots: int = 48, seed: int = 1) -> str:
    if problem := _backend_problem(backend):
        return json.dumps({"error": problem})
    if channel not in CHANNELS or not 0 <= float(p) <= 0.1:
        return json.dumps({"error": f"channel must be one of {sorted(CHANNELS)} and p between 0 and 0.1"})
    logical = json.loads(logical)
    rounds, shots = max(1, min(int(rounds), MAX_ROUNDS)), max(1, min(int(shots), MAX_SHOTS))
    chan = CHANNELS[channel](float(p))
    rng = random.Random(seed)
    built = [build(logical, chan, rounds, basis, rng) for _ in range(shots)]
    # Each trajectory is its own circuit with one shot, all in one job. Level 0 keeps the noise Paulis.
    circuits = transpile([qc for qc, _ in built], backend=backend, optimization_level=0)
    result = backend.run(circuits, shots=1, seed_simulator=seed).result()

    H, L = decoders.dem(rounds)
    llr = decoders.priors(rounds, *chan["prior"])
    nrng = np.random.default_rng(seed)
    decode = {"bp": lambda s: decoders.bp(H, llr, s),
              "relay": lambda s: decoders.relay_bp(H, llr, s, nrng)}
    cache = {k: {} for k in decode}
    n_data = 7 * (rounds + 1)
    col0 = 0 if basis == "Z" else 3  # Z checks catch X errors, which flip a Z readout

    out = []
    for i, (_, true_flip) in enumerate(built):
        bits = [int(c) for c in next(iter(result.get_counts(i)))[::-1]]
        grid = [bits[r * CHECKS:(r + 1) * CHECKS] for r in range(rounds)]
        data = bits[rounds * CHECKS:]
        shot = {"grid": grid, "data": data, "true_flip": true_flip, "raw": [], "bp": {}, "relay": {}}
        for k, off in enumerate(BLOCKS):
            d = np.array(data[off:off + 7], dtype=np.uint8)
            syn = [np.array(row[k * 6 + col0:k * 6 + col0 + 3], dtype=np.uint8) for row in grid] + [steane.H @ d % 2]
            det = np.concatenate([syn[0]] + [syn[t] ^ syn[t - 1] for t in range(1, rounds + 1)])
            shot["raw"].append(int(d.sum() % 2))
            for name, fn in decode.items():
                key = det.tobytes()
                if key not in cache[name]:
                    cache[name][key] = fn(det)
                e, converged = cache[name][key]
                flip = int(L @ e % 2)
                sh = shot[name]
                sh.setdefault("logical", []).append(shot["raw"][-1] ^ flip)
                sh.setdefault("ok", []).append(bool(flip == true_flip[k]))
                sh.setdefault("converged", []).append(bool(converged))
                sh.setdefault("data_marks", []).extend(off + int(j) % 7 for j in np.flatnonzero(e[:n_data]))
                sh.setdefault("meas_marks", []).extend(
                    [int(j // 3), k * 6 + col0 + int(j % 3)] for j in np.flatnonzero(e[n_data:]))
        out.append(shot)

    def fails(key):
        return sum(not all(s[key]["ok"]) for s in out) / shots

    def hist(key):
        h = {}
        for s in out:
            o = "".join(map(str, s[key]["logical"] if key else s["raw"]))
            h[o] = h.get(o, 0) + 1
        return h

    q = None if chan.get("approx") else decoders.limit(rounds, *chan["prior"])
    return json.dumps({
        "rounds": rounds, "shots": out, "basis": basis, "channel": channel, "p": p,
        "qubits": 15, "ideal": _ideal(logical, basis),
        "hist": {"raw": hist(None), "bp": hist("bp"), "relay": hist("relay")},
        "logical_error": {"raw": sum(any(s["true_flip"]) for s in out) / shots, "bp": fails("bp"), "relay": fails("relay"),
                          "limit": None if q is None else 1 - (1 - q) ** 2},  # two independent blocks
    })

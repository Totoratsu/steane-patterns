"""What the page calls. Returns JSON strings. On Qollab, main.js passes the selected `backend`.

Two modes, picked from the backend:
- reuse (built-in Qiskit simulator): one ancilla measured and reset after every check, so any
  number of rounds fits in 15 qubits. Noise is injected as Paulis and every shot is its own
  circuit, so the true error of each shot is known from the Pauli frame.
- fresh (IonQ): Qollab's IonQ route has no mid-circuit measurement or reset and takes one circuit
  per job. So: one round, a fresh ancilla per check (26 qubits), everything measured at the end,
  no injected noise (IonQ's noise model is the noise), one circuit with many shots. The true
  error is unknown, so each shot is judged against the ideal outcomes instead."""

import json
import random

import numpy as np
from qiskit import QuantumCircuit, transpile
from qiskit.quantum_info import Statevector

from . import decoders, steane
from .circuit import BLOCKS, CHECKS, NQ, build
from .noise import CHANNELS

MAX_ROUNDS = 5
MAX_SHOTS = 256
FRESH_QUBITS = 14 + CHECKS  # one round, one ancilla per check
# The IonQ simulator reports 29 qubits whatever noise model is picked, so the machine name
# (backend name or its noise_model option) also caps the budget.
IONQ_QUBITS = {"harmony": 11, "aria": 25}


def _ideal(logical: list, basis: str) -> dict:
    qc = QuantumCircuit(2)
    for name, *args in logical:
        angles, qubits = ([float(args[0])], args[1:]) if name[0] == "r" else ([], args)
        getattr(qc, name)(*angles, *(int(i) for i in qubits))
    if basis == "X":
        qc.h([0, 1])
    # Qiskit keys are "q1q0"; we show logical 0 first.
    return {k[::-1]: round(v, 4) for k, v in Statevector(qc).probabilities_dict().items() if v > 1e-9}


def _mode(backend):
    """Returns (mode, error): mode is "reuse" or "fresh", error a message for the page."""
    name = str(getattr(backend, "name", backend)).lower()
    if "ionq" in name:
        label = f"{name} {getattr(getattr(backend, 'options', None), 'noise_model', '') or ''}".lower()
        n = getattr(backend, "num_qubits", None)
        caps = [c for k, c in IONQ_QUBITS.items() if k in label] + ([n] if isinstance(n, int) else [])
        if caps and min(caps) < FRESH_QUBITS:
            return None, (f"'{name}' has {min(caps)} qubits. On IonQ this project runs one QEC round with a fresh "
                          f"ancilla for each of the 12 checks, which needs {FRESH_QUBITS} qubits. Pick IonQ Forte 1 "
                          "(29q), or the built-in Qiskit simulator for repeated rounds.")
        return "fresh", None
    ops = getattr(getattr(backend, "target", None), "operation_names", ())
    if "reset" not in ops:
        return None, (f"'{name}' is not supported: repeated QEC rounds need mid-circuit measurement and reset on one "
                      "reused ancilla. Pick the built-in Qiskit simulator, or IonQ Forte 1 for the one-round IonQ mode.")
    return "reuse", None


def _sample_reuse(logical, chan, rounds, basis, shots, seed, backend):
    """One circuit per shot (each with its own sampled noise), all in one job."""
    rng = random.Random(seed)
    built = [build(logical, chan, rounds, basis, rng) for _ in range(shots)]
    # Level 0 keeps the noise Paulis.
    circuits = transpile([qc for qc, _ in built], backend=backend, optimization_level=0)
    result = backend.run(circuits, shots=1, seed_simulator=seed).result()
    return [([int(c) for c in next(iter(result.get_counts(i)))[::-1]], flip) for i, (_, flip) in enumerate(built)]


def _sample_fresh(logical, basis, shots, seed, backend):
    """One noiseless circuit, `shots` shots, one job. The backend's own noise is the noise."""
    qc, _ = build(logical, {}, 1, basis, random.Random(seed), fresh=True)
    circuit = transpile(qc, backend=backend, optimization_level=0)
    counts = backend.run(circuit, shots=shots).result().get_counts()
    n = qc.num_clbits
    records = [[int(c) for c in key.replace(" ", "").zfill(n)[::-1]] for key, v in counts.items() for _ in range(int(v))]
    random.Random(seed).shuffle(records)  # counts lose the shot order; do not play them sorted
    return [(bits, None) for bits in records]


def run(backend, logical: str = '[["h",0],["cx",0,1]]', channel: str = "depolarizing", p: float = 0.01,
        rounds: int = 3, basis: str = "Z", shots: int = 48, seed: int = 1) -> str:
    mode, problem = _mode(backend)
    if problem:
        return json.dumps({"error": problem})
    if channel not in CHANNELS or not 0 <= float(p) <= 0.1:
        return json.dumps({"error": f"channel must be one of {sorted(CHANNELS)} and p between 0 and 0.1"})
    logical = json.loads(logical)
    rounds, shots = max(1, min(int(rounds), MAX_ROUNDS)), max(1, min(int(shots), MAX_SHOTS))
    # In the fresh mode the channel and p are only the decoders' prior; nothing is injected.
    chan = CHANNELS[channel](float(p))
    if mode == "fresh":
        rounds = 1
        samples = _sample_fresh(logical, basis, shots, seed, backend)
        shots = len(samples)
    else:
        samples = _sample_reuse(logical, chan, rounds, basis, shots, seed, backend)
    ideal = _ideal(logical, basis)

    H, L = decoders.dem(rounds)
    llr = decoders.priors(rounds, *chan["prior"])
    nrng = np.random.default_rng(seed)
    decode = {"bp": lambda s: decoders.bp(H, llr, s),
              "relay": lambda s: decoders.relay_bp(H, llr, s, nrng)}
    cache = {k: {} for k in decode}
    n_data = 7 * (rounds + 1)
    col0 = 0 if basis == "Z" else 3  # Z checks catch X errors, which flip a Z readout

    out = []
    for bits, true_flip in samples:
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
                if true_flip is not None:
                    sh.setdefault("ok", []).append(bool(flip == true_flip[k]))
                sh.setdefault("converged", []).append(bool(converged))
                sh.setdefault("data_marks", []).extend(off + int(j) % 7 for j in np.flatnonzero(e[:n_data]))
                sh.setdefault("meas_marks", []).extend(
                    [int(j // 3), k * 6 + col0 + int(j % 3)] for j in np.flatnonzero(e[n_data:]))
        if true_flip is None:
            # Judged against the ideal: a shot is right if its two-bit outcome can happen without noise.
            # This cannot blame one block, so both blocks get the shot's verdict.
            shot["raw_ok"] = "".join(map(str, shot["raw"])) in ideal
            for name in decode:
                shot[name]["ok"] = [("".join(map(str, shot[name]["logical"])) in ideal)] * 2
        else:
            shot["raw_ok"] = not any(true_flip)
        out.append(shot)

    # With an ideal that allows all four outcomes, the fresh mode has no way to tell an error.
    countable = mode == "reuse" or len(ideal) < 4

    def fails(key):
        if not countable:
            return None
        return sum(not (s["raw_ok"] if key == "raw" else all(s[key]["ok"])) for s in out) / shots

    def hist(key):
        h = {}
        for s in out:
            o = "".join(map(str, s[key]["logical"] if key else s["raw"]))
            h[o] = h.get(o, 0) + 1
        return h

    # The limit assumes the decoders' model is the true noise: only in the reuse mode, and not for SI1000.
    q = None if chan.get("approx") or mode == "fresh" else decoders.limit(rounds, *chan["prior"])
    return json.dumps({
        "mode": mode, "backend": str(getattr(backend, "name", backend)),
        "rounds": rounds, "shots": out, "basis": basis, "channel": channel, "p": p,
        "qubits": FRESH_QUBITS if mode == "fresh" else NQ, "ideal": ideal,
        "judged_by": "ideal" if mode == "fresh" else "frame",
        "hist": {"raw": hist(None), "bp": hist("bp"), "relay": hist("relay")},
        "logical_error": {"raw": fails("raw"), "bp": fails("bp"), "relay": fails("relay"),
                          "limit": None if q is None else 1 - (1 - q) ** 2},  # two independent blocks
    })

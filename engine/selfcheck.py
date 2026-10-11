"""python -m engine.selfcheck. Asserts the encoder, the decoders and the end-to-end run."""

import json
import random

import numpy as np
from qiskit import QuantumCircuit
from qiskit.providers.basic_provider import BasicSimulator
from qiskit.quantum_info import Pauli, Statevector

from . import bridge, decoders, steane
from .circuit import build
from .noise import CHANNELS


def check_encoder():
    for prep, z_l, x_l in (("", 1, 0), ("x", -1, 0), ("h", 0, 1)):
        qc = QuantumCircuit(7)
        if prep:
            getattr(qc, prep)(steane.INPUT)
        steane.encode(qc, 0)
        sv = Statevector(qc)
        for row in steane.H:
            for P in "XZ":
                label = "".join(P if b else "I" for b in row)[::-1]
                assert np.isclose(sv.expectation_value(Pauli(label)), 1), (prep, P, row)
        assert np.isclose(sv.expectation_value(Pauli("Z" * 7)), z_l), prep
        assert np.isclose(sv.expectation_value(Pauli("X" * 7)), x_l), prep


def check_decoders(rounds=3):
    H, L = decoders.dem(rounds)
    llr = decoders.priors(rounds, 0.01, 0.01)
    rng = np.random.default_rng(0)
    bp_misses = 0
    for j in range(H.shape[1]):  # Relay-BP corrects every single fault, data or measurement
        s = H[:, j].copy()
        e, ok = decoders.relay_bp(H, llr, s, rng)
        assert ok and np.array_equal(H @ e % 2, s) and L @ e % 2 == L[j], j
        bp_misses += int(L @ decoders.bp(H, llr, s)[0] % 2 != L[j])
    # Plain BP gets lost on the Steane code's short cycles: the point of the demo.
    print(f"  plain BP miscorrects {bp_misses}/{H.shape[1]} single faults")


def check_run():
    sim = BasicSimulator()
    r = json.loads(bridge.run(sim, p=0.0, shots=16))
    assert all(not any(sum(s["grid"], [])) for s in r["shots"]), "p=0 must not fire any check"
    assert set(r["hist"]["relay"]) <= {"00", "11"} and r["logical_error"]["relay"] == 0, r["hist"]

    # bit flips are X errors: Z checks (columns 0-2, 6-8) fire; X checks only see readout flips
    r = json.loads(bridge.run(sim, channel="bit_flip", p=0.05, shots=16))
    fired = [c % 6 < 3 for s in r["shots"] for row in s["grid"] for c, b in enumerate(row) if b]
    assert sum(fired) > 3 * fired.count(False), fired
    r = json.loads(bridge.run(sim, channel="depolarizing", p=0.05, shots=16))
    assert any(c % 6 >= 3 for s in r["shots"] for row in s["grid"] for c, b in enumerate(row) if b)

    lo = json.loads(bridge.run(sim, channel="si1000", p=0.001, shots=32))["logical_error"]["relay"]
    hi = json.loads(bridge.run(sim, channel="si1000", p=0.02, shots=32))["logical_error"]["relay"]
    assert lo < hi, (lo, hi)

    assert "error" in json.loads(bridge.run("ionq_simulator"))
    assert "error" in json.loads(bridge.run(sim, p=0.9))

    # X readout uses the X checks (col0 = 3): Relay-BP must still beat no decoding
    r = json.loads(bridge.run(sim, channel="depolarizing", p=0.05, shots=32, basis="X"))["logical_error"]
    assert r["relay"] <= r["bp"] and r["relay"] < r["raw"], r
    try:
        bridge.run(sim, logical='[["h",5]]', shots=1)
        raise AssertionError("qubit 5 must be rejected")
    except ValueError:
        pass


def check_relay_beats_bp(shots=4000, rounds=3, p=0.06):
    """Pure decoder Monte Carlo on the depolarizing model (no circuit simulation, so it is fast)."""
    H, L = decoders.dem(rounds)
    chan = CHANNELS["depolarizing"](p)
    llr = decoders.priors(rounds, *chan["prior"])
    pr = np.array([chan["prior"][0]] * 7 * (rounds + 1) + [chan["prior"][1]] * 3 * rounds)
    rng = np.random.default_rng(1)
    fails = {"bp": 0, "relay": 0}
    for _ in range(shots):
        err = (rng.random(H.shape[1]) < pr).astype(np.uint8)
        s = H @ err % 2
        fails["bp"] += int(L @ decoders.bp(H, llr, s)[0] + L @ err) % 2
        fails["relay"] += int(L @ decoders.relay_bp(H, llr, s, rng)[0] + L @ err) % 2
    print("  decoder-only logical error at p=%.2f:" % p, {k: v / shots for k, v in fails.items()})
    assert fails["relay"] <= fails["bp"], fails


if __name__ == "__main__":
    for f in (check_encoder, check_decoders, check_run, check_relay_beats_bp):
        f()
        print("ok", f.__name__)

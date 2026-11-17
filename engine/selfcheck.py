"""python -m engine.selfcheck. Asserts the encoder, the decoders and the end-to-end run.
The IonQ-mode run needs qiskit-aer (requirements-dev.txt) and is skipped without it."""

import json
import random
from types import SimpleNamespace

import numpy as np
from qiskit import QuantumCircuit
from qiskit.providers.basic_provider import BasicSimulator
from qiskit.quantum_info import Pauli, Statevector

from . import bridge, decoders, steane
from .circuit import build
from .noise import CHANNELS


class FakeIonQ:
    """Stands in for Qollab's IonQ noise-model simulator: an 'ionq' name, 29 qubits, a noise_model
    option, mid-circuit measurement never used. Runs on Aer (MPS, so 26 qubits are cheap) with a
    rough trapped-ion-like noise model; p2=0 is noiseless. Also used by scripts/serve.py --ionq."""

    def __init__(self, noise_model="forte-1", p2=0.005, readout=0.003, num_qubits=29):
        from qiskit_aer import AerSimulator
        from qiskit_aer.noise import NoiseModel, ReadoutError, depolarizing_error
        nm = NoiseModel()
        if p2:
            nm.add_all_qubit_quantum_error(depolarizing_error(p2, 2), ["cx", "cz", "swap"])
            nm.add_all_qubit_quantum_error(depolarizing_error(p2 / 10, 1), ["h", "x", "y", "z", "s", "sdg", "t", "tdg", "sx", "rx", "ry", "rz"])
        if readout:
            nm.add_all_qubit_readout_error(ReadoutError([[1 - readout, readout], [readout, 1 - readout]]))
        self._sim = AerSimulator(method="matrix_product_state", noise_model=nm)
        self.name, self.num_qubits = "ionq_simulator", num_qubits
        self.options = SimpleNamespace(noise_model=noise_model)
        self.runs = []

    def __getattr__(self, attr):  # target, instruction_durations, ... for transpile
        return getattr(self._sim, attr)

    def run(self, circuit, **kw):
        assert not isinstance(circuit, (list, tuple)), "IonQ takes one circuit per job"
        self.runs.append(kw)
        return self._sim.run(circuit, **kw)


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

    assert "error" in json.loads(bridge.run(SimpleNamespace(name="ionq_qpu.aria-1", num_qubits=25)))
    assert "error" in json.loads(bridge.run(SimpleNamespace(name="ionq_simulator", num_qubits=29,
                                                            options=SimpleNamespace(noise_model="aria-1"))))
    assert "error" in json.loads(bridge.run("some_backend_without_reset"))
    assert "error" in json.loads(bridge.run(sim, p=0.9))

    # X readout uses the X checks (col0 = 3): Relay-BP must still beat no decoding
    r = json.loads(bridge.run(sim, channel="depolarizing", p=0.05, shots=32, basis="X"))["logical_error"]
    assert r["relay"] <= r["bp"] and r["relay"] < r["raw"], r
    try:
        bridge.run(sim, logical='[["h",5]]', shots=1)
        raise AssertionError("qubit 5 must be rejected")
    except ValueError:
        pass


def check_limit(p_data=0.05, p_meas=0.08):
    """The DP limit equals brute force over all 2^17 errors of a one-round block."""
    H, L = decoders.dem(1)
    n = H.shape[1]
    E = (np.arange(2 ** n)[:, None] >> np.arange(n)) & 1
    pr = np.array([p_data] * 14 + [p_meas] * 3)
    prob = np.prod(np.where(E, pr, 1 - pr), axis=1)
    syn = (E @ H.T % 2) @ (1 << np.arange(H.shape[0]))
    table = np.zeros((2, 2 ** H.shape[0]))
    np.add.at(table, (E @ L % 2, syn), prob)
    assert np.isclose(table.min(0).sum(), decoders.limit(1, p_data, p_meas))


def check_relay_beats_bp(shots=4000, rounds=3, p=0.06):
    """Pure decoder Monte Carlo on the depolarizing model (no circuit simulation, so it is fast).
    Relay-BP should sit at the optimal-decoder limit; plain BP well above it."""
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
    lim = decoders.limit(rounds, *chan["prior"])
    relay, sigma = fails["relay"] / shots, (lim * (1 - lim) / shots) ** 0.5
    print("  decoder-only logical error at p=%.2f:" % p, {k: v / shots for k, v in fails.items()}, "limit %.3f" % lim)
    assert lim - 3 * sigma <= relay <= 1.2 * lim and fails["relay"] < fails["bp"], (fails, lim)


def check_fresh_circuit():
    """IonQ mode: 26 qubits, no reset, and every measurement after the last gate."""
    qc, flips = build([["h", 0], ["cx", 0, 1]], {}, 1, "Z", random.Random(0), fresh=True)
    assert qc.num_qubits == 26 and qc.num_clbits == 26 and flips == [0, 0]
    names = [ins.operation.name for ins in qc.data]
    assert "reset" not in names and names.index("measure") == len(names) - names.count("measure"), names


def check_ionq_mode():
    try:
        import qiskit_aer  # noqa: F401
    except ImportError:
        print("  skipped: pip install qiskit-aer")
        return
    clean = FakeIonQ(p2=0, readout=0)
    r = json.loads(bridge.run(clean, shots=64))
    assert (r["mode"], r["rounds"], r["qubits"], r["logical_error"]["limit"]) == ("fresh", 1, 26, None), r.get("error")
    assert clean.runs == [{"shots": 64}], clean.runs  # one circuit, many shots, no simulator-only options
    assert all(not any(s["grid"][0]) for s in r["shots"]), "noiseless: no check may fire"
    assert set(r["hist"]["raw"]) == {"00", "11"} and r["logical_error"] == {"raw": 0, "bp": 0, "relay": 0, "limit": None}
    r = json.loads(bridge.run(clean, shots=32, basis="X", rounds=4, p=0.05))  # rounds and p are not injected here
    assert r["rounds"] == 1 and r["logical_error"]["relay"] == 0, r["logical_error"]

    r = json.loads(bridge.run(FakeIonQ(p2=0.01), shots=256))
    e = r["logical_error"]
    print("  IonQ mode, noisy stand-in:", {k: round(v, 3) for k, v in e.items() if v is not None})
    assert e["relay"] <= e["bp"] and e["relay"] < e["raw"], e
    # every outcome possible in the ideal: nothing can be counted
    r = json.loads(bridge.run(clean, logical='[["h",0],["h",1]]', shots=16))
    assert r["logical_error"]["raw"] is None, r["logical_error"]
    assert "error" in json.loads(bridge.run(FakeIonQ(noise_model="aria-1"), shots=16))


if __name__ == "__main__":
    for f in (check_encoder, check_limit, check_decoders, check_run, check_fresh_circuit, check_ionq_mode,
              check_relay_beats_bp):
        f()
        print("ok", f.__name__)

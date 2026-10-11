"""One noisy trajectory: two Steane blocks (qubits 0-6 and 7-13) and one ancilla (14),
reused with reset for all 12 checks of a round. Noise is sampled here and inserted as
explicit Paulis, and a Pauli frame is tracked alongside, so we know the true logical
error of every shot without trusting any decoder."""

import random

from qiskit import QuantumCircuit

from . import steane
from .noise import sample

BLOCKS = (0, 7)
ANC = 14
NQ = 15
CHECKS = len(BLOCKS) * 6  # per round: block A Z1-3, X1-3, then block B
LOGICAL_GATES = {"h", "x", "y", "z", "s", "sdg", "t", "tdg", "sx", "rx", "ry", "rz", "cx", "cz", "swap"}


class _Builder:
    def __init__(self, chan: dict, rng: random.Random):
        self.chan, self.rng = chan, rng
        self.x = [0] * NQ  # Pauli frame: X part / Z part per qubit
        self.z = [0] * NQ

    def pauli(self, q: int, P) -> None:
        if P:
            getattr(self.qc, P)(q)
            self.x[q] ^= P in "xy"
            self.z[q] ^= P in "yz"

    def noise(self, loc: str, *qs: int) -> None:
        spec = self.chan.get(loc)
        if not spec:
            return
        if loc in ("meas", "reset"):
            spec = ("X", spec)
        for q, P in zip(qs, sample(*spec, self.rng)):
            self.pauli(q, P)

    def h(self, q: int) -> None:
        self.qc.h(q)
        self.x[q], self.z[q] = self.z[q], self.x[q]
        self.noise("1q", q)

    def cx(self, c: int, t: int) -> None:
        self.qc.cx(c, t)
        self.x[t] ^= self.x[c]
        self.z[c] ^= self.z[t]
        self.noise("cx", c, t)

    def check(self, off: int, row, is_x: bool, clbit: int) -> None:
        if is_x:
            self.h(ANC)
        for q in (off + j for j in range(7) if row[j]):
            self.cx(ANC, q) if is_x else self.cx(q, ANC)
        if is_x:
            self.h(ANC)
        self.noise("meas", ANC)
        self.qc.measure(ANC, clbit)
        self.qc.reset(ANC)
        self.x[ANC] = self.z[ANC] = 0
        self.noise("reset", ANC)

    def data_noise(self) -> None:
        for q in range(14):
            self.noise("data", q)


def build(logical: list, chan: dict, rounds: int, basis: str, rng: random.Random):
    """Returns (circuit, true logical flip per block). Classical bits: round r check c at
    r*12+c, then the 14 data qubits."""
    b = _Builder(chan, rng)
    b.qc = qc = QuantumCircuit(NQ, rounds * CHECKS + 14)
    inputs = [off + steane.INPUT for off in BLOCKS]
    for name, *args in logical:
        if name not in LOGICAL_GATES:
            raise ValueError(f"gate not allowed: {name}")
        angles, qubits = ([float(args[0])], args[1:]) if name[0] == "r" else ([], args)
        if not all(int(i) in (0, 1) for i in qubits):
            raise ValueError(f"logical qubit must be 0 or 1: {[name, *args]}")
        getattr(qc, name)(*angles, *(inputs[int(i)] for i in qubits))
    for off in BLOCKS:
        steane.encode(qc, off)
    qc.barrier()
    for r in range(rounds):
        b.data_noise()
        for k, off in enumerate(BLOCKS):
            for c in range(6):
                b.check(off, steane.H[c % 3], c >= 3, r * CHECKS + k * 6 + c)
    b.data_noise()
    if basis == "X":
        for q in range(14):
            qc.h(q)
            b.x[q], b.z[q] = b.z[q], b.x[q]
    qc.measure(range(14), range(rounds * CHECKS, rounds * CHECKS + 14))
    # Z^7 is a logical Z, so an X frame of odd weight on a block flips its readout.
    flips = [sum(b.x[off:off + 7]) % 2 for off in BLOCKS]
    return qc, flips

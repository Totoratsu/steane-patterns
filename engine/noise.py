"""Noise channels. A channel maps a circuit location to a Pauli channel; the circuit
builder samples it per shot and inserts the Paulis. Adding a channel is one entry.

Locations: "data" (every data qubit, before each round and before readout),
"cx" (after each CX), "1q" (after each H), "meas" (X flip before a measurement),
"reset" (X flip after a reset). "prior" is (p_data, p_meas): the phenomenological
model the decoders assume, per Pauli type."""

import random

CHANNELS = {
    "bit_flip": lambda p: {"data": ("X", p), "meas": p, "prior": (p, p)},
    "depolarizing": lambda p: {"data": ("DEP1", p), "meas": p, "prior": (2 * p / 3, p)},
    # SI1000 (Gidney, Newman, McEwen 2021). Idles are booked once per round as if the
    # 12 checks ran in parallel; reusing one ancilla is only a simulator qubit-budget trick.
    # shortcut: prior is a rough phenomenological fit (hooks not modelled), use a circuit-level DEM for exact priors.
    "si1000": lambda p: {"data": ("DEP1", 2 * p + p / 10), "cx": ("DEP2", p), "1q": ("DEP1", p / 10),
                         "meas": 5 * p, "reset": 2 * p, "prior": (5 * p, 9 * p)},
}

_P1 = "xyz"
_P2 = [(a, b) for a in (None, *_P1) for b in (None, *_P1)][1:]  # 15 non-identity two-qubit Paulis


def sample(kind: str, p: float, rng: random.Random) -> tuple:
    """Paulis for one location: (P,) for one-qubit kinds, (P, Q) for DEP2; None means identity."""
    if kind == "DEP2":
        return rng.choice(_P2) if rng.random() < p else (None, None)
    if rng.random() >= p:
        return (None,)
    return ("x",) if kind == "X" else (rng.choice(_P1),)

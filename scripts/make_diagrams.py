"""Draw the circuit figures in src/img from the code itself, so they cannot drift.
Run: python scripts/make_diagrams.py   (needs matplotlib, not in requirements.txt)"""

import random
import sys
from pathlib import Path

from qiskit import QuantumCircuit

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))  # so `engine` imports when run as scripts/make_diagrams.py

from engine import steane  # noqa: E402
from engine.circuit import NQ, _Builder  # noqa: E402
from engine.noise import CHANNELS  # noqa: E402

OUT = ROOT / "src" / "img"
OUT.mkdir(parents=True, exist_ok=True)
STYLE = {"name": "bw", "reverse_bits": False}


def encoder():
    qc = QuantumCircuit(7)
    steane.encode(qc, 0)
    qc.draw("mpl", filename=str(OUT / "encoder.svg"), style=STYLE, idle_wires=False)


def check(kind, noisy=False):
    """One check, built by the same _Builder code the simulator runs."""
    chan = CHANNELS["si1000"](0.3) if noisy else {}
    b = _Builder(chan, random.Random(3))
    b.qc = QuantumCircuit(NQ, 6)
    b.check(0, steane.H[0], kind == "X", 0)
    return b.qc


if __name__ == "__main__":
    encoder()
    check("Z").draw("mpl", filename=str(OUT / "check-z.svg"), style=STYLE, idle_wires=False)
    check("X").draw("mpl", filename=str(OUT / "check-x.svg"), style=STYLE, idle_wires=False)
    check("Z", noisy=True).draw("mpl", filename=str(OUT / "check-z-noisy.svg"), style=STYLE, idle_wires=False)
    print("wrote", sorted(p.name for p in OUT.glob("*.svg")))

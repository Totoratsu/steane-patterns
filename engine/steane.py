"""The Steane [[7,1,3]] code. CSS: the same Hamming matrix gives the Z checks and the X checks."""

import numpy as np

# Column j is j+1 in binary, so a single error's syndrome names its qubit.
H = np.array([
    [0, 0, 0, 1, 1, 1, 1],
    [0, 1, 1, 0, 0, 1, 1],
    [1, 0, 1, 0, 1, 0, 1],
], dtype=np.uint8)

INPUT = 2  # the physical qubit that carries |psi> into the encoder


def encode(qc, off: int) -> None:
    """|psi>_INPUT |0...0> -> |psi_L> on qubits off..off+6.
    X_L representative {2,4,5} avoids the pivots {0,1,3}; each pivot then adds one X stabilizer row."""
    qc.cx(off + 2, off + 4)
    qc.cx(off + 2, off + 5)
    for pivot, row in ((3, (4, 5, 6)), (1, (2, 5, 6)), (0, (2, 4, 6))):
        qc.h(off + pivot)
        for t in row:
            qc.cx(off + pivot, off + t)

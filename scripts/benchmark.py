"""Decoder-only benchmark behind the table in docs chapter 9. Fixed seed, so the numbers repeat.

    python scripts/benchmark.py [shots]      # default 3000 shots per p, 3 rounds, depolarizing
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from engine import decoders
from engine.noise import CHANNELS

shots = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
rounds = 3
print(f"depolarizing, {rounds} rounds, {shots} shots per p, seed 1")
print("p      BP      Relay-BP   limit")
for p in (0.02, 0.03, 0.06):
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
    print(f"{p:<6} {fails['bp'] / shots:6.1%}  {fails['relay'] / shots:6.1%}     {lim:6.1%}")

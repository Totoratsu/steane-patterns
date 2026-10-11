"""BP (min-sum) and Relay-BP (Müller et al. 2025, arXiv:2506.01779) in plain numpy,
on the phenomenological space-time model of one Steane block and one Pauli type.
relay-bp itself is a Rust package and does not run in the browser."""

import numpy as np

from . import steane


def dem(rounds: int):
    """Check matrix and logical row. Detector t = syndrome t XOR syndrome t-1, where the
    last 'round' is the syndrome read off the data. Columns: data errors before rounds
    0..R (7 each), then measurement errors of rounds 0..R-1 (3 each)."""
    R = rounds
    n_data = 7 * (R + 1)
    H = np.zeros((3 * (R + 1), n_data + 3 * R), dtype=np.uint8)
    for t in range(R + 1):
        H[3 * t:3 * t + 3, 7 * t:7 * t + 7] = steane.H
    for r in range(R):
        for c in range(3):
            j = n_data + 3 * r + c
            H[3 * r + c, j] = H[3 * (r + 1) + c, j] = 1
    L = np.zeros(H.shape[1], dtype=np.uint8)
    L[:n_data] = 1  # any one-qubit error flips the 7-qubit parity
    return H, L


def priors(rounds: int, p_data: float, p_meas: float) -> np.ndarray:
    p = np.array([p_data] * 7 * (rounds + 1) + [p_meas] * 3 * rounds)
    p = np.clip(p, 1e-6, 0.49)
    return np.log((1 - p) / p)


def _minsum(H, llr0, s, iters, gamma, M):
    """Memory min-sum BP (DMem-BP). gamma=0 is plain min-sum.
    Returns (hard decision, converged, final posterior)."""
    Hb = H.astype(bool)
    ssign = 1.0 - 2.0 * s
    m = np.zeros(H.shape)
    e = (M < 0).astype(np.uint8)
    for _ in range(iters):
        lam = (1 - gamma) * llr0 + gamma * M
        v2c = np.where(Hb, lam + m.sum(0) - m, 0.0)
        a = np.where(Hb, np.abs(v2c), np.inf)
        sg = np.where(v2c < 0, -1.0, 1.0)
        idx = a.argmin(1)
        srt = np.sort(a, 1)
        min1, min2 = srt[:, 0:1], np.minimum(srt[:, 1:2], 1e3)
        excl = np.where(np.arange(H.shape[1]) == idx[:, None], min2, min1)
        m = np.where(Hb, ssign[:, None] * sg.prod(1, keepdims=True) * sg * excl, 0.0)
        M = lam + m.sum(0)
        e = (M < 0).astype(np.uint8)
        if np.array_equal(H @ e % 2, s):
            return e, True, M
    return e, False, M


def bp(H, llr0, s, iters=60, **_):
    if not s.any():
        return np.zeros(H.shape[1], np.uint8), True
    e, ok, _ = _minsum(H, llr0, s, iters, 0.0, llr0)
    return e, ok


def relay_bp(H, llr0, s, rng, gamma0=0.125, gmin=-0.24, gmax=0.66, t0=60, t=50, legs=80, solutions=8):
    """First leg: memory BP with uniform gamma0. Each next leg draws a random gamma per
    variable and starts from the previous leg's posterior. Keep the lightest of the
    first `solutions` converged answers."""
    if not s.any():
        return np.zeros(H.shape[1], np.uint8), True
    e, ok, M = _minsum(H, llr0, s, t0, gamma0, llr0)
    found = [e] if ok else []
    for _ in range(legs):
        if len(found) >= solutions:
            break
        e, ok, M = _minsum(H, llr0, s, t, rng.uniform(gmin, gmax, H.shape[1]), M)
        if ok:
            found.append(e)
    if not found:
        return e, False
    return min(found, key=lambda f: float(f @ llr0)), True

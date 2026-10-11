# Steane Patterns

**Watch quantum error correction work, and hear it.** Two logical qubits, each protected by a Steane [[7,1,3]] code, go through repeated rounds of error correction. Every parity-check readout is a cell in a grid, like a cellular automaton: one row per round, one column per check. Under the grid each logical qubit is drawn as the Steane **triangle**: 7 vertices are the data qubits, the 3 faces are the parity checks. Noise lights the checks up. Every lit check plays a note. Two decoders, plain belief propagation (BP) and **Relay-BP**, read the pattern, and you can see and hear when each one gets it right.

Theme: **Quantum Unlocked** (an interactive explanation of QEC rounds, syndromes and decoding).
Built for the Qollab × IonQ Global Quantum Hackathon, Oct 9–11 2026.

## Use it

1. Press **Run** on Qollab with the **built-in Qiskit simulator** (see *Limitations* about IonQ).
2. Pick a logical circuit (Bell pair by default), a noise channel, the noise strength `p`, the number of rounds, and the readout basis. Press **Run** in the page.
3. The page has a **How to read this** guide at the top. The grid plays one shot at a time, row by row, and the triangles below mirror the current round (orange fill = that face's Z check fired, blue outline = its X check fired). At the end the data qubits are read (filled vertex = 1) and each triangle says its logical value and ✓/✗.
   - **Raw bits**: what the ancilla measured. Orange = Z checks (they catch X errors), blue = X checks (they catch Z errors).
   - **Detections**: a check that *changed* since the last round. A data error lights one detection and stays lit in Raw view; a measurement error lights two detections in consecutive rounds.
   - **Heat map**: detection rate per check over all shots, plus how often the decoder blames each data qubit.
   - Pink rings show where the selected decoder places the errors: on triangle vertices for data errors, on grid cells for faulty readouts.
4. Sound: each lit cell is a note (block A low, block B an octave up; Z checks triangle, X checks sine). The readout plays a major chord when the decoder recovered both logical qubits and a dissonant cluster when it didn't.
5. The right panel shows the logical error rate with no decoding, with BP, with Relay-BP and the **optimal-decoder limit** (black tick on each bar), with 95% intervals and how often each decoder failed to converge, and the logical outcome histogram against the ideal one (a Bell pair should give only 00 and 11).

Turn `p` up and listen to the music get denser, then watch BP fail before Relay-BP does. Use 192–256 shots to see the gap through the statistical noise.

## How it works

### Qubit budget: 15 qubits
Two Steane blocks need 14 data qubits. One round of their 12 checks with fresh ancillas would need 26 qubits, more than the 24-qubit simulator has. So **one ancilla is measured and reset after every check** (mid-circuit measurement + reset, which Qiskit's BasicSimulator supports). That gives 15 qubits for any number of rounds.

### Circuit (`engine/circuit.py`)
1. Your logical gates (any of `h x y z s sdg t tdg sx rx ry rz cx cz swap`) act on the two input qubits, then each one is encoded into a Steane block (`engine/steane.py`). Preparation is not fault-tolerant: noise starts after encoding.
2. `R` rounds: each round measures 3 Z checks and 3 X checks per block with the shared ancilla.
3. All 14 data qubits are measured in Z or X; the parity of each block is its logical value.

### Noise (`engine/noise.py`)
Noise is sampled per shot and inserted as explicit Pauli gates, so it works on a noiseless simulator, and every shot is a separate circuit sent in **one job**.

| Channel | What it does |
|---|---|
| `bit_flip` | X with probability p on every data qubit before each round; readout flips with p |
| `depolarizing` | X, Y or Z with probability p on every data qubit before each round; readout flips with p |
| `si1000` | Circuit-level superconducting-inspired model (Gidney, Newman, McEwen 2021): 2-qubit depolarizing p after each CX, p/10 after single-qubit gates, 5p readout, 2p reset, 2p idle during measurement. Errors spread through the CX gates (hook errors). |

Idle noise in SI1000 is charged once per round, **as if the 12 checks ran in parallel** on 12 ancillas. Reusing a single ancilla is only a way to stay within the simulator's qubit limit.

Adding a channel takes one line in `CHANNELS`.

### Exact ground truth
While building each circuit we track the **Pauli frame** of the injected noise through every gate. So we know the true logical error of every shot without trusting any decoder, and every decoder is judged exactly.

### Decoders (`engine/decoders.py`)
Each block and Pauli type is decoded on a **space-time** check matrix. A detector is a syndrome XOR the previous round's syndrome, and the last round is the syndrome computed from the final data readout. The columns are data errors between rounds and measurement errors.

- **BP**: min-sum belief propagation. On the Steane code it often gets lost: the Tanner graph has many short cycles, and in our self-check BP miscorrects 4 of the 37 *single* faults.
- **Relay-BP** (Müller et al., IBM, 2025, [arXiv:2506.01779](https://arxiv.org/abs/2506.01779)): a chain of memory-BP runs ("legs"). Each leg uses random memory strengths γ ∈ [−0.24, 0.66] and starts from the previous leg's posteriors. The decoder keeps the lightest of up to 8 converged solutions. It corrects all single faults.

Both are written in plain numpy, because the official `relay-bp` package is Rust and can't be installed in the browser.

### The limit: how good can a decoder be?
`decoders.limit()` computes the logical error rate of the **optimal (maximum-likelihood) decoder**, exactly: it runs a dynamic program over the error columns to get P(syndrome, logical class), and the optimum picks the likelier class for every syndrome. It takes milliseconds, so the page shows it on every run.

Benchmark per block, decoder only, 3 rounds (33,000 samples at p = 0.03; 3,000 otherwise):

| channel, p | BP | Relay-BP | limit |
|---|---|---|---|
| depolarizing 0.02 | 6.7% | 2.9% | 2.6% |
| depolarizing 0.03 | | 5.6% | 5.4% |
| depolarizing 0.06 | 24.4% | 16.7% | 16.3% |
| bit flip 0.03 | | 11.1% | 10.3% |

Relay-BP sits within a few percent of the optimum, and more legs don't close that gap. Relay-BP returns the single most likely error. The optimum also adds up all *equivalent* errors (degeneracy), which a single-error decoder can't do. So on this small code the gap between BP and Relay-BP can't grow much more: Relay-BP is already near the ceiling. Relay-BP pulls further ahead on large qLDPC codes, where BP's trapping sets hurt more.

Full circuit runs agree: 2,816 shots at depolarizing p = 0.03 give BP 20.8%, Relay-BP 11.7%, limit 10.5% per shot.

For SI1000 the decoders keep the same phenomenological model with rough priors, and **no limit is shown**: a limit computed from those priors would describe a different, noisier model, not this circuit (an exact one needs a circuit-level error model). The hook errors aren't in the decoders' model either. A real decoder with an imperfect noise model faces the same situation.

## Limitations

- **IonQ backends are not supported.** They allow neither mid-circuit measurement nor reset, and without them two Steane blocks can't do even one round within the qubit limit. The page shows a message if you pick one.
- Simulation is a full statevector, shot by shot (BasicSimulator runs shot by shot when there are mid-circuit measurements). The defaults (3 rounds, 48 shots) take a few seconds natively and more in the browser.
- Logical gates are applied before encoding only. Gates between rounds would need the decoder model to track errors moving between blocks.

## Run it locally

```bash
pip install -r requirements.txt
python scripts/serve.py          # http://localhost:8000, optional port as argument
```
`scripts/serve.py` serves the same page and swaps `main.js` for a shim that sends Run to a local `/run` endpoint, where native Python runs `engine.bridge.run` on Qiskit's BasicSimulator. It is the same engine and simulator as on Qollab, only faster. Opening `index.html` directly does not work, because `engine.bridge` only exists inside Qollab.

```bash
python -m engine.selfcheck
```
It checks the encoder (stabilizers and logical operators), that Relay-BP corrects every single fault, that p = 0 lights nothing and yields only 00/11 for a Bell pair, that bit flips light mostly Z checks, that the SI1000 logical error grows with p, that the limit matches brute force over all 2^17 errors of one round, and that Relay-BP beats BP and sits near the limit.

## Files

```
index.html, main.js     Qollab entry points (must stay at the root; main.js imports engine.bridge and passes `backend`)
requirements.txt        qiskit, numpy
engine/                 Python: steane, noise, circuit, decoders, bridge, selfcheck
src/                    ui.js (grid, triangles, animation, stats), audio.js (Web Audio), main.css
scripts/serve.py        local mode, no Qollab needed
```

## Credits

- The visual idea comes from [Quantum Patterns](https://qollab.xyz/u/cephasteom/quantum-patterns) by cephasteom (qubits as cellular-automaton cells, with sound).
- The Qollab project layout (`main.js` importing a Python `engine.bridge`) follows [Canary](https://github.com/tomcode1000/Canary).
- Relay-BP: T. Müller et al., *Improved belief propagation is sufficient for real-time decoding of quantum memory*, 2025.
- SI1000: C. Gidney, M. Newman, M. McEwen, *Benchmarking the planar honeycomb code*, Quantum 6, 813 (2022).

MIT licensed.

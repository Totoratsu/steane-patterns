// Web Audio: every fired check is a note. Column -> pentatonic degree (Z checks
// low triangle, X checks sine), block B an octave above block A.
const PENTA = [0, 2, 4, 7, 9, 12];
const hz = (semis, base) => base * 2 ** (semis / 12);

export class Synth {
  constructor() { this.ctx = null; this.on = true; }

  wake() {
    this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  tone(freq, type, vol, dur = 0.4) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // cols: fired check columns 0..11 (block A 0-5, block B 6-11; 0-2 Z, 3-5 X within a block)
  row(cols) {
    const vol = 0.18 / Math.max(1, Math.sqrt(cols.length));
    for (const c of cols) {
      const k = c % 6, base = c < 6 ? 220 : 440;
      this.tone(hz(PENTA[k], base), k < 3 ? 'triangle' : 'sine', vol);
    }
  }

  // Readout: a major chord if the decoder got both logical qubits right, a cluster if not.
  chord(ok) {
    const notes = ok ? [0, 4, 7, 12] : [0, 1, 6, 11];
    for (const s of notes) this.tone(hz(s, 262), ok ? 'sine' : 'sawtooth', ok ? 0.08 : 0.04, 0.9);
  }
}

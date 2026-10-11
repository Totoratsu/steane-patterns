// The page: controls, the space-time grid (an automaton that plays one shot at a time),
// the decoder overlay and the stats. All quantum work happens in api.run().
import { Synth } from './audio.js';

const PRESETS = {
  'Bell pair (H, CX)': [['h', 0], ['cx', 0, 1]],
  '|0⟩|0⟩': [],
  '|+⟩|0⟩': [['h', 0]],
  'T|+⟩ and X': [['h', 0], ['t', 0], ['x', 1]],
  'Ry(π/3) then CZ': [['ry', 1.0472, 0], ['h', 1], ['cz', 0, 1]],
};
const CHECK_LABELS = ['Z1', 'Z2', 'Z3', 'X1', 'X2', 'X3'];

const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function start(api) {
  const synth = new Synth();
  const st = { data: null, shot: 0, row: 0, playing: true, view: 'raw', timer: null };

  for (const name of Object.keys(PRESETS)) $('preset').add(new Option(name, name));
  const setPreset = () => { $('logical').value = JSON.stringify(PRESETS[$('preset').value]); };
  $('preset').onchange = setPreset;
  setPreset();
  const showP = () => { $('pOut').textContent = (+$('p').value).toFixed(3); };
  $('p').oninput = showP;
  showP();

  $('run').onclick = async () => {
    synth.wake();
    let logical;
    try { logical = JSON.parse($('logical').value); } catch { return status('Gates must be valid JSON, e.g. [["h",0],["cx",0,1]]', true); }
    $('run').disabled = true;
    status('Simulating 15 qubits shot by shot…');
    clearTimeout(st.timer);
    const t = performance.now();
    try {
      const res = await api.run({
        logical: JSON.stringify(logical), channel: $('channel').value, p: +$('p').value,
        rounds: +$('rounds').value, shots: +$('shots').value, basis: $('basis').value,
        seed: Math.floor(Math.random() * 1e9),
      });
      if (res.error) return status(res.error, true);
      st.data = res; st.shot = 0; st.row = 0;
      status(`${res.shots.length} shots, ${res.rounds} rounds, 15 qubits, ${((performance.now() - t) / 1000).toFixed(1)} s`);
      stats();
      tick();
    } catch (e) {
      status(String(e.message || e), true);
    } finally {
      $('run').disabled = false;
    }
  };

  function status(msg, err = false) {
    $('status').textContent = msg;
    $('status').classList.toggle('err', err);
  }

  for (const b of document.querySelectorAll('[data-view]')) {
    b.onclick = () => {
      st.view = b.dataset.view;
      for (const o of document.querySelectorAll('[data-view]')) o.setAttribute('aria-pressed', o === b);
      draw();
    };
  }
  $('decoder').onchange = () => { draw(); stats(); };
  $('sound').onchange = () => { synth.on = $('sound').checked; };
  $('play').onclick = () => {
    st.playing = !st.playing;
    $('play').textContent = st.playing ? 'Pause' : 'Play';
    if (st.playing) { synth.wake(); tick(); } else clearTimeout(st.timer);
  };
  const jump = (d) => {
    if (!st.data) return;
    const n = st.data.shots.length;
    st.shot = (st.shot + d + n) % n;
    st.row = st.data.rounds + 1;
    draw();
    clearTimeout(st.timer);
    if (st.playing) st.timer = setTimeout(tick, +$('tempo').value * 3.5);
  };
  $('prev').onclick = () => jump(-1);
  $('next').onclick = () => jump(1);
  window.addEventListener('resize', () => draw());
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => draw());

  // The value a cell shows: the raw bit, or a detection (did it change since the last round?).
  const cell = (shot, r, c) => shot.grid[r][c] ^ (st.view === 'det' && r > 0 ? shot.grid[r - 1][c] : 0);

  function tick() {
    clearTimeout(st.timer);
    const d = st.data;
    if (!d || !st.playing) return;
    if (st.row > d.rounds) { st.row = 0; st.shot = (st.shot + 1) % d.shots.length; }
    const shot = d.shots[st.shot];
    if (st.row < d.rounds) {
      const r = st.row;
      synth.row(shot.grid[r].map((_, c) => c).filter((c) => cell(shot, r, c)));
    } else {
      synth.chord(verdict(shot).ok);
    }
    st.row++;
    draw();
    const wait = st.row > d.rounds ? 3.5 : 1;
    st.timer = setTimeout(tick, +$('tempo').value * wait);
  }

  function verdict(shot) {
    const key = $('decoder').value;
    if (key === 'none') return { ok: !shot.true_flip.some(Boolean), logical: shot.raw };
    return { ok: shot[key].ok.every(Boolean), logical: shot[key].logical };
  }

  function draw() {
    const cv = $('grid'), d = st.data;
    const rows = d ? d.rounds : 3;
    const W = cv.clientWidth || 600, padL = 46, padT = 22;
    const u = Math.min(40, (W - padL) / 15.5);
    const H = padT + (rows + 1) * u + u * 0.6 + 26;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const col = { off: css('--off'), z: css('--z'), x: css('--x'), d: css('--d'), mark: css('--mark'), muted: css('--muted'), ok: css('--ok'), bad: css('--bad') };
    g.font = `${Math.max(9, u * 0.28)}px JetBrains Mono, monospace`;
    g.textBaseline = 'middle';

    // block A checks sit over data 0-6, block B over data 8-14 (one blank column between blocks)
    const cx = (c) => padL + (c < 6 ? 0.5 + c : 8.5 + c - 6) * u;
    const dx = (q) => padL + (q < 7 ? q : q + 1) * u;
    const ry = (r) => padT + r * u;
    const yData = padT + rows * u + u * 0.6;

    g.fillStyle = col.muted; g.textAlign = 'center';
    for (let c = 0; c < 12; c++) g.fillText(CHECK_LABELS[c % 6], cx(c) + u / 2, padT - 10);
    g.textAlign = 'right';
    for (let r = 0; r < rows; r++) g.fillText(`r${r + 1}`, padL - 8, ry(r) + u / 2);
    g.fillText('data', padL - 8, yData + u / 2);
    g.textAlign = 'center';
    g.fillText('logical A', dx(3) + u / 2, yData + u + 14);
    g.fillText('logical B', dx(10) + u / 2, yData + u + 14);

    const box = (x, y, fill, alpha = 1) => {
      g.globalAlpha = 1; g.fillStyle = col.off; g.beginPath(); g.roundRect(x + 2, y + 2, u - 4, u - 4, 4); g.fill();
      if (fill) { g.globalAlpha = alpha; g.fillStyle = fill; g.beginPath(); g.roundRect(x + 2, y + 2, u - 4, u - 4, 4); g.fill(); }
      g.globalAlpha = 1;
    };
    const ring = (x, y) => { g.strokeStyle = col.mark; g.lineWidth = 2.5; g.beginPath(); g.roundRect(x + 1, y + 1, u - 2, u - 2, 6); g.stroke(); };
    const tint = (c) => (c % 6 < 3 ? col.z : col.x);

    if (!d) {
      for (let r = 0; r < rows; r++) for (let c = 0; c < 12; c++) box(cx(c), ry(r));
      for (let q = 0; q < 14; q++) box(dx(q), yData);
      $('shotInfo').textContent = 'press Run';
      return;
    }

    if (st.view === 'heat') {
      const n = d.shots.length;
      for (let r = 0; r < rows; r++) for (let c = 0; c < 12; c++) {
        const f = d.shots.reduce((a, s) => a + (s.grid[r][c] ^ (r ? s.grid[r - 1][c] : 0)), 0) / n;
        box(cx(c), ry(r), tint(c), Math.min(1, f * 2.5));
      }
      const key = $('decoder').value;
      for (let q = 0; q < 14; q++) {
        const f = key === 'none' ? 0 : d.shots.reduce((a, s) => a + s[key].data_marks.filter((m) => m === q).length, 0) / n;
        box(dx(q), yData, col.mark, Math.min(1, f * 2.5));
      }
      $('shotInfo').textContent = `heat map: detection rate per check over ${n} shots; data row: how often the decoder blames each qubit`;
      return;
    }

    const shot = d.shots[st.shot];
    const key = $('decoder').value;
    const shown = Math.min(st.row, rows + 1);
    for (let r = 0; r < rows; r++) for (let c = 0; c < 12; c++) box(cx(c), ry(r), r < shown && cell(shot, r, c) ? tint(c) : null);
    for (let q = 0; q < 14; q++) box(dx(q), yData, shown > rows && shot.data[q] ? col.d : null);
    if (key !== 'none' && shown > rows) {
      for (const [r, c] of shot[key].meas_marks) ring(cx(c), ry(r));
      for (const q of shot[key].data_marks) ring(dx(q), yData);
    }
    let info = `shot ${st.shot + 1}/${d.shots.length}`;
    if (shown > rows) {
      const v = verdict(shot);
      info += `  logical = ${v.logical.join('')}  ${v.ok ? '✓ corrected' : '✗ logical error'}`;
      g.fillStyle = v.ok ? col.ok : col.bad; g.textAlign = 'left';
      g.fillText(v.ok ? '✓' : '✗', dx(13) + u + 8, yData + u / 2);
    }
    $('shotInfo').textContent = info;
  }

  function stats() {
    const d = st.data;
    if (!d) return;
    const e = d.logical_error;
    const bars = [['raw', 'No decoding', e.raw], ['bp', 'BP (min-sum)', e.bp], ['relay', 'Relay-BP', e.relay]];
    $('bars').innerHTML = bars.map(([k, label, v]) =>
      `<div class="bar ${k}">${label} <b>${(v * 100).toFixed(1)}%</b><div class="track"><div class="fill" style="width:${v * 100}%"></div></div></div>`).join('');
    const n = d.shots.length;
    const outs = [...new Set([...Object.keys(d.ideal), ...Object.keys(d.hist.raw), ...Object.keys(d.hist.bp), ...Object.keys(d.hist.relay)])].sort();
    const pct = (h, o) => `${(((h[o] || 0) / n) * 100).toFixed(0)}%`;
    $('hist').innerHTML = `<tr><th>${d.basis}${d.basis}</th><th>ideal</th><th>raw</th><th>BP</th><th>Relay</th></tr>` +
      outs.map((o) => `<tr><td>${o}</td><td>${((d.ideal[o] || 0) * 100).toFixed(0)}%</td><td>${pct(d.hist.raw, o)}</td><td>${pct(d.hist.bp, o)}</td><td>${pct(d.hist.relay, o)}</td></tr>`).join('');
  }

  draw();
}

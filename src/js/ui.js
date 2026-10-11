// The page: controls, the space-time grid (an automaton that plays one shot at a time),
// the two Steane triangles with the decoder overlay, and the stats. All quantum work happens in api.run().
import { Synth } from './audio.js';

const PRESETS = {
  'Bell pair (H, CX)': [['h', 0], ['cx', 0, 1]],
  '|0⟩|0⟩': [],
  '|+⟩|0⟩': [['h', 0]],
  'T|+⟩ and X': [['h', 0], ['t', 0], ['x', 1]],
  'Ry(π/3) then CZ': [['ry', 1.0472, 0], ['h', 1], ['cz', 0, 1]],
};
const CHECK_LABELS = ['Z1', 'Z2', 'Z3', 'X1', 'X2', 'X3'];
// Mirrors engine/steane.py: vertices are the 7 data qubits, rows (faces) are the 3 parity checks,
// each measured twice per round, once as a Z check and once as an X check.
const STEANE_H = [[0, 0, 0, 1, 1, 1, 1], [0, 1, 1, 0, 0, 1, 1], [1, 0, 1, 0, 1, 0, 1]];

const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
// Canvas colours come from the design tokens in css/tokens.css, so both themes work.
const TOKEN = { off: '--cell-off', z: '--check-z', x: '--check-x', d: '--ink', mark: '--blame', muted: '--ink-muted', ok: '--ok', bad: '--bad', panel: '--surface', ink: '--ink' };
const PLAY = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9-5.5z"/></svg><span>Play</span>';
const PAUSE = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 1.5h3v11h-3zM8.5 1.5h3v11h-3z"/></svg><span>Pause</span>';
// Query parameters the documentation uses to open the simulator in a prepared state.
const CIRCUITS = { bell: 'Bell pair (H, CX)', zero: '|0⟩|0⟩', plus: '|+⟩|0⟩', t: 'T|+⟩ and X', ry: 'Ry(π/3) then CZ' };
const mean = (pts) => [0, 1].map((i) => pts.reduce((a, p) => a + p[i], 0) / pts.length);
const pct = (v) => `${(v * 100).toFixed(1)}%`;

// Triangle layout from H: a qubit in one face is that face's corner, in two faces the midpoint
// of their shared edge, in all three the centre. Each face is its 4 qubits in angular order.
function triangle(x, top, w) {
  const C = [[x, top], [x - w / 2, top + w * 0.866], [x + w / 2, top + w * 0.866]];
  const qs = [...Array(7)].map((_, q) => mean([0, 1, 2].filter((f) => STEANE_H[f][q]).map((f) => C[f])));
  const faces = STEANE_H.map((row) => {
    const pts = qs.filter((_, q) => row[q]);
    const m = mean(pts);
    const ang = (p) => Math.atan2(p[1] - m[1], p[0] - m[0]);
    return pts.sort((a, b) => ang(a) - ang(b));
  });
  return { qs, faces };
}

export function start(api) {
  const synth = new Synth();

  // Sound map: same scale as audio.js (pentatonic semitones; block A on 220 Hz, B an octave up).
  const SEMI = [0, 2, 4, 7, 9, 12], NAMES = ['Z1', 'Z2', 'Z3', 'X1', 'X2', 'X3'];
  $('soundmap').innerHTML = [['A', 220, ''], ['B', 440, ', one octave up']].map(([b, base, extra]) =>
    `<p class="sm-title">Logical qubit ${b} · base ${base} Hz${extra}</p><div class="sm-row">` +
    NAMES.map((n, k) => `<div class="sm-cell ${k < 3 ? 'z' : 'x'}"><b>${n}</b>${(base * 2 ** (SEMI[k] / 12)).toFixed(1)} Hz<br>+${SEMI[k]} semitones<br>${k < 3 ? 'triangle' : 'sine'}</div>`).join('') + '</div>').join('');
  const st = { data: null, shot: 0, row: 0, playing: true, view: 'raw', timer: null };

  for (const name of Object.keys(PRESETS)) $('preset').add(new Option(name, name));
  const setPreset = () => { $('logical').value = JSON.stringify(PRESETS[$('preset').value]); };
  $('preset').onchange = setPreset;
  setPreset();
  const showP = () => { $('pOut').textContent = (+$('p').value).toFixed(3); };
  $('p').oninput = showP;
  showP();
  $('play').innerHTML = PAUSE;
  document.fonts?.ready.then(() => draw());

  // "How to read this" is open on the first visit and closed afterwards.
  try {
    if (localStorage.getItem('sp-guide-seen')) $('guideBox').open = false;
    else localStorage.setItem('sp-guide-seen', '1');
  } catch { /* storage can be blocked; keep the default */ }

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
    $('play').innerHTML = st.playing ? PAUSE : PLAY;
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

  // Did the chosen decoder get the logical value right, for block k or (no k) the whole shot?
  function verdict(shot, k) {
    const key = $('decoder').value;
    const ks = k === undefined ? [0, 1] : [k];
    if (key === 'none') return { ok: ks.every((i) => !shot.true_flip[i]), logical: ks.map((i) => shot.raw[i]) };
    return { ok: ks.every((i) => shot[key].ok[i]), logical: ks.map((i) => shot[key].logical[i]) };
  }

  function draw() {
    const cv = $('grid'), d = st.data;
    const rows = d ? d.rounds : 3;
    const W = cv.clientWidth || 600, padL = 46, padT = 22;
    const u = Math.min(40, (W - padL) / 15.5);
    const triW = 5.4 * u, rad = Math.max(5, u * 0.3);
    const yTri = padT + rows * u + 26 + rad;
    const H = yTri + triW * 0.866 + rad + 30;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const col = Object.fromEntries(Object.entries(TOKEN).map(([k, v]) => [k, css(v)]));
    const mono = css('--font-mono');
    const font = (s) => { g.font = `500 ${Math.max(9, s)}px ${mono}`; };
    font(u * 0.28);
    g.textBaseline = 'middle';

    // block A checks sit over its triangle on the left, block B over its triangle on the right
    const cx = (c) => padL + (c < 6 ? 0.5 + c : 8.5 + c - 6) * u;
    const ry = (r) => padT + r * u;
    const tris = [triangle(padL + 3.5 * u, yTri, triW), triangle(padL + 11.5 * u, yTri, triW)];

    g.fillStyle = col.muted; g.textAlign = 'center';
    for (let c = 0; c < 12; c++) {
      g.fillText(CHECK_LABELS[c % 6], cx(c) + u / 2, padT - 12);
      g.fillStyle = c % 6 < 3 ? col.z : col.x; g.fillRect(cx(c) + 4, padT - 3, u - 8, 2);
      g.fillStyle = col.muted;
    }
    g.textAlign = 'right';
    for (let r = 0; r < rows; r++) g.fillText(`r${r + 1}`, padL - 8, ry(r) + u / 2);
    g.textAlign = 'left';
    g.fillText('ancilla q14 readouts above · data qubits below', padL, padT + rows * u + 12);

    const box = (x, y, fill, alpha = 1) => {
      g.globalAlpha = 1; g.fillStyle = col.off; g.beginPath(); g.roundRect(x + 2, y + 2, u - 4, u - 4, 4); g.fill();
      if (fill) { g.globalAlpha = alpha; g.fillStyle = fill; g.beginPath(); g.roundRect(x + 2, y + 2, u - 4, u - 4, 4); g.fill(); }
      g.globalAlpha = 1;
    };
    const ring = (x, y) => { g.strokeStyle = col.mark; g.lineWidth = 2.5; g.beginPath(); g.roundRect(x + 1, y + 1, u - 2, u - 2, 6); g.stroke(); };
    const tint = (c) => (c % 6 < 3 ? col.z : col.x);
    const poly = (pts, s = 1) => {
      const m = mean(pts);
      g.beginPath();
      pts.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](m[0] + (x - m[0]) * s, m[1] + (y - m[1]) * s));
      g.closePath();
    };
    // One block: face fill = Z check, inner outline = X check; vertices = data qubits.
    const block = (k, zA, xA, vFill, vA, rings, caption, capColor = col.muted) => {
      const { qs, faces } = tris[k];
      faces.forEach((f, i) => {
        poly(f); g.fillStyle = col.off; g.fill();
        if (zA[i]) { g.globalAlpha = zA[i]; g.fillStyle = col.z; g.fill(); g.globalAlpha = 1; }
        g.strokeStyle = col.panel; g.lineWidth = 3; g.stroke();
        if (xA[i]) { poly(f, 0.68); g.globalAlpha = xA[i]; g.strokeStyle = col.x; g.lineWidth = 3.5; g.stroke(); g.globalAlpha = 1; }
        // face number in a small chip, so it stays legible on any fill
        const [fx, fy] = mean(f);
        g.beginPath(); g.arc(fx, fy, u * 0.24, 0, 7); g.fillStyle = col.panel; g.fill();
        font(u * 0.26); g.fillStyle = col.muted; g.textAlign = 'center';
        g.fillText(`${i + 1}`, fx, fy + 0.5);
      });
      qs.forEach(([x, y], q) => {
        g.beginPath(); g.arc(x, y, rad, 0, 7); g.fillStyle = col.panel; g.fill();
        if (vA[q]) { g.globalAlpha = vA[q]; g.fillStyle = vFill; g.fill(); g.globalAlpha = 1; }
        g.strokeStyle = col.ink; g.lineWidth = 1.5; g.stroke();
        if (rad >= 9) { font(rad * 0.85); g.fillStyle = vA[q] > 0.5 ? col.panel : col.ink; g.fillText(k * 7 + q, x, y + 0.5); }
        if (rings.includes(k * 7 + q)) { g.beginPath(); g.arc(x, y, rad + 4, 0, 7); g.strokeStyle = col.mark; g.lineWidth = 2.5; g.stroke(); }
      });
      font(u * 0.28); g.fillStyle = capColor; g.textAlign = 'center';
      g.fillText(caption, qs[6][0], yTri + triW * 0.866 + rad + 16);
    };
    const name = (k) => `logical ${'AB'[k]}`;
    const zero3 = [0, 0, 0];

    if (!d) {
      for (let r = 0; r < rows; r++) for (let c = 0; c < 12; c++) box(cx(c), ry(r));
      for (const k of [0, 1]) block(k, zero3, zero3, col.d, [], [], `${name(k)}: q${k * 7}–q${k * 7 + 6}`);
      $('shotInfo').textContent = 'press Run';
      return;
    }

    const key = $('decoder').value;
    const n = d.shots.length;
    if (st.view === 'heat') {
      const det = (s, r, c) => s.grid[r][c] ^ (r ? s.grid[r - 1][c] : 0);
      const rate = (c) => d.shots.reduce((a, s) => a + [...Array(rows).keys()].reduce((b, r) => b + det(s, r, c), 0), 0) / (n * rows);
      for (let r = 0; r < rows; r++) for (let c = 0; c < 12; c++) {
        const f = d.shots.reduce((a, s) => a + det(s, r, c), 0) / n;
        box(cx(c), ry(r), tint(c), Math.min(1, f * 2.5));
      }
      for (const k of [0, 1]) {
        const blame = [...Array(7).keys()].map((q) => key === 'none' ? 0
          : Math.min(1, 2.5 * d.shots.reduce((a, s) => a + s[key].data_marks.filter((m) => m === k * 7 + q).length, 0) / n));
        block(k, zero3.map((_, f) => Math.min(1, 2.5 * rate(k * 6 + f))), zero3.map((_, f) => Math.min(1, 2.5 * rate(k * 6 + 3 + f))),
          col.mark, blame, [], name(k));
      }
      $('shotInfo').textContent = `heat map over ${n} shots: detection rate per check (grid and faces); vertices: how often the decoder blames each qubit`;
      return;
    }

    const shot = d.shots[st.shot];
    const shown = Math.min(st.row, rows + 1);
    for (let r = 0; r < rows; r++) for (let c = 0; c < 12; c++) box(cx(c), ry(r), r < shown && cell(shot, r, c) ? tint(c) : null);
    if (key !== 'none' && shown > rows) for (const [r, c] of shot[key].meas_marks) ring(cx(c), ry(r));
    for (const k of [0, 1]) {
      let zA = zero3, xA = zero3, vA = [], rings = [], caption = `${name(k)}: q${k * 7}–q${k * 7 + 6}`, capColor;
      if (shown > rows) {
        // final readout: the faces show the parities computed from the measured data bits
        const syn = STEANE_H.map((row) => row.reduce((a, b, q) => a ^ (b & shot.data[k * 7 + q]), 0));
        [zA, xA] = d.basis === 'Z' ? [syn, zero3] : [zero3, syn];
        vA = shot.data.slice(k * 7, k * 7 + 7);
        rings = key === 'none' ? [] : shot[key].data_marks;
        const v = verdict(shot, k);
        caption = `${name(k)} = ${v.logical[0]} · ${v.ok ? 'corrected' : 'logical error'}`;
        capColor = v.ok ? col.ok : col.bad;
      } else if (shown > 0) {
        // during the rounds: the faces mirror this block's latest row of checks in the grid
        zA = zero3.map((_, f) => cell(shot, shown - 1, k * 6 + f));
        xA = zero3.map((_, f) => cell(shot, shown - 1, k * 6 + 3 + f));
      }
      block(k, zA, xA, col.d, vA, rings, caption, capColor);
    }
    let info = `shot ${st.shot + 1}/${n}`;
    if (shown > 0 && shown <= rows) info += ` · round ${shown}`;
    if (shown > rows) {
      const v = verdict(shot);
      info += ` · logical = ${v.logical.join('')} · ${v.ok ? 'corrected' : 'logical error'}`;
    }
    $('shotInfo').textContent = info;
  }

  function stats() {
    const d = st.data;
    if (!d) return;
    const e = d.logical_error, n = d.shots.length;
    const ci = (v) => 1.96 * Math.sqrt((v * (1 - v)) / n);
    const nc = (k) => d.shots.filter((s) => !s[k].converged.every(Boolean)).length / n;
    const bars = [['raw', 'No decoding', e.raw], ['bp', 'BP (min-sum)', e.bp, nc('bp')],
      ['relay', 'Relay-BP', e.relay, nc('relay')], ...(e.limit === null ? [] : [['limit', 'Optimal decoder (limit)', e.limit]])];
    const top = Math.max(0.02, ...bars.map(([k, , v]) => v + (k === 'limit' ? 0 : ci(v)))) * 1.1;
    const w = (v) => Math.min(100, (v / top) * 100);
    const note = (k, v, notConv) => [k === 'limit' ? 'exact' : `± ${pct(ci(v))}`, notConv === undefined ? '' : `${pct(notConv)} of shots did not converge`].filter(Boolean).join(' · ');
    const whisker = (v) => `<div class="ci"><i style="left:${w(Math.max(0, v - ci(v)))}%;width:${w(Math.min(top, v + ci(v))) - w(Math.max(0, v - ci(v)))}%"></i></div>`;
    $('bars').innerHTML = bars.map(([k, label, v, notConv]) =>
      `<div class="bar ${k}"><div class="bar-head"><span>${label}</span><b>${pct(v)}</b></div>` +
      `<div class="track" role="img" aria-label="${label}: ${pct(v)}"><div class="fill" style="width:${w(v)}%"></div>` +
      (k === 'limit' || e.limit === null ? '' : `<div class="lim" style="left:${w(e.limit)}%" title="optimal-decoder limit"></div>`) +
      `</div>${k === 'limit' ? '' : whisker(v)}<p class="bar-note">${note(k, v, notConv)}</p></div>`).join('') +
      `<p class="note">${e.limit === null
        ? 'No optimal-decoder limit for SI1000: its noise is circuit-level, and the exact limit would need a circuit-level error model, not the rough one the decoders use.'
        : 'Black tick = limit: the exact error rate of the best decoder that reads one error type at a time, for this code and noise. With few shots a decoder can land below it by chance; over many shots, only a joint decoder can beat it.'} ± is the 95% interval for ${n} shots.</p>`;
    const outs = [...new Set([...Object.keys(d.ideal), ...Object.keys(d.hist.raw), ...Object.keys(d.hist.bp), ...Object.keys(d.hist.relay)])].sort();
    const cnt = (h, o) => `${(((h[o] || 0) / n) * 100).toFixed(0)}%`;
    $('hist').innerHTML = `<tr><th>${d.basis}${d.basis}</th><th>ideal</th><th>raw</th><th>BP</th><th>Relay</th></tr>` +
      outs.map((o) => `<tr><td>${o}</td><td>${((d.ideal[o] || 0) * 100).toFixed(0)}%</td><td>${cnt(d.hist.raw, o)}</td><td>${cnt(d.hist.bp, o)}</td><td>${cnt(d.hist.relay, o)}</td></tr>`).join('');
  }

  draw();

  // Open in a prepared state: ?circuit=bell&noise=depolarizing&p=0.03&rounds=3&shots=256&readout=Z&decoder=relay&view=det&run=1
  const q = new URLSearchParams(location.search);
  const setSel = (id, v) => { if (v !== null && [...$(id).options].some((o) => o.value === v || o.text === v)) $(id).value = v; };
  if (CIRCUITS[q.get('circuit')]) { $('preset').value = CIRCUITS[q.get('circuit')]; setPreset(); }
  setSel('channel', q.get('noise')); setSel('rounds', q.get('rounds')); setSel('shots', q.get('shots'));
  setSel('basis', q.get('readout')); setSel('decoder', q.get('decoder'));
  if (q.get('p') !== null && +q.get('p') >= 0 && +q.get('p') <= 0.1) { $('p').value = q.get('p'); showP(); }
  if (['raw', 'det', 'heat'].includes(q.get('view'))) document.querySelector(`[data-view="${q.get('view')}"]`).click();
  if (q.get('run') === '1') $('run').click();
}

/* @ds-bundle: {"format":4,"namespace":"SteanePatterns","components":[{"name":"CheckGrid"},{"name":"SteaneTriangle"},{"name":"LiveFigure"}]} */
(function () {
  'use strict';

  var LABELS = ['Z1', 'Z2', 'Z3', 'X1', 'X2', 'X3'];

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  var ICON_OK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';
  var ICON_BAD = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

  /* A verdict is always an icon plus words, never a colour alone. */
  function Verdict(kind, text) {
    var cls = kind === 'ok' ? 'is-ok' : kind === 'bad' ? 'is-bad' : '';
    var icon = kind === 'ok' ? ICON_OK : kind === 'bad' ? ICON_BAD : '';
    return '<p class="sp-verdict ' + cls + '">' + icon + '<span>' + esc(text) + '</span></p>';
  }

  /*
   * CheckGrid({ rows, rowCount, view, blame, label })
   *   rows   [[x6]]  one array per round; raw/det: 0 or 1; heat: a fraction 0..1
   *   view   'raw' | 'det' | 'heat'
   *   blame  [[round, column]]  cells the decoder blames
   */
  function CheckGrid(o) {
    o = o || {};
    var rows = o.rows || [];
    var n = o.rowCount || rows.length || 3;
    var view = o.view || 'raw';
    var blame = (o.blame || []).map(function (b) { return b[0] + ':' + b[1]; });
    var h = '<div class="sp-grid" role="group" aria-label="' + esc(o.label || 'Parity checks') + '">';
    h += '<span></span>';
    for (var c = 0; c < 6; c++) {
      h += '<span class="sp-grid__col sp-grid__col--' + (c < 3 ? 'z' : 'x') + '">' + LABELS[c] + '</span>';
    }
    for (var r = 0; r < n; r++) {
      h += '<span class="sp-grid__row">r' + (r + 1) + '</span>';
      for (var k = 0; k < 6; k++) {
        var v = rows[r] ? rows[r][k] : 0;
        var kind = k < 3 ? 'z' : 'x';
        var cls = 'sp-cell';
        var style = '';
        if (view === 'heat') {
          cls += ' is-heat is-' + kind;
          style = ' style="--f:' + Math.max(0, Math.min(1, v || 0)).toFixed(2) + '"';
        } else if (v) {
          cls += ' is-' + kind;
        }
        if (blame.indexOf(r + ':' + k) >= 0) cls += ' is-blame';
        var state = view === 'heat' ? 'fires in ' + Math.round((v || 0) * 100) + '% of shots' : v ? 'fired' : 'quiet';
        h += '<span class="' + cls + '"' + style + ' role="img" aria-label="r' + (r + 1) + ' ' + LABELS[k] + ' ' + state + '"></span>';
      }
    }
    return h + '</div>';
  }

  /*
   * SteaneTriangle({ name, base, faces, data, blame, verdict, caption })
   *   name     'A' | 'B'
   *   base     first qubit number shown on the vertices (0 for A, 7 for B)
   *   faces    [{z, x}] x3: a face's Z check fired (fill), X check fired (blue outline)
   *   data     [0|1] x7: qubit read as 1 (filled vertex)
   *   blame    [0..6]  vertices the decoder blames (pink ring)
   *   verdict  'ok' | 'bad' | undefined, with caption text under the triangle
   * Local vertex order: 0 bottom-right, 1 bottom-left, 2 bottom-middle, 3 apex, 4 middle-right, 5 middle-left, 6 centre.
   */
  var V = [[238, 207], [22, 207], [130, 207], [130, 20], [184, 113.5], [76, 113.5], [130, 144.7]];
  var FACES = [[3, 5, 6, 4], [5, 1, 2, 6], [4, 6, 2, 0]];

  function pts(list) { return list.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '); }

  function SteaneTriangle(o) {
    o = o || {};
    var base = o.base || 0;
    var faces = o.faces || [{}, {}, {}];
    var data = o.data || [];
    var blame = o.blame || [];
    var s = '<svg viewBox="0 0 260 236" role="img" aria-label="Steane code ' + esc(o.name || '') + ': seven data qubits on the vertices, three parity checks on the faces">';
    var cs = [];
    FACES.forEach(function (f, i) {
      var poly = f.map(function (v) { return V[v]; });
      var cx = poly.reduce(function (a, p) { return a + p[0]; }, 0) / 4;
      var cy = poly.reduce(function (a, p) { return a + p[1]; }, 0) / 4;
      cs.push([cx, cy]);
      s += '<polygon class="face' + (faces[i] && faces[i].z ? ' is-z' : '') + '" points="' + pts(poly) + '"/>';
    });
    FACES.forEach(function (f, i) {
      if (!(faces[i] && faces[i].x)) return;
      var inset = f.map(function (v) {
        return [cs[i][0] + (V[v][0] - cs[i][0]) * 0.8, cs[i][1] + (V[v][1] - cs[i][1]) * 0.8];
      });
      s += '<polygon class="xring" points="' + pts(inset) + '"/>';
    });
    cs.forEach(function (c, i) {
      s += '<circle class="fchip" cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="9"/>' +
           '<text class="facenum" x="' + c[0].toFixed(1) + '" y="' + (c[1] + 0.5).toFixed(1) + '">' + (i + 1) + '</text>';
    });
    V.forEach(function (p, i) {
      var one = data[i] ? ' is-one' : '';
      var hit = o.interactive
        ? ' is-hit" tabindex="0" role="button" aria-pressed="' + (data[i] ? 'true' : 'false') + '" aria-label="Qubit ' + (base + i) + '"'
        : '"';
      s += '<circle class="vtx' + one + hit + ' data-v="' + i + '" cx="' + p[0] + '" cy="' + p[1] + '" r="11"/>' +
           '<text class="vnum" x="' + p[0] + '" y="' + (p[1] + 0.5) + '">' + (base + i) + '</text>';
    });
    blame.forEach(function (i) {
      s += '<circle class="blame" cx="' + V[i][0] + '" cy="' + V[i][1] + '" r="17"/>';
    });
    s += '</svg>';
    var cap = o.verdict || o.caption ? Verdict(o.verdict, o.caption || '') : '';
    return '<figure class="sp-tri">' + s + (cap ? '<figcaption>' + cap + '</figcaption>' : '') + '</figure>';
  }

  /*
   * LiveFigure(el, { mode })  mounts the interactive syndrome figure into el.
   * Click (or press Enter on) a vertex to flip that qubit. The faces that fire are the code's checks,
   * read as a binary number they name the culprit (column j of the Hamming matrix is j + 1 in binary),
   * the decoder flips that qubit back, and a leftover of odd weight is a logical error.
   * mode: 'x' bit flips (Z checks fire, orange) or 'z' phase flips (X checks fire, blue).
   */
  function LiveFigure(el, opts) {
    opts = opts || {};
    var st = { mode: opts.mode === 'z' ? 'z' : 'x', err: {} };
    var bits = function (s) { return s.join(' '); };

    function analyse() {
      var E = [];
      for (var v = 0; v < 7; v++) if (st.err[v]) E.push(v);
      var s = FACES.map(function (f) { return f.reduce(function (a, v) { return a ^ (st.err[v] ? 1 : 0); }, 0); });
      var n = s[0] * 4 + s[1] * 2 + s[2];
      var c = n ? n - 1 : -1;
      var R = E.filter(function (v) { return v !== c; });
      if (c >= 0 && !st.err[c]) R.push(c);
      return { E: E, s: s, n: n, c: c, R: R, logical: R.length % 2 === 1 };
    }

    function hint(a) {
      if (!a.E.length) return 'No qubit is flipped, so every check reads 0. Click a vertex to flip it.';
      if (a.E.length === 1) return 'One flip lights the faces that touch it. Read as a binary number, the pattern ' + a.s.join('') + ' is ' + a.n + ', so the culprit is qubit ' + (a.n - 1) + '.';
      if (a.E.length === 2) return 'Two flips look exactly like one flip on a third qubit. The decoder fixes the wrong one, and what is left is a logical error.';
      return a.logical
        ? 'Too many flips for a distance-3 code: the decoder is fooled and a logical error remains.'
        : 'Lucky: the decoder’s fix and your flips differ by a whole check (four qubits), which changes nothing.';
    }

    function render(focus) {
      var a = analyse(), z = st.mode === 'x';
      var tri = SteaneTriangle({
        name: 'A', base: 0, interactive: true,
        faces: a.s.map(function (f) { return z ? { z: f } : { x: f }; }),
        data: [0, 1, 2, 3, 4, 5, 6].map(function (v) { return st.err[v] ? 1 : 0; }),
        blame: a.c >= 0 ? [a.c] : []
      });
      var kind = a.E.length === 0 ? 'ok' : a.logical ? 'bad' : 'ok';
      var words = a.E.length === 0 ? 'no errors' : a.logical ? 'logical error' : 'corrected';
      el.innerHTML =
        '<div class="sp-live">' +
          '<div class="sp-live__bar"><p class="sp-eyebrow">Live figure</p>' +
            '<div class="sp-seg" role="radiogroup" aria-label="Error type">' +
              '<button role="radio" data-mode="x" aria-checked="' + z + '" aria-pressed="' + z + '">Bit flip (X)</button>' +
              '<button role="radio" data-mode="z" aria-checked="' + !z + '" aria-pressed="' + !z + '">Phase flip (Z)</button>' +
            '</div>' +
            '<button class="sp-btn" data-clear>Clear</button></div>' +
          '<div class="sp-live__body">' + tri +
            '<dl class="sp-live__read">' +
              '<div><dt>' + (z ? 'Z' : 'X') + ' checks fired</dt><dd>' + bits(a.s) + '</dd></div>' +
              '<div><dt>Read as a number</dt><dd>' + a.s.join('') + '₂ = ' + a.n + '</dd></div>' +
              '<div><dt>Decoder blames</dt><dd>' + (a.c >= 0 ? 'qubit ' + a.c : 'nothing to fix') + '</dd></div>' +
              '<div><dt>Result</dt><dd>' + Verdict(kind, words) + '</dd></div>' +
            '</dl>' +
          '</div>' +
          '<p class="sp-caption sp-live__hint" role="status">' + esc(hint(a)) + '</p>' +
        '</div>';
      if (focus != null) { var f = el.querySelector('[data-v="' + focus + '"]'); if (f) f.focus(); }
    }

    function toggle(v) { st.err[v] = !st.err[v]; render(v); }
    el.addEventListener('click', function (e) {
      var v = e.target.closest('[data-v]'), m = e.target.closest('[data-mode]'), c = e.target.closest('[data-clear]');
      if (v) toggle(+v.getAttribute('data-v'));
      else if (m) { st.mode = m.getAttribute('data-mode'); st.err = {}; render(); }
      else if (c) { st.err = {}; render(); }
    });
    el.addEventListener('keydown', function (e) {
      var v = e.target.closest && e.target.closest('[data-v]');
      if (v && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(+v.getAttribute('data-v')); }
    });
    render();
    return { reset: function () { st.err = {}; render(); } };
  }

  /* The one place that knows where the source lives. Links carry a relative href (works offline from a
     checkout) and a data-src path; here they are pointed at the repository. */
  var REPO = 'https://github.com/Totoratsu/steane-patterns/blob/main/';
  Array.prototype.forEach.call(document.querySelectorAll('a[data-src]'), function (a) {
    a.href = REPO + a.getAttribute('data-src');
  });

  /* On narrow screens the chapter list starts folded, so readers reach the title first. */
  if (window.matchMedia) {
    var narrow = window.matchMedia('(max-width: 1100px)');
    var fold = function () {
      Array.prototype.forEach.call(document.querySelectorAll('.sp-nav-details'), function (d) { d.open = !narrow.matches; });
    };
    fold();
    narrow.addEventListener('change', fold);
  }

  window.SteanePatterns = {
    CheckGrid: CheckGrid,
    SteaneTriangle: SteaneTriangle,
    LiveFigure: LiveFigure
  };
})();

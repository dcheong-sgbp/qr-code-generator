/**
 * <qr-code-generator> — byte-mode QR code on canvas, with PNG download. Zero dependencies.
 * Correct QR encoder: Reed-Solomon over GF(256), versions 1-10, ECC level M, best-mask selection.
 * Built & maintained by SGBP — Singapore Build Partners (https://sgbp.tech). MIT.
 */
(function () {
  // ---- GF(256) tables (primitive 0x11D) ----
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  // level-M spec tables, indexed by version (1..10)
  const ECC = { 1: [10, 1, 16, 0, 0], 2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0], 4: [18, 2, 32, 0, 0], 5: [24, 2, 43, 0, 0], 6: [16, 4, 27, 0, 0], 7: [18, 4, 31, 0, 0], 8: [22, 2, 38, 2, 39], 9: [22, 3, 36, 2, 37], 10: [26, 4, 43, 1, 44] };
  const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
  const dataCap = (v) => { const [, b1, d1, b2, d2] = ECC[v]; return b1 * d1 + b2 * d2; };

  // Reed-Solomon divisor (degree coeffs, high-first, implicit leading 1) — nayuki-style.
  function rsDivisor(degree) {
    const result = new Array(degree).fill(0); result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) { result[j] = gmul(result[j], root); if (j + 1 < degree) result[j] ^= result[j + 1]; }
      root = gmul(root, 2);
    }
    return result;
  }
  function rsEcc(data, deg) {
    const div = rsDivisor(deg); const res = new Array(deg).fill(0);
    for (const d of data) { const factor = d ^ res.shift(); res.push(0); for (let j = 0; j < deg; j++) res[j] ^= gmul(div[j], factor); }
    return res;
  }

  function encodeBytes(text) {
    const bytes = new TextEncoder().encode(text);
    let version = 0;
    for (let v = 1; v <= 10; v++) { const ccBits = v < 10 ? 8 : 16; const need = 4 + ccBits + bytes.length * 8; if (need <= dataCap(v) * 8) { version = v; break; } }
    if (!version) throw new Error("too much data (max ~216 bytes)");
    const ccBits = version < 10 ? 8 : 16;
    // bit stream
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(0b0100, 4); push(bytes.length, ccBits); for (const b of bytes) push(b, 8);
    const cap = dataCap(version) * 8;
    for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0); // terminator
    while (bits.length % 8) bits.push(0);
    const cw = []; for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; cw.push(b); }
    const pads = [0xec, 0x11]; let pi = 0; while (cw.length < dataCap(version)) cw.push(pads[pi++ % 2]);
    // split into blocks
    const [ec, b1, d1, b2, d2] = ECC[version];
    const blocks = [];
    let idx = 0;
    for (let i = 0; i < b1; i++) { blocks.push(cw.slice(idx, idx + d1)); idx += d1; }
    for (let i = 0; i < b2; i++) { blocks.push(cw.slice(idx, idx + d2)); idx += d2; }
    const eccBlocks = blocks.map((b) => rsEcc(b, ec));
    // interleave
    const out = [];
    const maxD = Math.max(d1, d2 || 0);
    for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
    for (let i = 0; i < ec; i++) for (const e of eccBlocks) out.push(e[i]);
    return { version, codewords: out };
  }

  // BCH for format (15,5) and version (18,6)
  function bch(data, g, n) { let d = data << (n); const gLen = g.toString(2).length; while (d.toString(2).length >= gLen) d ^= g << (d.toString(2).length - gLen); return (data << n) | d; }
  function formatBits(mask) { const data = (0b00 << 3) | mask; /* M = 00 */ const b = bch(data, 0b10100110111, 10); return (b ^ 0b101010000010010); }
  function versionBits(v) { return bch(v, 0b1111100100101, 12); }

  function buildMatrix(text, forceMask) {
    const { version, codewords } = encodeBytes(text);
    const N = 17 + version * 4;
    const m = Array.from({ length: N }, () => new Array(N).fill(null)); // null=empty, true/false module
    const res = Array.from({ length: N }, () => new Array(N).fill(false)); // reserved (function)
    const setF = (r, c, val) => { m[r][c] = val; res[r][c] = true; };
    const finder = (r, c) => { for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) { const rr = r + i, cc = c + j; if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue; const on = (i >= 0 && i <= 6 && (j === 0 || j === 6)) || (j >= 0 && j <= 6 && (i === 0 || i === 6)) || (i >= 2 && i <= 4 && j >= 2 && j <= 4); setF(rr, cc, on); } };
    finder(0, 0); finder(0, N - 7); finder(N - 7, 0);
    // timing
    for (let i = 8; i < N - 8; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    // alignment
    const ac = ALIGN[version];
    for (const r of ac) for (const c of ac) { if ((r <= 8 && c <= 8) || (r <= 8 && c >= N - 9) || (r >= N - 9 && c <= 8)) continue; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) setF(r + i, c + j, Math.max(Math.abs(i), Math.abs(j)) !== 1); }
    // dark module + reserve format areas
    setF(N - 8, 8, true);
    for (let i = 0; i <= 8; i++) { if (!res[8][i]) res[8][i] = true; if (!res[i][8]) res[i][8] = true; }
    for (let i = 0; i < 8; i++) { res[8][N - 1 - i] = true; res[N - 1 - i][8] = true; }
    // reserve version info (v7+)
    if (version >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { res[i][N - 11 + j] = true; res[N - 11 + j][i] = true; }
    // place data (zigzag)
    let bitIdx = 0; const totalBits = codewords.length * 8;
    const getBit = () => bitIdx < totalBits ? ((codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) : 0;
    let up = true;
    for (let col = N - 1; col > 0; col -= 2) {
      if (col === 6) col = 5;
      for (let k = 0; k < N; k++) {
        const row = up ? N - 1 - k : k;
        for (let c = 0; c < 2; c++) { const cc = col - c; if (res[row][cc]) continue; m[row][cc] = getBit() === 1; bitIdx++; }
      }
      up = !up;
    }
    // masks + penalty
    const maskFns = [(i, j) => (i + j) % 2 === 0, (i) => i % 2 === 0, (i, j) => j % 3 === 0, (i, j) => (i + j) % 3 === 0, (i, j) => (((i >> 1) + Math.floor(j / 3)) % 2) === 0, (i, j) => ((i * j) % 2 + (i * j) % 3) === 0, (i, j) => (((i * j) % 2 + (i * j) % 3) % 2) === 0, (i, j) => ((((i + j) % 2) + (i * j) % 3) % 2) === 0];
    function penalty(g) {
      let p = 0;
      for (let i = 0; i < N; i++) { let rc = 1, cc = 1; for (let j = 1; j < N; j++) { if (g[i][j] === g[i][j - 1]) { rc++; if (rc === 5) p += 3; else if (rc > 5) p++; } else rc = 1; if (g[j][i] === g[j - 1][i]) { cc++; if (cc === 5) p += 3; else if (cc > 5) p++; } else cc = 1; } }
      for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) if (g[i][j] === g[i][j + 1] && g[i][j] === g[i + 1][j] && g[i][j] === g[i + 1][j + 1]) p += 3;
      let dark = 0; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (g[i][j]) dark++;
      const ratio = (dark * 100) / (N * N); p += Math.floor(Math.abs(ratio - 50) / 5) * 10;
      return p;
    }
    let best = null, bestP = Infinity, bestMask = 0;
    const mkLo = forceMask == null ? 0 : forceMask, mkHi = forceMask == null ? 7 : forceMask;
    for (let mk = mkLo; mk <= mkHi; mk++) {
      const g = m.map((row) => row.slice());
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (!res[i][j] && maskFns[mk](i, j)) g[i][j] = !g[i][j];
      // write format bits for this mask (row,col layout, matches spec)
      const fmt = formatBits(mk);
      const fb = (i) => ((fmt >> i) & 1) === 1;
      // first copy: col 8 (rows 0-5,7,8) then row 8 (cols 7,5..0)
      for (let i = 0; i <= 5; i++) g[i][8] = fb(i);
      g[7][8] = fb(6); g[8][8] = fb(7); g[8][7] = fb(8);
      for (let i = 9; i < 15; i++) g[8][14 - i] = fb(i);
      // second copy: row 8 (cols N-1..N-8) then col 8 (rows N-7..N-1)
      for (let i = 0; i < 8; i++) g[8][N - 1 - i] = fb(i);
      for (let i = 8; i < 15; i++) g[N - 15 + i][8] = fb(i);
      if (version >= 7) { const vb = versionBits(version); for (let i = 0; i < 18; i++) { const bit = ((vb >> i) & 1) === 1; const r = Math.floor(i / 3), c = i % 3; g[r][N - 11 + c] = bit; g[N - 11 + c][r] = bit; } }
      const p = penalty(g);
      if (p < bestP) { bestP = p; best = g; bestMask = mk; }
    }
    return best;
  }

  class QrCodeGenerator extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: "open" }); }
    connectedCallback() { this.render(); }
    _draw(text) {
      const $ = (s) => this.shadowRoot.querySelector(s);
      const cv = $("#cv"), err = $("#err");
      if (!text) { cv.getContext("2d").clearRect(0, 0, cv.width, cv.height); err.textContent = ""; return; }
      let g;
      try { g = buildMatrix(text); err.textContent = ""; }
      catch (e) { err.textContent = e.message; return; }
      const N = g.length, quiet = 4, scale = Math.max(2, Math.floor(320 / (N + quiet * 2)));
      const size = (N + quiet * 2) * scale;
      cv.width = size; cv.height = size;
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#000";
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (g[i][j]) ctx.fillRect((j + quiet) * scale, (i + quiet) * scale, scale, scale);
    }
    render() {
      this.shadowRoot.innerHTML = `
        <style>
          *,*::before,*::after{box-sizing:border-box}
          :host{display:block;width:100%;max-width:520px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
          .card{border:1px solid #e2e2e2;border-radius:12px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.06);padding:16px}
          label{display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:600;color:#555;margin-bottom:6px}
          .mini{font:inherit;font-size:11px;font-weight:700;color:#EB0028;background:none;border:0;cursor:pointer}
          input{width:100%;padding:10px 12px;border:1px solid #ccc;border-radius:8px;font-size:16px}
          .stage{margin-top:14px;background:#fafafa;border:1px solid #eee;border-radius:10px;padding:16px;text-align:center}
          canvas{image-rendering:pixelated;max-width:100%;height:auto}
          .err{color:#c5221f;font-size:12.5px;font-weight:600;margin-top:8px;min-height:16px}
          .dl{margin-top:12px;font:inherit;font-size:12px;font-weight:700;color:#fff;background:#EB0028;border:0;border-radius:8px;padding:9px 14px;cursor:pointer}
        </style>
        <div class="card">
          <label>Text or URL <button class="mini" id="clear">Clear</button></label>
          <input id="in" type="text" value="https://sgbp.tech" spellcheck="false" autocomplete="off">
          <div class="stage"><canvas id="cv" width="320" height="320"></canvas></div>
          <div class="err" id="err"></div>
          <button class="dl" id="dl">Download PNG</button>
        </div>`;
      const $ = (s) => this.shadowRoot.querySelector(s);
      const redraw = () => this._draw($("#in").value);
      $("#in").addEventListener("input", redraw);
      $("#clear").addEventListener("click", () => { $("#in").value = ""; redraw(); $("#in").focus(); });
      $("#dl").addEventListener("click", () => { const a = document.createElement("a"); a.href = $("#cv").toDataURL("image/png"); a.download = "qr-code.png"; a.click(); });
      redraw();
    }
  }
  if (!customElements.get("qr-code-generator")) customElements.define("qr-code-generator", QrCodeGenerator);
  // expose encoder for tests
})();

// ============================================================================
//  Physics
// ============================================================================
const K = {
  G: 6.67430e-11, c: 2.99792458e8, Msun: 1.98847e30, hbar: 1.054571817e-34,
  h: 6.62607015e-34, kB: 1.380649e-23, sigma: 5.670374419e-8, mp: 1.67262192369e-27,
  sigmaT: 6.6524587321e-29, Lsun: 3.828e26, pc: 3.0856775814913673e16,
  AU: 1.495978707e11, ly: 9.4607304725808e15, yr: 3.15576e7, wien: 2.897771955e-3,
};

// Page & Thorne (1974) flux for a Schwarzschild thin disk, x = r c^2 / GM.
// F(x) = (3 G M Mdot / 8 pi (GM/c^2)^3) * Q(x) / x^3, with Q -> 1 - sqrt(6/x) far out.
const PT = (() => {
  const s3 = Math.sqrt(3), s6 = Math.sqrt(6);
  const Q = (x) => {
    if (x <= 6) return 0;
    const sx = Math.sqrt(x);
    const I = sx - s6 + (s3 / 2) * Math.log(((sx + s3) * (s6 - s3)) / ((sx - s3) * (s6 + s3)));
    return (sx * I) / (x - 3);
  };
  const shape = (x) => (x <= 6 ? 0 : Q(x) / (x * x * x));
  let xPeak = 6, shapeMax = 0;
  for (let x = 6.001; x < 80; x += 0.001) { const s = shape(x); if (s > shapeMax) { shapeMax = s; xPeak = x; } }
  return { Q, shape, xPeak, shapeMax };
})();

// ---- Colorimetry: Planck spectrum -> CIE 1931 XYZ -> linear sRGB ----------
// Multi-lobe Gaussian fit to the CIE 1931 2° observer (Wyman, Sloan & Shirley 2013).
function cieXYZ(l) {
  const g = (x, mu, s1, s2) => { const t = (x - mu) * (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); };
  return [
    1.056 * g(l, 599.8, 0.0264, 0.0323) + 0.362 * g(l, 442.0, 0.0624, 0.0374) - 0.065 * g(l, 501.1, 0.0490, 0.0382),
    0.821 * g(l, 568.8, 0.0213, 0.0247) + 0.286 * g(l, 530.9, 0.0613, 0.0322),
    1.217 * g(l, 437.0, 0.0845, 0.0278) + 0.681 * g(l, 459.0, 0.0385, 0.0725),
  ];
}
const CIE_TABLE = (() => { const t = []; for (let l = 380; l <= 780; l += 5) t.push([l, cieXYZ(l)]); return t; })();
function planckLambda(lm, T) { // W sr^-1 m^-3
  const a = (2 * K.h * K.c * K.c) / Math.pow(lm, 5);
  const x = (K.h * K.c) / (lm * K.kB * T);
  return x > 700 ? 0 : a / Math.expm1(x);
}
function blackbodyRGB(T) { // linear sRGB, absolute (arbitrary but consistent units)
  let X = 0, Y = 0, Z = 0;
  for (const [l, c] of CIE_TABLE) { const B = planckLambda(l * 1e-9, T); X += B * c[0]; Y += B * c[1]; Z += B * c[2]; }
  return [
     3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z,
     0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  ].map((v) => Math.max(v, 0));
}
const lumOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const BB = (() => {
  const N = 512, lo = 2.8, hi = 9.0;
  const ref = Math.log10(lumOf(blackbodyRGB(6000)));
  const data = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const T = Math.pow(10, lo + (i / (N - 1)) * (hi - lo));
    const c = blackbodyRGB(T); const L = Math.max(lumOf(c), 1e-300);
    data[i * 4] = c[0] / L; data[i * 4 + 1] = c[1] / L; data[i * 4 + 2] = c[2] / L;
    data[i * 4 + 3] = Math.max(Math.log10(L) - ref, -60);
  }
  const relLum = (T) => lumOf(blackbodyRGB(T)) / Math.pow(10, ref);
  const chroma = (T) => { const c = blackbodyRGB(T); const L = lumOf(c); return c.map((v) => v / L); };
  return { N, lo, hi, data, relLum, chroma };
})();

// ---- Derived quantities -----------------------------------------------------
function derive(Msolar, mdot, Drs) {
  const M = Msolar * K.Msun, c = K.c, c2 = c * c, GM = K.G * M;
  const rs = (2 * GM) / c2, Mg = GM / c2, tg = GM / (c2 * c);
  const bc = 1.5 * Math.sqrt(3) * rs;
  const LEdd = (4 * Math.PI * GM * K.mp * c) / K.sigmaT;
  const eta = 1 - Math.sqrt(8 / 9);
  const L = mdot * LEdd, Mdot = L / (eta * c2);
  const Tpeak = Math.pow(((3 * GM * Mdot) / (8 * Math.PI * K.sigma * Mg ** 3)) * PT.shapeMax, 0.25);
  return {
    M, rs, tg,
    rph: 1.5 * rs, risco: 3 * rs, bc,
    tcross: rs / c,
    kappa: (c2 * c2) / (4 * GM),
    TH: (K.hbar * c2 * c) / (8 * Math.PI * GM * K.kB),
    tevap: (5120 * Math.PI * K.G * K.G * M ** 3) / (K.hbar * c2 * c2),
    S: (4 * Math.PI * K.G * M * M) / (K.hbar * c),
    rho: M / ((4 / 3) * Math.PI * rs ** 3),
    tidal: (2 * GM * 2.0) / rs ** 3,
    LEdd, eta, L, Mdot, Tpeak,
    lamPeak: K.wien / Tpeak,
    rPeak: (PT.xPeak / 2) * rs,
    Pisco: 2 * Math.PI * Math.sqrt((3 * rs) ** 3 / GM),
    Pph: 2 * Math.PI * 3 * Math.sqrt(3) * tg,
    dtau: Math.sqrt(1 - 1 / Drs),
    shadowLocal: 2 * Math.asin(Math.min(1, ((1.5 * Math.sqrt(3)) / Drs) * Math.sqrt(1 - 1 / Drs))),
    vesc: Math.sqrt(1 / Drs),
  };
}

// ---- Formatting -------------------------------------------------------------
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = (n) => String(n).split('').map((ch) => SUP[ch] ?? ch).join('');
function sig(x, d = 3) {
  if (!isFinite(x)) return '∞';
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e >= -3 && e < 5) {
    const dec = Math.max(0, d - 1 - e);
    return Number(x.toPrecision(d)).toLocaleString('en-US', { maximumFractionDigits: Math.min(dec, 6) });
  }
  let m = x / Math.pow(10, e);
  let mm = m.toFixed(d - 1);
  let ee = e;
  if (Math.abs(parseFloat(mm)) >= 10) { ee += 1; mm = (m / 10).toFixed(d - 1); }
  return `${mm} × 10${sup(ee)}`;
}
function fmtLen(m) {
  const a = Math.abs(m);
  if (a < 1) return `${sig(m * 1000)} mm`;
  if (a < 1e4) return `${sig(m)} m`;
  if (a < 0.05 * K.AU) return `${sig(m / 1000)} km`;
  if (a < 0.1 * K.ly) return `${sig(m / K.AU)} AU`;
  if (a < 1000 * K.pc) return `${sig(m / K.ly)} ly`;
  return `${sig(m / K.pc / 1e6)} Mpc`;
}
function fmtTime(s) {
  const a = Math.abs(s);
  if (a < 1e-3) return `${sig(s * 1e6)} µs`;
  if (a < 1) return `${sig(s * 1e3)} ms`;
  if (a < 120) return `${sig(s)} s`;
  if (a < 7200) return `${sig(s / 60)} min`;
  if (a < 172800) return `${sig(s / 3600)} h`;
  if (a < K.yr) return `${sig(s / 86400)} days`;
  return `${sig(s / K.yr)} yr`;
}
function fmtTemp(T) {
  if (T < 1e-9) return `${sig(T)} K`;
  if (T < 1e-6) return `${sig(T * 1e9)} nK`;
  if (T < 1e-3) return `${sig(T * 1e6)} µK`;
  if (T < 1) return `${sig(T * 1e3)} mK`;
  return `${sig(T)} K`;
}
function fmtAngle(rad) {
  const deg = (rad * 180) / Math.PI;
  if (deg >= 1) return `${sig(deg)}°`;
  const as = deg * 3600;
  if (as >= 60) return `${sig(as / 60)}′`;
  if (as >= 1) return `${sig(as)}″`;
  if (as >= 1e-3) return `${sig(as * 1e3)} mas`;
  return `${sig(as * 1e6)} µas`;
}
function bandOf(lam) {
  if (lam < 1e-11) return 'gamma rays';
  if (lam < 1e-8) return 'X-rays';
  if (lam < 3.8e-7) return 'ultraviolet';
  if (lam < 7.5e-7) return 'visible light';
  if (lam < 1e-3) return 'infrared';
  return 'radio';
}
function fmtMass(ms) {
  if (ms >= 1e5 || ms < 0.01) return sig(ms, 3);
  return sig(ms, 3);
}

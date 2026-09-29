// ============================================================================
//  Spacetime page: physics
//  World frame: ecliptic J2000 with y = ecliptic north, x = vernal equinox, z = -Y_ecl.
//  All state in SI units (m, s) and double precision.
// ============================================================================
const C_LIGHT = 299792458, C2 = C_LIGHT * C_LIGHT, G_NEWTON = 6.67430e-11, AU_M = 1.495978707e11, DAY = 86400;
const rad = (d) => (d * Math.PI) / 180;
const eclToWorld = (e) => [e[0], e[2], -e[1]];
function equToEcl(q) { const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY); return [q[0], q[1] * c + q[2] * s, -q[1] * s + q[2] * c]; }
function eclToEqu(e) { const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY); return [e[0], e[1] * c - e[2] * s, e[1] * s + e[2] * c]; }
const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};

// ---- Time --------------------------------------------------------------------
const jdFromDate = (ms) => ms / 86400000 + 2440587.5;
const TT_MINUS_UTC = 69.184;   // 32.184 s + 37 leap seconds
const centuriesTT = (jdUtc) => (jdUtc + TT_MINUS_UTC / DAY - 2451545.0) / 36525;
function gmstRad(jdUtc) {
  const d = jdUtc - 2451545.0, T = d / 36525;
  const g = 280.46061837 + 360.98564736629 * d + 0.000387933 * T * T;
  return rad(((g % 360) + 360) % 360);
}

// ---- Ephemerides ---------------------------------------------------------------
function keplerEcl(key, T) {
  const el = KEPLER[key];
  const a = el[0] + el[6] * T, e = el[1] + el[7] * T, I = rad(el[2] + el[8] * T);
  const L = el[3] + el[9] * T, wb = el[4] + el[10] * T, Om = el[5] + el[11] * T;
  const w = rad(wb - Om), O = rad(Om);
  const M = rad((((L - wb) % 360) + 540) % 360 - 180);
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 12; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
  return [
    ((cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp) * AU_M,
    ((cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp) * AU_M,
    (sw * sI * xp + cw * sI * yp) * AU_M,
  ];
}
// Low-precision lunar theory (Astronomical Almanac): ~0.3° in longitude, ~0.2° in latitude.
function moonEcl(T) {
  const s = (x) => Math.sin(rad(x)), c = (x) => Math.cos(rad(x));
  const lam = 218.32 + 481267.881 * T + 6.29 * s(135.0 + 477198.87 * T) - 1.27 * s(259.3 - 413335.36 * T) + 0.66 * s(235.7 + 890534.22 * T)
    + 0.21 * s(269.9 + 954397.74 * T) - 0.19 * s(357.5 + 35999.05 * T) - 0.11 * s(186.5 + 966404.03 * T);
  const bet = 5.13 * s(93.3 + 483202.02 * T) + 0.28 * s(228.2 + 960400.89 * T) - 0.28 * s(318.3 + 6003.15 * T) - 0.17 * s(217.6 - 407332.21 * T);
  const par = 0.9508 + 0.0518 * c(135.0 + 477198.87 * T) + 0.0095 * c(259.3 - 413335.36 * T) + 0.0078 * c(235.7 + 890534.22 * T) + 0.0028 * c(269.9 + 954397.74 * T);
  const r = 6378.14e3 / Math.sin(rad(par));
  const l = rad(lam - 1.3969713 * T), b = rad(bet);   // mean equinox of date -> J2000
  return [r * Math.cos(b) * Math.cos(l), r * Math.cos(b) * Math.sin(l), r * Math.sin(b)];
}
function derivEcl(fn, T, hSec = 1800) {
  const h = hSec / (36525 * DAY);
  const a = fn(T - h), b = fn(T + h);
  return [(b[0] - a[0]) / (2 * hSec), (b[1] - a[1]) / (2 * hSec), (b[2] - a[2]) / (2 * hSec)];
}

// ---- N-body integrator -----------------------------------------------------------
// Fourth-order symplectic Yoshida scheme with Newtonian gravity plus the first
// post-Newtonian (Schwarzschild) correction from every sufficiently heavy source.
const YW1 = 1 / (2 - Math.cbrt(2)), YW0 = -Math.cbrt(2) / (2 - Math.cbrt(2));
const YC = [YW1 / 2, (YW0 + YW1) / 2, (YW0 + YW1) / 2, YW1 / 2], YD = [YW1, YW0, YW1];

class NBody {
  constructor() { this.bodies = []; this.t = 0; this.gr = true; this._alloc(); }
  _alloc() {
    const n = this.bodies.length;
    this.n = n; this.x = new Float64Array(n * 3); this.v = new Float64Array(n * 3); this.a = new Float64Array(n * 3);
    this.gm = new Float64Array(n); this.rad = new Float64Array(n);
  }
  sync(toArrays) {
    const B = this.bodies;
    if (toArrays) {
      if (this.n !== B.length) this._alloc();
      B.forEach((b, i) => { for (let k = 0; k < 3; k++) { this.x[i * 3 + k] = b.x[k]; this.v[i * 3 + k] = b.v[k]; } this.gm[i] = b.GM; this.rad[i] = b.R * 1000; });
    } else {
      B.forEach((b, i) => { for (let k = 0; k < 3; k++) { b.x[k] = this.x[i * 3 + k]; b.v[k] = this.v[i * 3 + k]; } });
    }
  }
  accel() {
    const n = this.n, X = this.x, Vv = this.v, A = this.a, M = this.gm, gr = this.gr;
    A.fill(0);
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      for (let j = i + 1; j < n; j++) {
        const j3 = j * 3;
        const dx = X[j3] - X[i3], dy = X[j3 + 1] - X[i3 + 1], dz = X[j3 + 2] - X[i3 + 2];
        const r2 = dx * dx + dy * dy + dz * dz, r = Math.sqrt(r2), inv3 = 1 / (r2 * r);
        const fi = M[j] * inv3, fj = M[i] * inv3;
        A[i3] += fi * dx; A[i3 + 1] += fi * dy; A[i3 + 2] += fi * dz;
        A[j3] -= fj * dx; A[j3 + 1] -= fj * dy; A[j3 + 2] -= fj * dz;
        if (gr) {
          const ux = Vv[i3] - Vv[j3], uy = Vv[i3 + 1] - Vv[j3 + 1], uz = Vv[i3 + 2] - Vv[j3 + 2];
          const u2 = ux * ux + uy * uy + uz * uz, rv = -(dx * ux + dy * uy + dz * uz); // r_ij . v_ij with r_ij = x_i - x_j
          if (M[j] / (C2 * r) > 1e-13) {           // body i in the field of j
            const k = M[j] / (C2 * r2 * r), s1 = 4 * M[j] / r - u2;
            A[i3] += k * (-s1 * dx + 4 * rv * ux); A[i3 + 1] += k * (-s1 * dy + 4 * rv * uy); A[i3 + 2] += k * (-s1 * dz + 4 * rv * uz);
          }
          if (M[i] / (C2 * r) > 1e-13) {           // body j in the field of i
            const k = M[i] / (C2 * r2 * r), s1 = 4 * M[i] / r - u2;
            A[j3] += k * (s1 * dx - 4 * rv * ux); A[j3 + 1] += k * (s1 * dy - 4 * rv * uy); A[j3 + 2] += k * (s1 * dz - 4 * rv * uz);
          }
        }
      }
    }
  }
  step(dt) {
    const n3 = this.n * 3, X = this.x, Vv = this.v, A = this.a;
    for (let s = 0; s < 4; s++) {
      const c = YC[s] * dt;
      for (let k = 0; k < n3; k++) X[k] += c * Vv[k];
      if (s < 3) { this.accel(); const d = YD[s] * dt; for (let k = 0; k < n3; k++) Vv[k] += d * A[k]; }
    }
    this.t += dt;
  }
  collisions() {
    const n = this.n, X = this.x, out = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = X[j * 3] - X[i * 3], dy = X[j * 3 + 1] - X[i * 3 + 1], dz = X[j * 3 + 2] - X[i * 3 + 2];
      const rr = this.rad[i] + this.rad[j];
      if (dx * dx + dy * dy + dz * dz < rr * rr) out.push([i, j]);
    }
    return out;
  }
}

// ---- Scene construction ---------------------------------------------------------------
function makeBody(id, spec, x, v) {
  const GM = spec.GM ?? spec.m * G_NEWTON;
  return {
    id, name: spec.name, kind: spec.kind, GM, m: GM / G_NEWTON, R: spec.R, Req: spec.Req || spec.R,
    style: spec.style, c0: spec.c0 || [0.8, 0.8, 0.8], c1: spec.c1 || [0.5, 0.5, 0.5], color: spec.color || '#E4E9F1',
    rot: spec.rot || 0, obl: spec.obl || 0, pole: spec.pole || null, caps: spec.caps || 0, bands: spec.bands || 0, rings: spec.rings || null,
    seed: Math.random() * 50, x: x.slice(), v: v.slice(), showTraj: false, trail: [], trailT: 0,
    parent: null, craft: spec.style === STYLE.craft, spin0: Math.random() * Math.PI * 2, blurb: spec.blurb || '',
    placement: spec.placement || null,
  };
}

// Fit the Moon's initial velocity so an N-body run reproduces the lunar theory for a month.
function fitMoonVelocity(sun, earth, moon, T0) {
  const target = [];
  for (let k = 1; k <= 9; k++) {
    const t = k * 3 * DAY;
    target.push([t, eclToWorld(moonEcl(T0 + t / (36525 * DAY)))]);
  }
  const run = (dv) => {
    const sim = new NBody(); sim.gr = false;
    sim.bodies = [
      { x: sun.x, v: sun.v, GM: sun.GM, R: 1 },
      { x: earth.x, v: earth.v, GM: earth.GM, R: 1 },
      { x: moon.x, v: v3.add(moon.v, dv), GM: moon.GM, R: 1 },
    ].map((b) => ({ ...b, x: b.x.slice(), v: b.v.slice() }));
    sim.sync(true);
    const res = [];
    let t = 0;
    for (const [tt, pos] of target) {
      while (t < tt - 1) { const h = Math.min(1800, tt - t); sim.step(h); t += h; }
      const X = sim.x;
      res.push(X[6] - X[3] - pos[0], X[7] - X[4] - pos[1], X[8] - X[5] - pos[2]);
    }
    return res;
  };
  let dv = [0, 0, 0];
  for (let it = 0; it < 4; it++) {
    const r0 = run(dv);
    const J = [0, 1, 2].map((k) => { const d = dv.slice(); d[k] += 0.5; const r = run(d); return r.map((x, i) => (x - r0[i]) / 0.5); });
    const JtJ = [0, 1, 2].map((a) => [0, 1, 2].map((b) => J[a].reduce((s, x, i) => s + x * J[b][i], 0)));
    const Jtr = [0, 1, 2].map((a) => J[a].reduce((s, x, i) => s + x * r0[i], 0));
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(JtJ); if (!isFinite(D) || Math.abs(D) < 1e-30) break;
    const step = [0, 1, 2].map((k) => { const m = JtJ.map((row, i) => row.map((x, j) => (j === k ? Jtr[i] : x))); return -det(m) / D; });
    dv = v3.add(dv, step);
    if (v3.len(step) < 1e-4) break;
  }
  return v3.add(moon.v, dv);
}

function buildSolarScene(dateMs) {
  const jd = jdFromDate(dateMs), T = centuriesTT(jd);
  const emb = keplerEcl('emb', T), embV = derivEcl((t) => keplerEcl('emb', t), T);
  const mg = moonEcl(T), mgV = derivEcl(moonEcl, T);
  const ge = CORE_BODIES.earth.GM, gm = CORE_BODIES.moon.GM, f = gm / (ge + gm);
  const earthE = v3.sub(emb, v3.mul(mg, f)), moonE = v3.add(emb, v3.mul(mg, 1 - f));
  const earthV = v3.sub(embV, v3.mul(mgV, f)), moonV = v3.add(embV, v3.mul(mgV, 1 - f));
  const sun = makeBody('sun', CORE_BODIES.sun, [0, 0, 0], [0, 0, 0]);
  const earth = makeBody('earth', CORE_BODIES.earth, eclToWorld(earthE), eclToWorld(earthV));
  const moon = makeBody('moon', CORE_BODIES.moon, eclToWorld(moonE), eclToWorld(moonV));
  moon.v = fitMoonVelocity(sun, earth, moon, T);
  return { jd0: jd, bodies: [sun, earth, moon] };
}

// Earth's orientation: body frame (x = Greenwich, z = north pole) -> world
function earthMatrix(jdUtc) {
  const th = gmstRad(jdUtc), c = Math.cos(th), s = Math.sin(th);
  const col = (q) => eclToWorld(equToEcl(q));
  return [col([c, s, 0]), col([-s, c, 0]), col([0, 0, 1])]; // columns: body x, y, z axes in world
}
// Generic spinning body: axis tilted by obliquity from ecliptic north (towards +x), spin angle.
function spinMatrix(oblDeg, angle, pole) {
  const o = rad(oblDeg);
  let z = [Math.sin(o), Math.cos(o), 0];
  if (pole) {  // IAU pole: right ascension and declination of the north pole
    const a = rad(pole[0]), dd = rad(pole[1]);
    z = eclToWorld(equToEcl([Math.cos(dd) * Math.cos(a), Math.cos(dd) * Math.sin(a), Math.sin(dd)]));
  }
  const xr = v3.norm(v3.cross([0, 0, 1], z)), yr = v3.cross(z, xr);
  const c = Math.cos(angle), s = Math.sin(angle);
  return [v3.add(v3.mul(xr, c), v3.mul(yr, s)), v3.add(v3.mul(xr, -s), v3.mul(yr, c)), z];
}

// ---- Hierarchy: sphere-of-influence parents ---------------------------------------------
function assignParents(bodies) {
  const order = bodies.map((b, i) => i).sort((a, b) => bodies[b].GM - bodies[a].GM);
  const soi = new Map();
  soi.set(order[0], Infinity);
  bodies[order[0]].parent = null;
  for (let k = 1; k < order.length; k++) {
    const i = order[k], b = bodies[i];
    let best = order[0], bestSoi = Infinity;
    for (let q = 0; q < k; q++) {
      const j = order[q], s = soi.get(j);
      if (bodies[j].GM <= b.GM) continue;
      if (v3.len(v3.sub(b.x, bodies[j].x)) < s && s < bestSoi) { best = j; bestSoi = s; }
    }
    b.parent = bodies[best].id;
    const p = bodies[best];
    soi.set(i, v3.len(v3.sub(b.x, p.x)) * Math.pow(b.GM / p.GM, 0.4));
  }
}
function orbitOf(b, p) {
  const r = v3.sub(b.x, p.x), v = v3.sub(b.v, p.v), mu = p.GM + b.GM;
  const rn = v3.len(r), vn = v3.len(v);
  const inva = 2 / rn - (vn * vn) / mu;
  const h = v3.cross(r, v);
  const ev = v3.sub(v3.mul(v3.cross(v, h), 1 / mu), v3.mul(r, 1 / rn));
  const a = inva > 0 ? 1 / inva : Infinity;
  return { r: rn, v: vn, a, e: v3.len(ev), period: inva > 0 ? 2 * Math.PI * Math.sqrt(a * a * a / mu) : Infinity, bound: inva > 0 };
}

// ---- Clocks -------------------------------------------------------------------------
// Weak-field proper time rate: dτ/dt = 1 - U/c² - v²/2c². Returns the two slowing terms.
function clockTerms(bodies, i, frame, earthIdx) {
  const b = bodies[i];
  const surface = !b.craft && b.R > 5;
  let U = 0;
  const xe = earthIdx >= 0 ? bodies[earthIdx].x : null;
  for (let j = 0; j < bodies.length; j++) {
    if (j === i) continue;
    const o = bodies[j];
    const d = v3.len(v3.sub(b.x, o.x));
    if (frame === 'geo' && j !== earthIdx) {
      // external bodies act only through their tidal potential in Earth's free-falling frame
      const rs = v3.sub(xe, o.x), dse = v3.len(rs);
      U += o.GM / d - o.GM / dse + (o.GM * v3.dot(rs, v3.sub(b.x, xe))) / (dse * dse * dse);
    } else U += o.GM / Math.max(d, 1);
  }
  let vel = b.v;
  if (frame === 'geo') vel = v3.sub(b.v, bodies[earthIdx].v);
  let v2 = v3.dot(vel, vel);
  if (surface) {
    const Rm = (b.Req || b.R) * 1000;
    U += b.GM / Rm;
    if (b.rot) { const vs = (2 * Math.PI * Rm) / (Math.abs(b.rot) * 3600); v2 += vs * vs; }
  }
  return { grav: U / C2, kin: v2 / (2 * C2), surface };
}

// ---- Potential for the grid (J/kg, positive depth) --------------------------------------
// Potential depth U = -Φ as seen from the free-falling frame of the grid's system.
// Bodies in the focused body's own system (its root orbiting the Sun, and everything bound to it)
// contribute their full, softened well. Every other body contributes only its tidal part: its value
// and uniform pull at the grid centre F are removed, because the whole system falls freely in that
// field (equivalence principle). The same formula is used at every zoom, so nothing switches abruptly.
function makePotential(bodies, F, soft, systemIds) {
  const terms = [];
  for (const b of bodies) {
    if (b.GM < 1e9) continue;
    const R = b.R * 1000, eps = Math.max(R, soft);
    const T = { x: b.x, GM: b.GM, R, R2: R * R, e2: eps * eps - R * R, b, full: systemIds.has(b.id), c0: 0, g: [0, 0, 0] };
    if (!T.full) {
      const dx = F[0] - b.x[0], dy = F[1] - b.x[1], dz = F[2] - b.x[2];
      const r2 = dx * dx + dy * dy + dz * dz + T.e2, r = Math.sqrt(r2);
      T.c0 = b.GM / r;
      const k = -b.GM / (r2 * r);                 // gradient of GM/r at F
      T.g = [k * dx, k * dy, k * dz];
    }
    terms.push(T);
  }
  const Uone = (T, p) => {
    const dx = p[0] - T.x[0], dy = p[1] - T.x[1], dz = p[2] - T.x[2];
    const r2 = dx * dx + dy * dy + dz * dz + T.e2;
    let u = r2 >= T.R2 ? T.GM / Math.sqrt(r2) : (T.GM * (3 * T.R2 - r2)) / (2 * T.R2 * T.R);
    if (!T.full) u -= T.c0 + T.g[0] * (p[0] - F[0]) + T.g[1] * (p[1] - F[1]) + T.g[2] * (p[2] - F[2]);
    return u;
  };
  const U = (p) => { let u = 0; for (const T of terms) u += Uone(T, p); return u; };
  return { U, Uone, terms, loc: terms };
}
// The focused body's system: climb to the ancestor that orbits the Sun, then take all its descendants.
function systemOf(bodies, id) {
  const by = new Map(bodies.map((b) => [b.id, b]));
  let root = by.get(id);
  if (!root) return new Set(bodies.map((b) => b.id));
  let guard = 0;
  while (root.parent && by.get(root.parent) && by.get(root.parent).parent && guard++ < 10) root = by.get(root.parent);
  if (!root.parent) return new Set(bodies.map((b) => b.id));   // focus is the Sun: everything is in its system
  const ids = new Set([root.id]);
  let grew = true;
  while (grew) { grew = false; for (const b of bodies) if (!ids.has(b.id) && b.parent && ids.has(b.parent)) { ids.add(b.id); grew = true; } }
  return ids;
}

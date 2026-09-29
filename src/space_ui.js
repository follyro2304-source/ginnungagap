// ============================================================================
//  Spacetime page: state, geometry, UI and per-frame work
// ============================================================================
const SP_RATES = [
  ['Real time', 1], ['1 minute per second', 60], ['10 minutes per second', 600], ['1 hour per second', 3600],
  ['3 hours per second', 10800], ['12 hours per second', 43200], ['1 day per second', 86400], ['1 week per second', 604800],
];
const SP_MAX_SUB = 2400;
const SP_TEX = { earth: '__TEX_EARTH__', lights: '__TEX_LIGHTS__', moonAlb: '__TEX_MOONALB__', moonH: '__TEX_MOONH__' };
const M_EARTH = 5.9722e24;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SP = {
  inited: false, sim: null, epochMs: 0, jd0: 0, playing: true, rateIdx: 4, limited: 0, added: [],
  grid: '2d', depthHold: false, depthExag: 0, heldBase: 0, kmPerPpb: 0,
  view: { clouds: true, lights: true, labels: true, ev: 0.3 },
  cam: { az: 0, el: 0.32, dist: 1.1e8, tAz: 0, tEl: 0.32, tDist: 1.1e8, vAz: 0, vEl: 0, focus: 'earth', trans: null, fpos: [0, 0, 0] },
  clock: null,
  lines: { data: new Float32Array(12 * 32768), n: 0 },
  pred: new Map(), lastPred: -1e9, lastUI: 0, toastTimer: 0, cards: new Map(), labels: new Map(),
  place: { mode: 'real', distKm: 700000 },
  layout: { centerX: 0, centerY: 0 },
};

// ---- helpers ------------------------------------------------------------------
const spBody = (id) => SP.sim.bodies.find((b) => b.id === id) || null;
const spIdx = (id) => SP.sim.bodies.findIndex((b) => b.id === id);
const hexLin = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2)); };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function fmtAcc(a) {
  if (a < 1e-9) return `${sig(a)} m/s²`;
  if (a >= 0.1) return `${sig(a)} m/s²`;
  if (a >= 1e-4) return `${sig(a * 1e3)} mm/s²`;
  if (a >= 1e-7) return `${sig(a * 1e6)} µm/s²`;
  return `${sig(a * 1e9)} nm/s²`;
}
function fmtDur(s) {
  const a = Math.abs(s);
  if (a < 1e-6) return `${sig(s * 1e9)} ns`;
  if (a < 1e-3) return `${sig(s * 1e6)} µs`;
  if (a < 1) return `${sig(s * 1e3)} ms`;
  return `${sig(s)} s`;
}
function fmtSpan(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min ${Math.floor(s % 60)} s`;
}
function fmtKm(km) {
  if (km < 10) return `${sig(km, 3)} km`;
  const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(km)) - 3));
  return `${(Math.round(km / p) * p).toLocaleString('en-US')} km`;
}
function fmtDist(m) { return m < 0.05 * AU_M ? fmtKm(m / 1000) : `${sig(m / AU_M, 4)} AU`; }
function fmtPeriod(s) {
  if (!isFinite(s)) return 'unbound';
  if (s < 7200) return `${sig(s / 60, 3)} min`;
  if (s < 172800) return `${sig(s / 3600, 3)} h`;
  if (s < 2 * 3.15576e7) return `${sig(s / 86400, 4)} days`;
  return `${sig(s / 3.15576e7, 3)} years`;
}
function spToast(msg) {
  const t = $('spToast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(SP.toastTimer);
  SP.toastTimer = setTimeout(() => { t.hidden = true; }, 5200);
}
function spPrep(b) {
  b.surf = !b.craft && b.R > 5;
  b.Rm = (b.Req || b.R) * 1000;
  b.vs2 = b.rot ? Math.pow((2 * Math.PI * b.Rm) / (Math.abs(b.rot) * 3600), 2) : 0;
  b.lin = hexLin(b.color);
  b.trail = []; b.trailT = -1e18;
  return b;
}

// ---- scene --------------------------------------------------------------------
function spBuild(dateMs) {
  const sc = buildSolarScene(dateMs);
  const s = new NBody();
  s.bodies = sc.bodies.map(spPrep);
  s.sync(true);
  SP.sim = s; SP.jd0 = sc.jd0; SP.epochMs = dateMs;
  assignParents(s.bodies);
  SP.pred.clear();
  const readd = SP.added; SP.added = [];
  readd.forEach((r) => spAdd(r.entry, r.mode, r.distKm, true));
  spClockReset();
}
function spJD() { return SP.jd0 + SP.sim.t / DAY; }

function spAdd(entry, mode, distKm, quiet) {
  const s = SP.sim, B = s.bodies;
  if (B.find((b) => b.id === entry.id)) return;
  if (B.length >= MAXB) { spToast(`Up to ${MAXB} bodies can be simulated at once. Remove one to add ${entry.name}.`); return; }
  s.sync(false);
  const earth = spBody('earth'), moon = spBody('moon');
  const GMb = entry.GM ?? entry.m * G_NEWTON;
  let x, v, msg = '';
  if (entry.orbit) {
    const host = spBody(entry.orbit.around) || earth;
    if (!host) { spToast(`${entry.name} needs ${entry.orbit.around === 'moon' ? 'the Moon' : 'Earth'} to orbit.`); return; }
    const a = (host.Req || host.R) * 1000 + entry.orbit.alt * 1000;
    let pole, ref;
    if (host.id === 'earth') { pole = eclToWorld(equToEcl([0, 0, 1])); ref = eclToWorld(equToEcl([1, 0, 0])); }
    else if (host.id === 'moon' && earth) { pole = v3.norm(v3.cross(v3.sub(host.x, earth.x), v3.sub(host.v, earth.v))); ref = v3.norm(v3.sub(earth.x, host.x)); }
    else { pole = [0, 1, 0]; ref = [1, 0, 0]; }
    const q = v3.cross(pole, ref);
    const raan = Math.random() * 2 * Math.PI, nu = Math.random() * 2 * Math.PI, inc = rad(entry.orbit.inc);
    const node = v3.add(v3.mul(ref, Math.cos(raan)), v3.mul(q, Math.sin(raan)));
    const w = v3.add(v3.mul(v3.cross(pole, node), Math.cos(inc)), v3.mul(pole, Math.sin(inc)));
    const e = entry.orbit.ecc || 0, r = a * (1 - e), sp = Math.sqrt((host.GM * (1 + e)) / r);
    const u = v3.add(v3.mul(node, Math.cos(nu)), v3.mul(w, Math.sin(nu)));
    const t = v3.add(v3.mul(node, -Math.sin(nu)), v3.mul(w, Math.cos(nu)));
    x = v3.add(host.x, v3.mul(u, r)); v = v3.add(host.v, v3.mul(t, sp));
    msg = `${entry.name} added in orbit ${sig(entry.orbit.alt, 3)} km above ${host.name === 'Moon' ? 'the Moon' : host.name}.`;
  } else if (mode === 'real' && entry.kepler) {
    const sun = spBody('sun');
    const T = centuriesTT(spJD());
    const pe = eclToWorld(keplerEcl(entry.kepler, T)), ve = eclToWorld(derivEcl((tt) => keplerEcl(entry.kepler, tt), T, 3600));
    x = v3.add(sun ? sun.x : [0, 0, 0], pe); v = v3.add(sun ? sun.v : [0, 0, 0], ve);
    msg = earth ? `${entry.name} added where it is today, ${fmtDist(v3.len(v3.sub(x, earth.x)))} from Earth.` : `${entry.name} added.`;
  } else {
    if (!earth) { spToast('What-if placements need Earth.'); return; }
    const d = Math.max(distKm * 1000, (earth.R + entry.R) * 1000 * 1.5);
    let nrm = [0, 1, 0], uhat = [1, 0, 0];
    if (moon) {
      const rm = v3.sub(moon.x, earth.x), vm = v3.sub(moon.v, earth.v);
      nrm = v3.norm(v3.cross(rm, vm)); uhat = v3.norm(v3.mul(rm, -1));
    }
    const what = v3.cross(nrm, uhat);
    const vrel = Math.sqrt((earth.GM + GMb) / d);
    const fE = GMb / (earth.GM + GMb);
    // Keep the pair's centre of mass moving as Earth did; bodies bound to Earth share Earth's kick.
    const kick = v3.mul(what, -vrel * fE);
    for (const b of B) if (b === earth || b.parent === 'earth') b.v = v3.add(b.v, kick);
    x = v3.add(earth.x, v3.mul(uhat, d)); v = v3.add(earth.v, v3.mul(what, vrel));
    const shift = d * GMb / (earth.GM + GMb);
    msg = `${entry.name} placed ${fmtDist(d)} from Earth. Earth and ${entry.name} now both circle their shared centre of mass, ${fmtDist(shift)} from Earth’s centre. Choose Earth system at the bottom, or switch on Earth’s trajectory, to watch Earth move.`;
  }
  const b = spPrep(makeBody(entry.id, entry, x, v));
  b.added = true;
  B.push(b);
  s.sync(true);
  assignParents(B);
  SP.added.push({ entry, mode, distKm });
  spRebuildUI();
  if (!quiet) spToast(msg);
}
function spRemove(id) {
  const s = SP.sim;
  s.sync(false);
  s.bodies = s.bodies.filter((b) => b.id !== id);
  s.sync(true);
  assignParents(s.bodies);
  SP.added = SP.added.filter((r) => r.entry.id !== id);
  SP.pred.delete(id);
  if (SP.cam.focus === id) spFocus('earth');
  if (SP.clock.a === id || SP.clock.b === id) spClockReset();
  spRebuildUI();
}
function spMerge(i, j) {
  const B = SP.sim.bodies;
  let a = B[i], b = B[j];
  if (a.GM < b.GM) [a, b] = [b, a];
  const ma = a.GM, mb = b.GM, mt = ma + mb;
  a.v = v3.mul(v3.add(v3.mul(a.v, ma), v3.mul(b.v, mb)), 1 / mt);
  if (!b.craft && mb > 1e-6 * ma) {
    a.x = v3.mul(v3.add(v3.mul(a.x, ma), v3.mul(b.x, mb)), 1 / mt);
    a.R = Math.cbrt(a.R ** 3 + b.R ** 3); a.Req = Math.max(a.R, a.Req || 0); a.Rm = a.Req * 1000;
  }
  a.GM = mt; a.m = mt / G_NEWTON;
  spToast(b.craft ? `${b.name} crashed into ${a.name === 'Moon' || a.name === 'Sun' ? 'the ' + a.name : a.name}.` : `${b.name} collided with ${a.name} and merged into it.`);
  const gone = b.id;
  SP.sim.bodies = B.filter((q) => q !== b);
  SP.sim.sync(true);
  assignParents(SP.sim.bodies);
  SP.added = SP.added.filter((r) => r.entry.id !== gone);
  SP.pred.delete(gone);
  if (SP.cam.focus === gone) spFocus(a.id);
  if (SP.clock.a === gone || SP.clock.b === gone) spClockReset();
  spRebuildUI();
}

// ---- clocks ---------------------------------------------------------------------
function spClockReset(a, b) {
  const has = (id) => SP.sim && SP.sim.bodies.some((q) => q.id === id);
  const old = SP.clock || {};
  let A = a || old.a || 'earth', Bc = b || old.b || 'moon';
  if (!has(A)) A = has('earth') ? 'earth' : SP.sim.bodies[1].id;
  if (!has(Bc) || Bc === A) Bc = SP.sim.bodies.find((q) => q.id !== A && q.id !== 'sun')?.id || SP.sim.bodies[0].id;
  SP.clock = { a: A, b: Bc, frame: 'geo', diff: 0, comp: 0, t0: SP.sim ? SP.sim.t : 0, samples: [[0, 0]], sampleDt: 600, nextSample: 600, inst: null };
  spClockFrame();
  if (SP.inited) spSyncClockUI();
}
function spClockFrame() {
  const s = SP.sim, c = SP.clock, e = spBody('earth');
  if (!e) { c.frame = 'bary'; return; }
  const near = (id) => { const b = spBody(id); return b && v3.len(v3.sub(b.x, e.x)) < 1.5e9; };
  c.frame = near(c.a) && near(c.b) ? 'geo' : 'bary';
}
// Fast clock terms from the integrator arrays (see clockTerms in space_sim.js for the model).
function spClockArr(i, frame, ei) {
  const s = SP.sim, X = s.x, V = s.v, M = s.gm, n = s.n, b = s.bodies[i];
  const xi = X[i * 3], yi = X[i * 3 + 1], zi = X[i * 3 + 2];
  let U = 0, vx, vy, vz;
  if (frame === 'geo' && ei >= 0) {
    const xe = X[ei * 3], ye = X[ei * 3 + 1], ze = X[ei * 3 + 2];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = Math.hypot(xi - X[j * 3], yi - X[j * 3 + 1], zi - X[j * 3 + 2]);
      if (j === ei) { U += M[j] / d; continue; }
      const rx = xe - X[j * 3], ry = ye - X[j * 3 + 1], rz = ze - X[j * 3 + 2], dse = Math.hypot(rx, ry, rz);
      U += M[j] / d - M[j] / dse + (M[j] * (rx * (xi - xe) + ry * (yi - ye) + rz * (zi - ze))) / (dse * dse * dse);
    }
    vx = V[i * 3] - V[ei * 3]; vy = V[i * 3 + 1] - V[ei * 3 + 1]; vz = V[i * 3 + 2] - V[ei * 3 + 2];
  } else {
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      U += M[j] / Math.max(1, Math.hypot(xi - X[j * 3], yi - X[j * 3 + 1], zi - X[j * 3 + 2]));
    }
    vx = V[i * 3]; vy = V[i * 3 + 1]; vz = V[i * 3 + 2];
  }
  let v2 = vx * vx + vy * vy + vz * vz;
  if (b.surf) { U += M[i] / b.Rm; v2 += b.vs2; }
  return [U / C2, v2 / (2 * C2)];
}


// ---- trajectory reference: where a body's path is drawn around ---------------------------
// A planet with a heavy companion (over 5% of its mass) is drawn around the pair's shared centre of
// mass, so its own loop shows. Moons are drawn around the centre of mass of their planet's system.
// Spacecraft are drawn around the body they orbit. Everything else is drawn around its parent.
function spMassiveKids(p) {
  return SP.sim.bodies.filter((c) => c.parent === p.id && !c.craft && c.GM > 1e-3 * p.GM);
}
function spRefOf(b) {
  const p = b.parent ? spBody(b.parent) : null;
  if (!p) return null;
  if (b.craft) return { ids: [p.id], period: null };
  if (p.parent) return { ids: [p.id, ...spMassiveKids(p).map((c) => c.id)], period: null };
  const kids = spMassiveKids(b), kidGM = kids.reduce((a, c) => a + c.GM, 0);
  if (kidGM > 0.05 * b.GM) {
    const heavy = kids.reduce((a, c) => (c.GM > a.GM ? c : a));
    const o = orbitOf(heavy, b);
    return { ids: [b.id, ...kids.map((c) => c.id)], period: o.bound ? o.period : 30 * DAY, wobble: true };
  }
  return { ids: [p.id], period: null };
}
function spBary(ids) {
  let M = 0; const x = [0, 0, 0];
  for (const id of ids) { const q = spBody(id); if (!q) continue; M += q.GM; for (let k = 0; k < 3; k++) x[k] += q.GM * q.x[k]; }
  return M > 0 ? v3.mul(x, 1 / M) : [0, 0, 0];
}

// ---- simulation stepping -----------------------------------------------------------
function spChooseDt() {
  const B = SP.sim.bodies;
  let dt = 3600;
  for (const b of B) {
    if (!b.parent) continue;
    const p = spBody(b.parent); if (!p) continue;
    const r = v3.len(v3.sub(b.x, p.x));
    dt = Math.min(dt, 0.018 * Math.sqrt((r * r * r) / (p.GM + b.GM)));
  }
  return Math.max(0.5, dt);
}
function spAdvance(simDt) {
  const s = SP.sim, B = s.bodies;
  let h = spChooseDt(), n = Math.ceil(simDt / h);
  SP.limited = 0;
  if (n > SP_MAX_SUB) { n = SP_MAX_SUB; SP.limited = (n * h) / simDt; } else h = simDt / n;
  const c = SP.clock, ia = spIdx(c.a), ib = spIdx(c.b), ei = spIdx('earth');
  const refs = B.map((b) => spRefOf(b));
  const refIdx = refs.map((r) => (r ? r.ids.map(spIdx).filter((k) => k >= 0) : null));
  const refKey = refs.map((r) => (r ? r.ids.join('+') : ''));
  const trailDt = B.map((b, i) => {
    if (!refs[i]) return Infinity;
    if (refs[i].period) return Math.max(5, refs[i].period / 180);
    const o = orbitOf(b, spBody(b.parent));
    return Math.max(5, (o.bound ? o.period : 30 * DAY) / 180);
  });
  B.forEach((b, i) => { if (b.refKey !== refKey[i]) { b.trail = []; b.refKey = refKey[i]; } });
  for (let k = 0; k < n; k++) {
    s.step(h);
    if (ia >= 0 && ib >= 0) {
      const A = spClockArr(ia, c.frame, ei), Bb = spClockArr(ib, c.frame, ei);
      const y = (A[0] + A[1] - Bb[0] - Bb[1]) * h - c.comp, t = c.diff + y;
      c.comp = t - c.diff - y; c.diff = t;
      if (k === n - 1) c.inst = { A, B: Bb };
      const el = s.t - c.t0;
      if (el >= c.nextSample) {
        c.samples.push([el, c.diff]);
        c.nextSample = el + c.sampleDt;
        if (c.samples.length > 480) { c.samples = c.samples.filter((_, q) => q % 2 === 0); c.sampleDt *= 2; }
      }
    }
    for (let i = 0; i < B.length; i++) {
      const b = B[i], ri = refIdx[i];
      if (!ri || !ri.length || s.t - b.trailT < trailDt[i]) continue;
      b.trailT = s.t;
      const X = s.x, Mg = s.gm;
      let M = 0, rx = 0, ry = 0, rz = 0;
      for (const k of ri) { M += Mg[k]; rx += Mg[k] * X[k * 3]; ry += Mg[k] * X[k * 3 + 1]; rz += Mg[k] * X[k * 3 + 2]; }
      b.trail.push([X[i * 3] - rx / M, X[i * 3 + 1] - ry / M, X[i * 3 + 2] - rz / M]);
      if (b.trail.length > 400) b.trail.shift();
    }
    if (k % 4 === 0 || k === n - 1) {
      const col = s.collisions();
      if (col.length) { s.sync(false); spMerge(col[0][0], col[0][1]); return; }
    }
  }
  s.sync(false);
  const before = B.map((b) => b.parent);
  assignParents(s.bodies);
  s.bodies.forEach((b, i) => { if (b.parent !== before[i]) b.trail = []; });
}

// Predicted path over one orbit: the body's geodesic, integrated forward with the heavy bodies.
function spPredict(b) {
  const B = SP.sim.bodies, p = spBody(b.parent), ref = spRefOf(b);
  if (!p || !ref) return null;
  let dur;
  if (ref.wobble) dur = ref.period;
  else { const o = orbitOf(b, p); dur = o.bound ? Math.min(o.period, 400 * DAY) : 45 * DAY; }
  const keep = new Set([b.id, p.id, ...ref.ids]);
  const include = new Map();
  const fold = new Map();
  for (const q of B) {
    if (keep.has(q.id)) { include.set(q.id, q); continue; }
    if (q.GM < 1e9) continue;
    const qp = spBody(q.parent);
    let fast = false;
    if (qp && q.parent !== null) { const oq = orbitOf(q, qp); fast = oq.bound && oq.period < dur / 12; }
    if (q.parent === b.id || fast) { fold.set(q.id, q.parent); continue; }
    include.set(q.id, q);
  }
  const extra = new Map();
  for (const [id, par] of fold) {
    let cur = par, guard = 0;
    while (cur && !include.has(cur) && guard++ < 8) cur = fold.get(cur) ?? spBody(cur)?.parent;
    if (cur) extra.set(cur, (extra.get(cur) || 0) + spBody(id).GM);
  }
  const list = [...include.values()];
  const sim = new NBody(); sim.gr = false;
  sim.bodies = list.map((q) => ({ x: q.x.slice(), v: q.v.slice(), GM: q.GM + (extra.get(q.id) || 0), R: 1 }));
  sim.sync(true);
  const ib = list.indexOf(b);
  const ri = ref.ids.map((id) => list.findIndex((q) => q.id === id)).filter((k) => k >= 0);
  const steps = 720, dt = dur / steps, pts = [];
  for (let k = 0; k <= steps; k++) {
    if (k % 3 === 0) {
      const X = sim.x, Mg = sim.gm;
      let M = 0, rx = 0, ry = 0, rz = 0;
      for (const j of ri) { M += Mg[j]; rx += Mg[j] * X[j * 3]; ry += Mg[j] * X[j * 3 + 1]; rz += Mg[j] * X[j * 3 + 2]; }
      pts.push([X[ib * 3] - rx / M, X[ib * 3 + 1] - ry / M, X[ib * 3 + 2] - rz / M]);
    }
    if (k < steps) sim.step(dt);
  }
  return { pts, key: ref.ids.join('+') };
}

// ---- camera ------------------------------------------------------------------------
function spFocusPos(id) {
  if (id === 'em') {
    const e = spBody('earth');
    if (e) {
      const root = e.parent && spBody(e.parent) && spBody(e.parent).parent ? spBody(e.parent) : e;   // e.g. Earth captured by a planet
      return spBary([root.id, ...spMassiveKids(root).map((c) => c.id)]);
    }
    id = 'earth';
  }
  const b = spBody(id) || spBody('earth') || SP.sim.bodies[0];
  return b.x;
}
function spMinDist(id) {
  if (id === 'em') return 7e6;
  const b = spBody(id);
  if (!b) return 1e6;
  return b.craft ? 30 : b.R * 1000 * 1.08;
}
function spSuggest(id) {
  if (id === 'em') {
    const e = spBody('earth'); if (!e) return 1.25e9;
    let far = 3.84e8;
    for (const c of SP.sim.bodies) if (c.parent === 'earth' && !c.craft) far = Math.max(far, Math.min(3e9, v3.len(v3.sub(c.x, e.x))));
    return 3.2 * far;
  }
  const b = spBody(id); if (!b) return 1e8;
  if (id === 'earth') return 3.4e7;
  if (id === 'moon') return 1.1e7;
  if (id === 'sun') return b.R * 1000 * 7;
  if (b.craft) {
    const p = spBody(b.parent);
    const alt = p ? v3.len(v3.sub(b.x, p.x)) - p.R * 1000 : 1e6;
    return Math.max(4e5, Math.min(4e7, alt * 2.2));
  }
  return b.R * 1000 * 4.5;
}
function spFocus(id, keepDist) {
  const c = SP.cam;
  if (!SP.sim.bodies.some((b) => b.id === id) && id !== 'em') id = 'earth';
  const target = spFocusPos(id);
  c.trans = { offset: v3.sub(c.fpos, target), t0: performance.now() };
  c.focus = id;
  if (!keepDist) {
    c.tDist = spSuggest(id);
    const b = spBody(id), sun = spBody('sun');
    if (b && sun && b !== sun && id !== 'earth') {        // look at the sunlit side
      const d = v3.sub(sun.x, b.x);
      let az = Math.atan2(d[0], d[2]) + 0.65;
      az += Math.round((c.tAz - az) / (2 * Math.PI)) * 2 * Math.PI;
      c.tAz = az; c.tEl = 0.22; c.vAz = 0; c.vEl = 0;
    }
  }
  document.querySelectorAll('#spFocusSeg [data-v]').forEach((btn) => btn.setAttribute('aria-checked', btn.dataset.v === id ? 'true' : 'false'));
}
function spDefaultCam() {
  const c = SP.cam, e = spBody('earth'), m = spBody('moon');
  c.focus = 'earth';
  const portrait = innerHeight > innerWidth * 1.2;
  if (e && m) {
    const rm = v3.sub(m.x, e.x);
    const moonAz = Math.atan2(rm[0], rm[2]);
    c.tAz = c.az = moonAz + Math.PI - (portrait ? 0.22 : 0.36);
  }
  c.tEl = c.el = 0.3;
  c.tDist = c.dist = 1.15e8;
  c.fpos = spFocusPos('earth').slice(); c.trans = null;
}
function spCamUpdate(dt) {
  const c = SP.cam;
  if (!pointers.size) {
    c.tAz += c.vAz * dt; c.tEl = Math.max(-1.5, Math.min(1.5, c.tEl + c.vEl * dt));
    const damp = Math.exp(-dt * 5); c.vAz *= damp; c.vEl *= damp;
  }
  c.tDist = Math.max(spMinDist(c.focus), Math.min(3e13, c.tDist));
  const f = 1 - Math.exp(-dt * 10);
  c.az += (c.tAz - c.az) * f; c.el += (c.tEl - c.el) * f;
  c.dist = Math.exp(Math.log(c.dist) + (Math.log(c.tDist) - Math.log(c.dist)) * f);
  const target = spFocusPos(c.focus);
  if (c.trans) {
    const k = Math.min(1, (performance.now() - c.trans.t0) / 1100), e = k * k * (3 - 2 * k);
    c.fpos = v3.add(target, v3.mul(c.trans.offset, 1 - e));
    if (k >= 1) c.trans = null;
  } else c.fpos = target.slice();
}

// ---- geometry: line buffer --------------------------------------------------------------
function lnReset() { SP.lines.n = 0; }
function lnSeg(cam, a, b, aa, ba, col, w) {
  const L = SP.lines;
  if (L.n * 12 + 12 > L.data.length) {
    if (L.data.length >= 12 * 400000) return;
    const d = new Float32Array(L.data.length * 2); d.set(L.data); L.data = d;
  }
  const o = L.n * 12, D = L.data;
  D[o] = (a[0] - cam[0]) / 1000; D[o + 1] = (a[1] - cam[1]) / 1000; D[o + 2] = (a[2] - cam[2]) / 1000; D[o + 3] = aa;
  D[o + 4] = (b[0] - cam[0]) / 1000; D[o + 5] = (b[1] - cam[1]) / 1000; D[o + 6] = (b[2] - cam[2]) / 1000; D[o + 7] = ba;
  D[o + 8] = col[0]; D[o + 9] = col[1]; D[o + 10] = col[2]; D[o + 11] = w;
  L.n++;
}
const GRID_COL = [0.40, 0.55, 0.98];

// Automatic depth scale: probe the potential across the sheet (centre, rings, and every body that
// lies over it) and fit the largest |U| to 30% of the camera distance. Smoothed so it never pumps.
function spGridScale(P, F, E, camDist, dt) {
  // Only differences in potential are physical, so depth is measured from the sheet's shallowest
  // point on its rim: the rim stays level with the bodies at any scale.
  let umax = P.U(F), rim = Infinity;
  for (const rr of [0.35, 0.7, 1.0]) for (let k = 0; k < 16; k++) {
    const a = (k / 16) * 2 * Math.PI;
    const v = P.U([F[0] + rr * E * Math.cos(a), F[1], F[2] + rr * E * Math.sin(a)]);
    umax = Math.max(umax, v);
    if (rr === 1.0) rim = Math.min(rim, v);
  }
  for (const T of P.terms) {
    const dx = T.x[0] - F[0], dz = T.x[2] - F[2];
    if (Math.hypot(dx, dz) < E) umax = Math.max(umax, P.U([T.x[0], F[1], T.x[2]]));
  }
  SP.uRef = rim;
  const ppb = (Math.max(umax - rim, 1e-30) / C2) * 1e9;
  const target = ppb > 0 ? (0.3 * camDist / 1000) / ppb : 1e4;
  const prev = SP.kmPerPpbAuto;
  const k = prev && dt < 0.5 ? 1 - Math.exp(-dt * 6) : 1;
  SP.kmPerPpbAuto = prev && k < 1 ? Math.exp(Math.log(prev) + (Math.log(target) - Math.log(prev)) * k) : target;
  const base = SP.depthHold && SP.heldBase > 0 ? SP.heldBase : SP.kmPerPpbAuto;
  return base * Math.pow(10, SP.depthExag);
}
function spStepAlong(p, loc, cap) {
  let h = cap;
  for (const L of loc) {
    const d = Math.hypot(p[0] - L.x[0], p[1] - L.x[1], p[2] - L.x[2]);
    h = Math.min(h, Math.max(0.12 * d, 0.07 * Math.sqrt(L.R2 + L.e2)));
  }
  return h;
}
function spGridExtent(camDist) {
  let E = 2.2 * camDist;
  const e = spBody('earth'), m = spBody('moon'), f = SP.cam.focus;
  if (e && m && (f === 'earth' || f === 'em')) {
    const dm = v3.len(v3.sub(m.x, e.x));
    E += smooth(0.08, 0.2, camDist / dm) * Math.max(0, 1.3 * dm - E);
  }
  let fb = spBody(f === 'em' ? 'earth' : f);
  if (fb && fb.craft) { const p = spBody(fb.parent); if (p) return Math.max(E, 3.2 * p.R * 1000); }
  return Math.max(E, 5 * (fb && !fb.craft ? fb.R * 1000 : 2e6));
}
function spGrid(camPos, camDist, dt) {
  let F = SP.cam.fpos.slice();
  // Spacecraft are too light to have a well of their own: anchor the sheet at the body they orbit.
  const fc = spBody(SP.cam.focus);
  if (fc && fc.craft && fc.parent) { const p = spBody(fc.parent); if (p) F = v3.add(F, v3.sub(p.x, fc.x)); }
  const E = spGridExtent(camDist);
  const nL = 20, s = E / nL;
  const sys = systemOf(SP.sim.bodies, SP.cam.focus === 'em' ? 'earth' : SP.cam.focus);
  const P = makePotential(SP.sim.bodies, F, 0.4 * s, sys);
  const near = P.terms.filter((T) => Math.hypot(T.x[0] - F[0], T.x[1] - F[1], T.x[2] - F[2]) < 2 * E);
  const kmPerPpb = spGridScale(P, F, E, camDist, dt);
  SP.kmPerPpb = kmPerPpb;
  const kDepth = kmPerPpb * 1000 * 1e9;           // metres of depth per unit of U/c²
  // A manual scale can ask for depths far beyond the view; ease those off smoothly instead of exploding.
  const cap = 40 * Math.max(E, camDist);
  const depthOf = (Uv) => { const d = (kDepth * (Uv - SP.uRef)) / C2; return Math.abs(d) < 0.5 * cap ? d : cap * Math.tanh(d / cap); };
  const camFade = (q) => smooth(0.03, 0.2, Math.hypot(q[0] - camPos[0], q[1] - camPos[1], q[2] - camPos[2]) / camDist);
  const sheetY = (x, z) => F[1] - depthOf(P.U([x, F[1], z]));
  const width = 1.1;
  if (SP.grid === '2d') {
    for (let axis = 0; axis < 2; axis++) for (let i = -nL; i <= nL; i++) {
      const vv = i * s;
      let u = -E, prev = null, pa = 0;
      while (u <= E * 1.0001) {
        const px = axis === 0 ? u : vv, pz = axis === 0 ? vv : u;
        const p = [F[0] + px, F[1], F[2] + pz];
        const q = [p[0], F[1] - depthOf(P.U(p)), p[2]];
        const rr = Math.hypot(px, pz) / E;
        const a = (i === 0 ? 0.42 : 0.3) * (1 - smooth(0.45, 1.0, rr)) * camFade(q);
        if (prev && (a > 0.004 || pa > 0.004)) lnSeg(camPos, prev, q, pa, a, GRID_COL, width);
        prev = q; pa = a;
        u += spStepAlong(p, near, s / 3);
      }
    }
    // Stalks from each nearby body down to its dimple in the sheet
    for (const b of SP.sim.bodies) {
      const dx = b.x[0] - F[0], dz = b.x[2] - F[2];
      if (Math.hypot(dx, dz) > E * 0.9 || b.id === 'sun') continue;
      const q = [b.x[0], sheetY(b.x[0], b.x[2]), b.x[2]];
      const down = v3.sub(q, b.x), dl = v3.len(down);
      if (dl < b.R * 1000 * 1.05) continue;
      const start = v3.add(b.x, v3.mul(down, (b.R * 1000) / dl));
      lnSeg(camPos, start, q, 0.45 * camFade(start), 0.1, b.lin, 1.0);
    }
  } else if (SP.grid === '3d') {
    const E3 = Math.min(E * 0.6, 0.8 * camDist), nH = 4, nV = 2, s3 = E3 / nH;
    const P3 = makePotential(SP.sim.bodies, F, 0.4 * s3, new Set(SP.sim.bodies.map((q) => q.id)));
    const pullers = P3.terms.filter((T) => Math.hypot(T.x[0] - F[0], T.x[1] - F[1], T.x[2] - F[2]) < 1.5 * E3);
    const k3 = 2.5 * kDepth;
    const disp = (p) => {
      const out = p.slice();
      for (const L of pullers) {
        const dx = L.x[0] - p[0], dy = L.x[1] - p[1], dz = L.x[2] - p[2];
        const r = Math.hypot(dx, dy, dz);
        if (r < 1) continue;
        const m = Math.tanh((k3 * P3.Uone(L, p)) / C2 / r) * 0.88;
        out[0] += dx * m; out[1] += dy * m; out[2] += dz * m;
      }
      return out;
    };
    const line = (fix, ax, lo, hi) => {
      let u = lo, prev = null, pa = 0;
      while (u <= hi * 1.0001) {
        const p = fix.slice(); p[ax] += u;
        const q = disp(p);
        const rr = Math.hypot(p[0] - F[0], (p[1] - F[1]) * 1.6, p[2] - F[2]) / (E3 * 1.15);
        const a = 0.22 * (1 - smooth(0.4, 1.0, rr)) * camFade(q);
        if (prev && (a > 0.004 || pa > 0.004)) lnSeg(camPos, prev, q, pa, a, GRID_COL, 1.0);
        prev = q; pa = a;
        u += spStepAlong(p, pullers, s3 / 5);
      }
    };
    for (let j = -nV; j <= nV; j++) for (let k = -nH; k <= nH; k++) {
      line([F[0], F[1] + j * s3, F[2] + k * s3], 0, -E3, E3);
      line([F[0] + k * s3, F[1] + j * s3, F[2]], 2, -E3, E3);
    }
    for (let i = -nH; i <= nH; i++) for (let k = -nH; k <= nH; k++) line([F[0] + i * s3, F[1], F[2] + k * s3], 1, -nV * s3, nV * s3);
  }
  return { F, P, kDepth, sheetY, E };
}

function spTrajectories(camPos, camDist, g) {
  const now = performance.now();
  const B = SP.sim.bodies;
  if (now - SP.lastPred > 350) {
    SP.lastPred = now;
    for (const b of B) if (b.showTraj) { const r = spPredict(b); if (r) SP.pred.set(b.id, r); else SP.pred.delete(b.id); }
  }
  const drawnBary = new Set();
  for (const b of B) {
    if (!b.showTraj) continue;
    const ref = spRefOf(b);
    if (!ref) continue;
    const base = spBary(ref.ids), col = b.lin;
    if (ref.ids.length > 1) {
      const key = ref.ids.join('+');
      if (!drawnBary.has(key)) {
        drawnBary.add(key);
        const r = 0.012 * camDist, W = [1, 0.93, 0.8];
        for (const ax of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) lnSeg(camPos, v3.add(base, v3.mul(ax, -r)), v3.add(base, v3.mul(ax, r)), 0.85, 0.85, W, 1.4);
      }
    }
    const onSheet = SP.grid === '2d' && g;
    const n = b.trail.length;
    let prev = null, prevS = null;
    for (let k = 0; k < n; k++) {
      const q = v3.add(base, b.trail[k]);
      const a = 0.12 + 0.78 * (k / Math.max(1, n - 1));
      if (prev) lnSeg(camPos, prev, q, a, a, col, 1.7);
      prev = q;
      if (onSheet) { const s = [q[0], g.sheetY(q[0], q[2]), q[2]]; if (prevS) lnSeg(camPos, prevS, s, a * 0.16, a * 0.16, col, 1.1); prevS = s; }
    }
    if (prev) lnSeg(camPos, prev, b.x, 0.9, 0.9, col, 1.7);
    const pr = SP.pred.get(b.id);
    if (pr && pr.key === ref.ids.join('+')) {
      let pp = b.x;
      for (let k = 1; k < pr.pts.length; k++) {
        const q = v3.add(base, pr.pts[k]);
        if (k % 2 === 1) lnSeg(camPos, pp, q, 0.5, 0.5, col, 1.3);
        pp = q;
      }
    }
  }
}

// ---- per-frame uniforms -------------------------------------------------------------------
function spSkyMat() {
  const { gx, gy, gz } = renderer.gal;
  const M = (w) => {
    const q = eclToEqu([w[0], -w[2], w[1]]);
    const g = EQ2GAL.map((r) => r[0] * q[0] + r[1] * q[1] + r[2] * q[2]);
    return [0, 1, 2].map((k) => g[0] * gx[k] + g[1] * gy[k] + g[2] * gz[k]);
  };
  return new Float32Array([...M([1, 0, 0]), ...M([0, 1, 0]), ...M([0, 0, 1])]);
}
const SPU = {
  B: new Float32Array(4 * MAXB), BC0: new Float32Array(4 * MAXB), BC1: new Float32Array(4 * MAXB),
  BP: new Float32Array(4 * MAXB), BP2: new Float32Array(4 * MAXB), BRot: new Float32Array(9 * MAXB), skyMat: null,
};
function spPhaseLambert(a) { return (Math.sin(a) + (Math.PI - a) * Math.cos(a)) / Math.PI; }
function spUniforms(camPos, pixAng) {
  const B = SP.sim.bodies, n = Math.min(B.length, MAXB), jd = spJD();
  const sun = spBody('sun'), earth = spBody('earth'), moon = spBody('moon');
  const sunX = sun ? sun.x : [0, 0, 0];
  let earthIdx = -1, moonIdx = -1;
  for (let i = 0; i < n; i++) {
    const b = B[i], o4 = i * 4, o9 = i * 9;
    if (b.id === 'earth') earthIdx = i;
    if (b.id === 'moon') moonIdx = i;
    const rel = v3.sub(b.x, camPos);
    SPU.B.set([rel[0] / 1000, rel[1] / 1000, rel[2] / 1000, b.R], o4);
    const ak = b.style >= 3 ? 0.62 : 1;
    SPU.BC0.set([b.c0[0] * ak, b.c0[1] * ak, b.c0[2] * ak, b.style], o4);
    const dSun = Math.max(1e3, v3.len(v3.sub(b.x, sunX)));
    const irr = b.id === 'sun' ? 1 : Math.pow(AU_M / dSun, 2);
    // Orientation (world -> body frame, column-major)
    let cols;
    if (b.id === 'earth') cols = earthMatrix(jd);
    else if (b.id === 'moon' && earth) {
      const xb = v3.norm(v3.sub(earth.x, b.x));
      let zb = v3.cross(v3.sub(b.x, earth.x), v3.sub(b.v, earth.v));
      zb = v3.norm(v3.sub(zb, v3.mul(xb, v3.dot(zb, xb))));
      cols = [xb, v3.cross(zb, xb), zb];
    } else cols = spinMatrix(b.obl, b.spin0 + (b.rot ? (2 * Math.PI * SP.sim.t) / (b.rot * 3600) : 0), b.pole);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) SPU.BRot[o9 + c * 3 + r] = cols[r][c];
    // Point-source brightness for bodies smaller than a pixel (and all spacecraft)
    const dist = v3.len(rel), ang = (b.R * 1000) / dist;
    let flux = 0, pcol = b.lin;
    if (b.craft || ang < 0.6 * pixAng) {
      if (b.id === 'sun') flux = 40;
      else {
        const toS = v3.norm(v3.sub(sunX, b.x)), toC = v3.norm(v3.mul(rel, -1));
        const alpha = Math.acos(Math.max(-1, Math.min(1, v3.dot(toS, toC))));
        const alb = b.craft ? 0.5 : b.id === 'earth' ? 0.37 : b.id === 'moon' ? 0.12 : 0.4;
        const R = b.craft ? 25 : b.R * 1000;
        let lit = 1;
        for (const o of B) {
          if (o === b || o.craft || o.id === 'sun') continue;
          const ob = v3.sub(o.x, b.x), t = v3.dot(ob, toS);
          if (t > 0 && v3.len(v3.sub(ob, v3.mul(toS, t))) < o.R * 1000) { lit = 0.02; break; }
        }
        const m = -26.74 - 2.5 * Math.log10(Math.max(1e-40, alb * Math.pow(R / dist, 2) * irr * spPhaseLambert(alpha) * lit));
        flux = Math.min(40, 3 * Math.pow(10, -0.27 * (m + 1)));
        if (b.craft) flux = Math.max(flux, 0.35 * lit);
      }
      pcol = b.craft ? [1, 1, 1] : b.lin.map((v) => v / Math.max(0.2, (b.lin[0] + b.lin[1] + b.lin[2]) / 3));
    }
    SPU.BC1.set([b.craft ? 1 : b.c1[0] * ak, b.craft ? 1 : b.c1[1] * ak, b.craft ? 1 : b.c1[2] * ak, b.seed], o4);
    if (flux > 0) SPU.BC1.set([pcol[0], pcol[1], pcol[2], b.seed], o4);
    SPU.BP.set([b.rings ? b.rings[0] : 0, b.rings ? b.rings[1] : 0, flux, b.caps || 0], o4);
    SPU.BP2.set([b.bands || 0, b.id === 'sun' ? 1 : irr * (SP.autoEx || 1), 0, 0], o4);
  }
  let earthPhase = 0;
  if (earth && moon) {
    const a = v3.norm(v3.sub(sunX, earth.x)), m = v3.norm(v3.sub(moon.x, earth.x));
    earthPhase = (1 + v3.dot(a, m)) / 2;
  }
  if (!SPU.skyMat) SPU.skyMat = spSkyMat();
  const sunRel = v3.sub(sunX, camPos);
  return { n, earth: earthIdx, moon: moonIdx, earthPhase, sunPos: [sunRel[0] / 1000, sunRel[1] / 1000, sunRel[2] / 1000], sunR: sun ? sun.R : 695700 };
}

function spAutoExposure(dt) {
  const f = spBody(SP.cam.focus === 'em' ? 'earth' : SP.cam.focus), s = spBody('sun');
  let target = 1;
  if (f && s && f !== s) target = Math.min(900, Math.max(1, Math.pow(v3.len(v3.sub(f.x, s.x)) / AU_M, 2)));
  const k = 1 - Math.exp(-dt * 3);
  SP.autoEx = Math.exp(Math.log(SP.autoEx || 1) + (Math.log(target) - Math.log(SP.autoEx || 1)) * k);
  return SP.autoEx;
}

// ---- labels -------------------------------------------------------------------------
function spProject(p, V, cssW, cssH) {
  const r = v3.sub(p, V.camPos);
  const z = v3.dot(r, V.fwd);
  if (z <= 0) return null;
  const md = Math.min(cssW, cssH);
  const ux = v3.dot(r, V.right) / z / (2 * V.tanHalf) + V.center[0], uy = v3.dot(r, V.up) / z / (2 * V.tanHalf) + V.center[1];
  return { x: cssW / 2 + ux * md, y: cssH / 2 - uy * md, z, scale: md / (2 * V.tanHalf * z) };
}
function spLabels(V, cssW, cssH) {
  const layer = $('spLabels');
  const on = SP.view.labels;
  const B = SP.sim.bodies;
  const placed = [];
  const order = B.map((b, i) => i).sort((a, b) => (B[b].id === SP.cam.focus) - (B[a].id === SP.cam.focus) || B[b].GM - B[a].GM);
  for (const i of order) {
    const b = B[i];
    let el = SP.labels.get(b.id);
    if (!el) continue;
    const pr = on ? spProject(b.x, V, cssW, cssH) : null;
    let show = !!pr && pr.x > -40 && pr.x < cssW + 40 && pr.y > -20 && pr.y < cssH + 20;
    if (show) {
      const dir = v3.sub(b.x, V.camPos), dl = v3.len(dir), d = v3.mul(dir, 1 / dl);
      for (const o of B) {
        if (o === b || o.craft) continue;
        const oc = v3.sub(o.x, V.camPos), t = v3.dot(oc, d);
        if (t > 0 && t < dl - b.R * 1000 && v3.len(v3.sub(oc, v3.mul(d, t))) < o.R * 1000) { show = false; break; }
      }
    }
    if (show) {
      const rpx = b.R * 1000 * pr.scale;
      const off = rpx * 0.72 + 7;
      const x = pr.x + off, y = pr.y - off;
      if (placed.some((q) => Math.abs(q[0] - x) < 70 && Math.abs(q[1] - y) < 16)) show = false;
      else {
        placed.push([x, y]);
        el.style.transform = `translate(${x.toFixed(1)}px, ${(y - 10).toFixed(1)}px)`;
        el.classList.toggle('tiny', rpx < 3);
        el.style.setProperty('--off', `${off.toFixed(1)}px`);
      }
    }
    if (el.hidden === show) el.hidden = !show;
  }
  layer.hidden = !on;
}

// ---- sidebar UI ------------------------------------------------------------------------
function spKindLine(b) {
  const p = b.parent ? spBody(b.parent) : null;
  const pn = p ? (p.id === 'sun' || p.id === 'moon' ? `the ${p.name}` : p.name) : '';
  if (b.id === 'sun') return 'Star at the centre of the Solar System';
  if (b.craft) return p ? `${b.kind}, orbiting ${pn}` : b.kind;
  return p ? `${b.kind}, orbiting ${pn}` : b.kind;
}
function spCardHTML(b) {
  const id = b.id;
  const rows = [];
  const row = (k, key, extra = '') => `<div class="ro"><span class="k">${k}</span><span class="v" data-k="${key}"></span>${extra}</div>`;
  if (id === 'moon') rows.push(row('Phase', 'phase'));
  rows.push(`<div class="ro"><span class="k">Mass</span><span class="v"><span data-k="mass"></span><span class="alt" data-k="massalt"></span></span></div>`);
  rows.push(row(b.craft ? 'Size' : 'Radius', 'radius'));
  if (!b.craft) { rows.push(row('Surface gravity', 'g')); rows.push(row('Escape velocity', 'vesc')); }
  return `<article class="sp-card" data-id="${id}" style="--bc:${b.color}">
    <header class="sp-card-head">
      <span class="sp-swatch" aria-hidden="true"></span>
      <div class="sp-card-title"><h3>${b.name}</h3><p class="sp-kind" data-k="kind"></p></div>
      <button class="chip sp-mini" data-act="focus">Focus</button>
    </header>
    <div class="tg sp-traj"><div><span class="k" id="spTrajL-${id}">Trajectory</span><span class="d">Its path through curved spacetime: the trail behind it and one orbit ahead.</span></div><button class="sw" role="switch" data-act="traj" aria-labelledby="spTrajL-${id}"></button></div>
    ${rows.join('')}
    <div class="sp-pull">
      <div class="sp-pull-head"><span class="k">Gravity acting on it</span><span class="v" data-k="force"></span></div>
      <div class="sp-bars" data-k="bars"></div>
    </div>
    <div class="ro stack" data-show="bary" hidden><span class="k">Shared centre of mass</span><span class="v" data-k="bary"></span></div>
    <div class="ro stack" data-show="orbit"><span class="k" data-k="orbk">Orbit</span><span class="v" data-k="orbit"></span></div>
    <div class="ro"><span class="k">Clock rate</span><span class="v" data-k="clock"></span><span class="f" data-k="clockf"></span></div>
    <div class="ro"><span class="k">Schwarzschild radius</span><span class="v" data-k="rs"></span><span class="f">The size it would need to be squeezed to in order to become a black hole, 2GM/c².</span></div>
    ${b.added ? '<button class="btn sp-remove" data-act="remove">Remove ' + b.name + '</button>' : ''}
  </article>`;
}
function spRebuildUI() {
  if (!SP.inited) return;
  const wrap = $('spCards');
  const B = SP.sim.bodies;
  const order = ['earth', 'moon'];
  const sorted = [...B].sort((a, b) => {
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    if (a.id === 'sun') return 1; if (b.id === 'sun') return -1;
    return 0;
  });
  wrap.innerHTML = sorted.map(spCardHTML).join('');
  SP.cards.clear();
  wrap.querySelectorAll('.sp-card').forEach((card) => {
    const id = card.dataset.id, b = spBody(id);
    const refs = {};
    card.querySelectorAll('[data-k]').forEach((el) => { refs[el.dataset.k] = el; });
    SP.cards.set(id, { card, refs });
    const sw = card.querySelector('[data-act=traj]');
    bindSwitch(sw, () => spBody(id)?.showTraj, (v) => { const q = spBody(id); if (q) { q.showTraj = v; SP.lastPred = -1e9; } });
    card.querySelector('[data-act=focus]').addEventListener('click', () => spFocus(id));
    const rm = card.querySelector('[data-act=remove]');
    if (rm) rm.addEventListener('click', () => { spRemove(id); spToast(`${b.name} removed.`); });
  });
  // Labels
  const layer = $('spLabels');
  layer.innerHTML = '';
  SP.labels.clear();
  for (const b of B) {
    const el = document.createElement('button');
    el.className = 'sp-label'; el.hidden = true;
    el.style.setProperty('--bc', b.color);
    el.innerHTML = `<span class="sp-ring" aria-hidden="true"></span><span>${b.name}</span>`;
    el.setAttribute('aria-label', `Focus on ${b.name}`);
    el.addEventListener('click', () => spFocus(b.id));
    layer.appendChild(el);
    SP.labels.set(b.id, el);
  }
  spSyncCatalog();
  spSyncClockUI();
  spUpdateCards();
}
function spMoonPhase() {
  const s = spBody('sun'), e = spBody('earth'), m = spBody('moon');
  if (!s || !e || !m) return '';
  const toS = v3.norm(v3.sub(s.x, m.x)), toE = v3.norm(v3.sub(e.x, m.x));
  const k = (1 + v3.dot(toS, toE)) / 2;
  const se = v3.sub(s.x, e.x), me = v3.sub(m.x, e.x);
  const waxing = v3.cross(se, me)[1] > 0;
  let name;
  if (k < 0.03) name = 'New Moon';
  else if (k > 0.97) name = 'Full Moon';
  else if (Math.abs(k - 0.5) < 0.04) name = waxing ? 'First quarter' : 'Last quarter';
  else name = `${waxing ? 'Waxing' : 'Waning'} ${k < 0.5 ? 'crescent' : 'gibbous'}`;
  return `${name}, ${Math.round(k * 100)}% lit`;
}
function spUpdateCards() {
  const B = SP.sim.bodies, frame = 'bary';
  for (const [id, { refs }] of SP.cards) {
    const i = spIdx(id); if (i < 0) continue;
    const b = B[i];
    const set = (k, t) => { const el = refs[k]; if (el && el.textContent !== t) el.textContent = t; };
    set('kind', spKindLine(b));
    if (refs.phase) set('phase', spMoonPhase());
    set('mass', `${sig(b.m, 4)} kg`);
    if (refs.mass) { const alt = b.craft || b.id === 'earth' ? '' : `${sig(b.m / M_EARTH, 3)} Earth masses`; set('massalt', alt); }
    set('radius', b.craft ? `about ${sig(b.R * 2000, 2)} m across` : `${sig(b.R, 5)} km`);
    if (!b.craft) {
      const R = b.R * 1000;
      set('g', `${sig(b.GM / (R * R), 3)} m/s²`);
      set('vesc', `${sig(Math.sqrt((2 * b.GM) / R) / 1000, 3)} km/s`);
    }
    // Gravity from every other body
    const parts = [];
    let ax = 0, ay = 0, az = 0;
    for (const o of B) {
      if (o === b) continue;
      const d = v3.sub(o.x, b.x), r = v3.len(d), a = o.GM / (r * r);
      ax += (a * d[0]) / r; ay += (a * d[1]) / r; az += (a * d[2]) / r;
      parts.push({ o, a });
    }
    parts.sort((p, q) => q.a - p.a);
    const net = Math.hypot(ax, ay, az);
    set('force', `${sig(b.m * net, 3)} N`);
    if (refs.bars) {
      const top = parts.slice(0, 3), amax = top.length ? top[0].a : 1;
      const html = top.map((p) => `<div class="sp-bar" style="--bc:${p.o.color}"><span class="sp-bar-n">${p.o.id === 'sun' || p.o.id === 'moon' ? 'the ' + p.o.name : p.o.name}</span><span class="sp-bar-t"><i style="width:${Math.max(1.5, (100 * p.a) / amax).toFixed(1)}%"></i></span><span class="sp-bar-v">${fmtAcc(p.a)}</span></div>`).join('')
        + `<p class="sp-bar-net">Net pull ${fmtAcc(net)}, all sources combined</p>`;
      if (refs.bars._h !== html) { refs.bars.innerHTML = html; refs.bars._h = html; }
    }
    // Shared centre of mass with its companions
    if (refs.bary) {
      const brow = refs.bary.parentElement;
      let ids = null;
      if (!b.craft && b.parent) {
        const par = spBody(b.parent);
        const kids = spMassiveKids(b);
        if (kids.length) ids = [b.id, ...kids.map((c) => c.id)];
        else if (par && par.parent) ids = [par.id, ...spMassiveKids(par).map((c) => c.id)];
      }
      if (ids && ids.length > 1) {
        const d = v3.len(v3.sub(b.x, spBary(ids)));
        const names = ids.map((id) => spBody(id)?.name).filter(Boolean);
        const list = names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
        set('bary', `${fmtDist(d)} from its centre${d < b.R * 1000 ? ', inside the body itself' : ''}. ${list} all circle this point; switch on the trajectory to see ${b.name === 'Moon' ? 'the Moon' : b.name}’s loop.`);
        brow.hidden = false;
      } else brow.hidden = true;
    }
    // Orbit around its parent
    const p = b.parent ? spBody(b.parent) : null;
    const orow = refs.orbit ? refs.orbit.parentElement : null;
    if (p && orow) {
      orow.hidden = false;
      const o = orbitOf(b, p);
      const pn = p.id === 'sun' || p.id === 'moon' ? `the ${p.name}` : p.name;
      set('orbk', `Orbit around ${pn}`);
      const alt = b.craft ? `, ${sig((o.r - (p.Req || p.R) * 1000) / 1000, 4)} km up` : '';
      set('orbit', o.bound ? `${fmtDist(o.r)}${alt}, ${sig(o.v / 1000, 4)} km/s, once every ${fmtPeriod(o.period)}` : `escaping at ${sig(o.v / 1000, 3)} km/s`);
    } else if (orow) orow.hidden = true;
    // Clock compared with a clock at rest far outside the Solar System
    const ei = spIdx('earth');
    const [g, k] = spClockArr(i, frame, ei);
    const tot = g + k;
    set('clock', `${sig(tot * 1e9, 3)} ppb slow`);
    set('clockf', `${b.surf ? 'On its surface' : 'On board'}, a clock loses ${fmtDur(tot * 86400)} per day against one far from the Sun: ${Math.round((g / tot) * 100)}% from gravity, ${Math.round((k / tot) * 100)}% from speed.`);
    set('rs', fmtLen((2 * b.GM) / C2));
  }
}
function spSyncCatalog() {
  const have = new Set(SP.sim.bodies.map((b) => b.id));
  document.querySelectorAll('#spCat [data-add]').forEach((btn) => {
    const id = btn.dataset.add, on = have.has(id);
    btn.textContent = on ? 'Remove' : 'Add';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
function spBuildCatalog() {
  const groups = {};
  CATALOG.forEach((c) => (groups[c.group] = groups[c.group] || []).push(c));
  const html = Object.entries(groups).map(([g, items]) => {
    const extra = g === 'Planets' ? '<p class="hint">Planets can appear where they are today, or next to Earth to show what their gravity would do there.</p>'
      : g === 'Moons of other planets' ? '<p class="hint">These are placed next to Earth, at the distance chosen below.</p>' : '<p class="hint">Real orbits, with a random starting point along the orbit.</p>';
    return `<section class="sp-cat-g"><h3>${g}</h3>${extra}${items.map((c) => {
      const sub = c.orbit ? `${sig(c.orbit.alt, 3)} km up, ${sig(c.m / 1000, 3)} t` : `${sig((c.GM ?? 0) / G_NEWTON / M_EARTH, 3)} Earth masses, radius ${sig(c.R, 4)} km`;
      return `<div class="sp-item" style="--bc:${c.color}"><span class="sp-swatch" aria-hidden="true"></span><div class="sp-item-t"><span class="nm">${c.name}</span><span class="d">${sub}</span></div><button class="chip sp-mini" data-add="${c.id}" aria-pressed="false">Add</button></div>`;
    }).join('')}</section>`;
  }).join('');
  $('spCat').innerHTML = html;
  $('spCat').querySelectorAll('[data-add]').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.dataset.add, entry = CATALOG.find((c) => c.id === id);
    if (spBody(id)) { spRemove(id); spToast(`${entry.name} removed.`); return; }
    const mode = entry.kepler ? SP.place.mode : 'whatif';
    spAdd(entry, mode, SP.place.distKm);
  }));
}

// ---- clocks UI ---------------------------------------------------------------------------
function spClockName(b) { return b.surf ? `${b.id === 'sun' || b.id === 'moon' ? 'The ' + b.name : b.name}, surface` : `${b.name}, on board`; }
function spSyncClockUI() {
  if (!SP.inited) return;
  const B = SP.sim.bodies;
  ['spClockA', 'spClockB'].forEach((sid, k) => {
    const sel = $(sid);
    const html = B.map((b) => `<option value="${b.id}">${spClockName(b)}</option>`).join('');
    if (sel._h !== html) { sel.innerHTML = html; sel._h = html; }
    sel.value = k === 0 ? SP.clock.a : SP.clock.b;
  });
}
function spPreset(a, b) {
  const need = [a, b].filter((id) => !spBody(id));
  need.forEach((id) => { const e = CATALOG.find((c) => c.id === id); if (e) spAdd(e, 'whatif', SP.place.distKm, true); });
  spClockReset(a, b);
  spSyncClockUI();
}
function spDrawSpark() {
  const cv = $('spSpark'), c = SP.clock;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const S = c.samples.concat([[SP.sim.t - c.t0, c.diff]]);
  const tMax = Math.max(60, S[S.length - 1][0]);
  let lo = 0, hi = 0;
  S.forEach(([, d]) => { lo = Math.min(lo, d); hi = Math.max(hi, d); });
  if (hi - lo < 1e-15) { hi = 1e-15; }
  const pad = 6, X = (t) => pad + ((w - 2 * pad) * t) / tMax, Y = (d) => h - pad - ((h - 2 * pad) * (d - lo)) / (hi - lo);
  g.strokeStyle = 'rgba(181,205,255,.22)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(pad, Y(0)); g.lineTo(w - pad, Y(0)); g.stroke();
  g.strokeStyle = '#E4E9F1'; g.lineWidth = 1.6; g.lineJoin = 'round';
  g.beginPath();
  S.forEach(([t, d], i) => (i ? g.lineTo(X(t), Y(d)) : g.moveTo(X(t), Y(d))));
  g.stroke();
  const [lt, ld] = S[S.length - 1];
  g.fillStyle = '#FFB46B'; g.beginPath(); g.arc(X(lt), Y(ld), 3, 0, Math.PI * 2); g.fill();
  setTxt('spSparkL', `0 to ${fmtSpan(tMax)} of simulated time`);
}
function spUpdateClockUI() {
  const c = SP.clock, A = spBody(c.a), B = spBody(c.b);
  if (!A || !B) return;
  const el = SP.sim.t - c.t0;
  const d = c.diff;
  setTxt('spDiffBig', `${d >= 0 ? '+' : '−'}${fmtDur(Math.abs(d))}`);
  setTxt('spDiffCap', el < 1 ? 'Start the time to let the clocks run.' : `${B.name}’s clock is ${d >= 0 ? 'ahead of' : 'behind'} ${A.name}’s after ${fmtSpan(el)}.`);
  if (c.inst) {
    const rA = c.inst.A[0] + c.inst.A[1], rB = c.inst.B[0] + c.inst.B[1];
    const perDay = (rA - rB) * 86400;
    setTxt('spRateTxt', `${B.name} ${perDay >= 0 ? 'gains' : 'loses'} ${fmtDur(Math.abs(perDay))} per day on ${A.name}`);
    setTxt('spLightTxt', `In ${fmtDur(Math.abs(perDay))} light travels ${fmtLen(Math.abs(perDay) * C_LIGHT)}. That is how far off a navigation fix would drift each day if the difference were ignored.`);
    const vals = [c.inst.A[0], c.inst.A[1], c.inst.B[0], c.inst.B[1]];
    const vmax = Math.max(...vals, 1e-20);
    const bar = (lab, v, cls) => `<div class="sp-cb ${cls}"><span class="sp-cb-k">${lab}</span><span class="sp-bar-t"><i style="width:${Math.max(1, (100 * v) / vmax).toFixed(1)}%"></i></span><span class="sp-cb-v">${sig(v * 1e9, 3)} ppb</span></div>`;
    const html = `<div class="sp-cb-name">${spClockName(A)}</div>${bar('Gravity', c.inst.A[0], 'grav')}${bar('Speed', c.inst.A[1], 'kin')}`
      + `<div class="sp-cb-name">${spClockName(B)}</div>${bar('Gravity', c.inst.B[0], 'grav')}${bar('Speed', c.inst.B[1], 'kin')}`;
    const box = $('spClockBars');
    if (box._h !== html) { box.innerHTML = html; box._h = html; }
  }
  setTxt('spClockFrame', c.frame === 'geo'
    ? 'Both clocks are compared in Earth’s free-falling frame, the same one used for GPS. The Sun and other distant bodies act only through their tides, because Earth falls freely around them.'
    : 'These clocks are compared in the Solar System’s barycentric frame. Each bar is measured against a clock at rest far from the Sun.');
  spDrawSpark();
}

// ---- init -------------------------------------------------------------------------------
function initSpace() {
  if (SP.inited || !renderer) return;
  try { renderer.initSpace(settings.diskOct); }
  catch (e) { console.error(e); $('glError').hidden = false; $('glErrorMsg').textContent = 'The spacetime renderer failed to compile on this device. Choose Low in Settings, then reload the page.'; return; }
  spBuild(Date.now());
  spDefaultCam();
  SP.inited = true;
  renderer.loadSpaceTextures(SP_TEX).catch((e) => console.error(e));
  // Time controls
  const rate = $('spRate');
  rate.innerHTML = SP_RATES.map(([t], i) => `<option value="${i}">${t}</option>`).join('');
  rate.value = String(SP.rateIdx);
  rate.addEventListener('change', () => { SP.rateIdx = +rate.value; });
  const syncPlayBtn = () => {
    const b = $('spPlay');
    b.querySelector('use').setAttribute('href', SP.playing ? '#i-pause' : '#i-play');
    b.querySelector('span').textContent = SP.playing ? 'Pause' : 'Play';
    b.setAttribute('aria-label', SP.playing ? 'Pause time' : 'Start time');
  };
  $('spPlay').addEventListener('click', () => { SP.playing = !SP.playing; syncPlayBtn(); });
  syncPlayBtn();
  $('spNow').addEventListener('click', () => { spBuild(Date.now()); spFocus(SP.cam.focus, true); spRebuildUI(); spToast('Reset to the present moment.'); });
  bindSeg($('spGridSeg'), () => SP.grid, (v) => { SP.grid = v; });
  bindSeg($('spFocusSeg'), () => SP.cam.focus, (v) => spFocus(v));
  // Grid depth
  const syncDepth = () => {
    $('spDepth').value = String(SP.depthExag);
    setRangeFill($('spDepth'));
  };
  bindSwitch($('spDepthHold'), () => SP.depthHold, (v) => {
    SP.depthHold = v;
    if (v) SP.heldBase = SP.kmPerPpbAuto || SP.kmPerPpb / Math.pow(10, SP.depthExag);
  });
  $('spDepth').addEventListener('input', (e) => { SP.depthExag = +e.target.value; setRangeFill(e.target); });
  $('spDepth').addEventListener('dblclick', () => { SP.depthExag = 0; syncDepth(); });
  SP.syncDepth = syncDepth;
  // View options
  bindSwitch($('spClouds'), () => SP.view.clouds, (v) => { SP.view.clouds = v; });
  bindSwitch($('spCity'), () => SP.view.lights, (v) => { SP.view.lights = v; });
  bindSwitch($('spLabelsSw'), () => SP.view.labels, (v) => { SP.view.labels = v; });
  const ev = $('spEv');
  ev.value = String(SP.view.ev); setRangeFill(ev);
  ev.addEventListener('input', () => { SP.view.ev = +ev.value; setRangeFill(ev); setTxt('spEvOut', `${SP.view.ev >= 0 ? '+' : '−'}${Math.abs(SP.view.ev).toFixed(1)} EV`); });
  setTxt('spEvOut', `+${SP.view.ev.toFixed(1)} EV`);
  // Tabs
  const tabs = [...document.querySelectorAll('#spTabs [role=tab]')];
  const selectSpTab = (t) => {
    tabs.forEach((x) => { const on = x === t; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; $(x.getAttribute('aria-controls')).hidden = !on; });
    if (t.id === 'spTabBtnClocks') spUpdateClockUI();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectSpTab(t));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); selectSpTab(n);
    });
  });
  // Catalogue and placement
  spBuildCatalog();
  bindSeg($('spPlaceSeg'), () => SP.place.mode, (v) => { SP.place.mode = v; });
  const pd = $('spPlaceDist');
  const syncPd = () => { setRangeFill(pd); setTxt('spPlaceOut', `${fmtKm(Math.round(SP.place.distKm / 1000) * 1000)}, ${sig(SP.place.distKm / 384400, 2)} × the Moon’s distance`); };
  pd.value = String(Math.log10(SP.place.distKm));
  pd.addEventListener('input', () => { SP.place.distKm = Math.pow(10, +pd.value); syncPd(); });
  syncPd();
  // Clocks
  $('spClockA').addEventListener('change', (e) => { spClockReset(e.target.value, SP.clock.b); });
  $('spClockB').addEventListener('change', (e) => { spClockReset(SP.clock.a, e.target.value); });
  $('spClockSwap').addEventListener('click', () => spClockReset(SP.clock.b, SP.clock.a));
  $('spClockReset').addEventListener('click', () => spClockReset(SP.clock.a, SP.clock.b));
  document.querySelectorAll('#spPresets [data-pair]').forEach((b) => b.addEventListener('click', () => { const [x, y] = b.dataset.pair.split(','); spPreset(x, y); }));
  // Panel
  $('spInspClose').addEventListener('click', () => setSpInspector(false));
  $('spInspOpen').addEventListener('click', () => setSpInspector(true));
  if (innerWidth <= 760) setSpInspector(false, true);
  spRebuildUI();
  syncDepth();
  spFocus('earth', true);
}
function setSpInspector(open, quiet) {
  const p = $('spInsp');
  p.dataset.hidden = open ? 'false' : 'true';
  $('spInspOpen').hidden = open;
  p.inert = !open;
  measureLayout();
  if (quiet) return;
  if (open) $('spInspClose').focus({ preventScroll: true }); else $('spInspOpen').focus({ preventScroll: true });
}

// ---- frame -----------------------------------------------------------------------------------
function spaceFrame(dt, now, cssW, cssH) {
  if (!SP.inited) initSpace();
  if (!SP.inited) return null;
  if (SP.playing) {
    const simDt = dt * SP_RATES[SP.rateIdx][1];
    spAdvance(simDt);
  }
  spCamUpdate(dt);
  const c = SP.cam;
  const portrait = cssH > cssW * 1.2;
  const fov = portrait ? 70 : 50;
  const tanHalf = Math.tan((fov * Math.PI) / 360);
  const dir = [Math.cos(c.el) * Math.sin(c.az), Math.sin(c.el), Math.cos(c.el) * Math.cos(c.az)];
  const camPos = v3.add(c.fpos, v3.mul(dir, c.dist));
  const fwd = v3.mul(dir, -1);
  const right = v3.norm(v3.cross(fwd, [0, 1, 0]));
  const up = v3.cross(right, fwd);
  const minDim = Math.min(cssW, cssH);
  const tx = (layout.railW - layout.inspW) / 2 / minDim, ty = layout.sheet / 2 / minDim;
  SP.layout.centerX += (tx - SP.layout.centerX) * 0.18; SP.layout.centerY += (ty - SP.layout.centerY) * 0.18;
  const center = [SP.layout.centerX, SP.layout.centerY];
  const pixAng = (2 * tanHalf) / Math.min(sceneRes[0], sceneRes[1]);

  spAutoExposure(dt);
  lnReset();
  let g = null;
  if (SP.grid !== 'none') g = spGrid(camPos, c.dist, dt);
  spTrajectories(camPos, c.dist, g);
  const U = spUniforms(camPos, pixAng);
  const view = {
    center, depthK: [1 / Math.log2(1e15), 1e-3], right, up, fwd, tanHalf, time: SP.sim.t, sunI: 3.2, sunRadiance: 60,
    n: U.n, earth: U.earth, moon: U.moon, B: SPU.B, BC0: SPU.BC0, BC1: SPU.BC1, BP: SPU.BP, BP2: SPU.BP2, BRot: SPU.BRot,
    sunPos: U.sunPos, sunR: U.sunR, earthPhase: U.earthPhase, clouds: SP.view.clouds ? 1 : 0, lightsOn: SP.view.lights ? 1 : 0,
    skyGain: 0.8, skyMat: SPU.skyMat, lines: SP.lines, lineScale: sceneRes[0] / cssW,
    bloom: settings.bloom, bloomThreshold: 1.6, bloomStrength: 0.5, exposure: Math.pow(2, SP.view.ev), tonemap: settings.tonemap,
  };
  SP.lastV = { camPos, fwd, right, up, tanHalf, center, cssW, cssH };
  spLabels(SP.lastV, cssW, cssH);
  if (now - SP.lastUI > 250) {
    SP.lastUI = now;
    const dd = new Date(SP.epochMs + SP.sim.t * 1000);
    const pad = (x) => String(x).padStart(2, '0');
    setTxt('spDate', `${dd.getUTCDate()} ${MONTHS[dd.getUTCMonth()]} ${dd.getUTCFullYear()}, ${pad(dd.getUTCHours())}:${pad(dd.getUTCMinutes())} UTC`);
    const lim = $('spLimit');
    const limTxt = SP.limited && SP.playing ? `Slowed to ${sig(SP.limited * 100, 2)}% of this speed so fast orbits stay accurate` : '';
    if (lim.textContent !== limTxt) { lim.textContent = limTxt; lim.hidden = !limTxt; }
    if ($('spInsp').dataset.hidden !== 'true') {
      if (!$('spTabBodies').hidden) spUpdateCards();
      if (!$('spTabClocks').hidden) spUpdateClockUI();
    }
    setTxt('spDepthOut', `×${sig(Math.pow(10, SP.depthExag), 2)}`);
    setTxt('spDepthScale', SP.grid === 'none' ? 'Turn on a grid to see its scale.' : `1 part per billion of clock slowing is drawn ${fmtKm(SP.kmPerPpb)} deep.`);
  }
  return view;
}

// Tap a body to open its card; double-click to fly to it.
function spPick(x, y, fly) {
  const V = SP.lastV; if (!V) return;
  let best = null, bd = Infinity;
  for (const b of SP.sim.bodies) {
    const pr = spProject(b.x, V, V.cssW, V.cssH); if (!pr) continue;
    const rpx = b.R * 1000 * pr.scale, d = Math.hypot(pr.x - x, pr.y - y);
    const tol = Math.max(14, rpx);
    if (d < tol && pr.z < bd) { bd = pr.z; best = b; }
  }
  if (!best) { if (fly) { spDefaultCam(); spFocus('earth', true); } return; }
  if (fly) { spFocus(best.id); return; }
  const card = SP.cards.get(best.id);
  if (!card) return;
  if ($('spInsp').dataset.hidden === 'true') setSpInspector(true, true);
  $('spTabBtnBodies').click();
  card.card.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  card.card.classList.remove('flash'); void card.card.offsetWidth; card.card.classList.add('flash');
}

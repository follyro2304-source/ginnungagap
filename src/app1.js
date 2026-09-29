// ============================================================================
//  Settings
// ============================================================================
const TIERS = {
  low:    { renderScale: 0.5,  dprCap: 1,   integrator: 'verlet', maxSteps: 150, stepK: 0.12,  diskOct: 2, skyRes: 1024, stars: 40000,  bloom: true, bloomLevels: 4, bloomStrength: 0.55, tonemap: 'aces', fpsCap: 60, dynRes: true,  targetFps: 30 },
  medium: { renderScale: 0.75, dprCap: 1.5, integrator: 'rk4',    maxSteps: 240, stepK: 0.09,  diskOct: 3, skyRes: 1536, stars: 80000,  bloom: true, bloomLevels: 5, bloomStrength: 0.55, tonemap: 'aces', fpsCap: 0,  dynRes: true,  targetFps: 45 },
  high:   { renderScale: 1.0,  dprCap: 2,   integrator: 'rk4',    maxSteps: 360, stepK: 0.06,  diskOct: 4, skyRes: 2048, stars: 130000, bloom: true, bloomLevels: 6, bloomStrength: 0.55, tonemap: 'aces', fpsCap: 0,  dynRes: false, targetFps: 60 },
  ultra:  { renderScale: 1.5,  dprCap: 2,   integrator: 'rk4',    maxSteps: 640, stepK: 0.035, diskOct: 5, skyRes: 2560, stars: 200000, bloom: true, bloomLevels: 7, bloomStrength: 0.55, tonemap: 'aces', fpsCap: 0,  dynRes: false, targetFps: 60 },
};
const TIER_INFO = {
  low:    { name: 'Low',    bars: 1, desc: 'Phones and integrated graphics. Half resolution, fewer steps per ray.' },
  medium: { name: 'Medium', bars: 2, desc: 'Most laptops. Three-quarter resolution with a fourth-order integrator.' },
  high:   { name: 'High',   bars: 3, desc: 'Dedicated graphics cards. Full resolution and a detailed sky.' },
  ultra:  { name: 'Ultra',  bars: 4, desc: 'High-end desktops. Supersampled, with the finest integration steps.' },
};
const GFX_KEYS = Object.keys(TIERS.high);
const STORE_KEY = 'ginnungagap.settings.v1';

function recommendTier(gpu) {
  const g = (gpu || '').toLowerCase();
  const mobile = matchMedia('(pointer:coarse)').matches && Math.min(screen.width, screen.height) < 820;
  if (mobile || /mali|adreno|powervr|swiftshader|llvmpipe|software/.test(g)) return 'low';
  if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|apple m[1-9] (pro|max|ultra)/.test(g)) return 'high';
  return 'medium';
}
function loadSettings(rec) {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { s = null; }
  const base = { tier: rec, mode: 'simple', showFps: false, showHints: true, reduceMotion: null, ...TIERS[rec] };
  if (!s || typeof s !== 'object') return base;
  const out = { ...base };
  for (const k of Object.keys(base)) if (k in s) out[k] = s[k];
  if (out.tier !== 'custom' && TIERS[out.tier]) Object.assign(out, TIERS[out.tier]);
  return out;
}
function saveSettings() { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* storage unavailable */ } }

// ============================================================================
//  Simulation state
// ============================================================================
const BH_PRESETS = [
  { id: 'sgra', name: 'Sgr A*', mass: 4.297e6, distPc: 8277,
    note: 'The black hole at the centre of the Milky Way, 8.3 kpc away. Its real inflow is hot, thick and roughly a billion times fainter than the Eddington limit; the thin disk here is illustrative.' },
  { id: 'm87', name: 'M87*', mass: 6.5e9, distPc: 16.8e6,
    note: 'Centre of the giant elliptical galaxy M87, 16.8 Mpc away. The first black hole imaged by the Event Horizon Telescope, in 2019.' },
  { id: 'cyg', name: 'Cygnus X-1', mass: 21.2, distPc: 2220,
    note: 'An X-ray binary 2.2 kpc away, feeding on a blue supergiant companion. Mass from radio parallax measurements (2021).' },
  { id: 'gaia3', name: 'Gaia BH3', mass: 32.7, distPc: 590,
    note: 'A dormant black hole 590 pc away, found from its companion star’s wobble in 2024. The most massive stellar black hole known in our galaxy.' },
  { id: 'ton', name: 'TON 618', mass: 6.6e10, distPc: null,
    note: 'A hyperluminous quasar seen at redshift 2.2, among the most massive black holes known. Its distance is cosmological, so no angular size is shown.' },
];
const SIM_DEFAULTS = {
  preset: 'sgra', mass: 4.297e6, mdot: 0.1, diskOut: 14, colorMode: 'visible', tDisp: 5200,
  rate: 6, playing: true, time: 0,
  lensing: true, doppler: true, beam: 1.0, grav: true, disk: true, sky: true, phGrid: false, eqGrid: false,
  ev: 0, skyGain: 1.0, fov: 50, autoOrbit: false, opacity: 2.4,
};
const sim = { ...SIM_DEFAULTS };
const CAM_DEFAULT = { az: 0.0, el: 0.1396, dist: 34 };
const cam = { az: CAM_DEFAULT.az, el: CAM_DEFAULT.el, dist: CAM_DEFAULT.dist, tAz: CAM_DEFAULT.az, tEl: CAM_DEFAULT.el, tDist: CAM_DEFAULT.dist, vAz: 0, vEl: 0 };
const DIST_MIN = 4, DIST_MAX = 120;

// ============================================================================
//  Vector helpers
// ============================================================================
const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; },
  roty: (a, t) => [a[0] * Math.cos(t) + a[2] * Math.sin(t), a[1], -a[0] * Math.sin(t) + a[2] * Math.cos(t)],
};

// ============================================================================
//  Title texture for the home page (lensed by the black hole in the shader)
// ============================================================================
const title = { canvas: null, gapX: 0, gapY: 0, left: 0, width: 1, bottom: 0, top: 0 };
function drawTitle() {
  const W = 2048, H = 560;
  const c = title.canvas || document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  const family = '"Newsreader","Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
  let fs = 300;
  g.font = `300 ${fs}px ${family}`;
  const gapEm = 0.2;
  const measure = () => {
    const a = g.measureText('Ginnunga').width, b = g.measureText('gap').width;
    return { a, b, total: a + b + gapEm * fs };
  };
  let m = measure();
  fs = Math.floor(fs * Math.min(1.35, 1880 / m.total));
  g.font = `300 ${fs}px ${family}`;
  m = measure();
  const x0 = (W - m.total) / 2;
  const base = Math.round(H * 0.64);
  g.fillStyle = '#fff';
  g.textBaseline = 'alphabetic';
  g.fillText('Ginnunga', x0, base);
  g.fillText('gap', x0 + m.a + gapEm * fs, base);
  const xm = g.measureText('x');
  const xh = xm.actualBoundingBoxAscent || fs * 0.45;
  const cap = g.measureText('G').actualBoundingBoxAscent || fs * 0.7;
  const desc = g.measureText('gap').actualBoundingBoxDescent || fs * 0.22;
  title.canvas = c;
  title.gapX = x0 + m.a + (gapEm * fs) / 2;
  title.gapY = base - xh / 2;
  title.left = x0; title.width = m.total;
  title.top = base - cap; title.bottom = base + desc;
  title.W = W; title.H = H;
}

// ============================================================================
//  View assembly
// ============================================================================
const layout = { railW: 60, inspW: 368, sheet: 0, centerX: 0, centerY: 0 };
function prefersReducedMotion() {
  if (settings.reduceMotion === true) return true;
  if (settings.reduceMotion === false) return false;
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function computeTNorm(Tdisp) { return Tdisp / Math.pow(PT.shapeMax, 0.25); }

function bhView(cssW, cssH) {
  const minDim = Math.min(cssW, cssH);
  const pos = [cam.dist * Math.cos(cam.el) * Math.sin(cam.az), cam.dist * Math.sin(cam.el), cam.dist * Math.cos(cam.el) * Math.cos(cam.az)];
  const fwd = V.norm(V.scale(pos, -1));
  const right = V.norm(V.cross(fwd, [0, 1, 0]));
  const up = V.cross(right, fwd);
  const d = derive(sim.mass, sim.mdot, cam.dist);
  const Tdisp = sim.colorMode === 'true' ? d.Tpeak : sim.tDisp;
  const rp = PT.xPeak / 2;
  const gTyp = sim.grav ? Math.sqrt(1 - 1.5 / rp) / Math.sqrt(1 - 1 / cam.dist) : 1;
  // Smoothly follow panel layout so the hole stays centred in the free area.
  const tx = (layout.railW - layout.inspW) / 2 / minDim, ty = layout.sheet / 2 / minDim;
  layout.centerX += (tx - layout.centerX) * 0.18; layout.centerY += (ty - layout.centerY) * 0.18;
  return {
    pos, fwd, right, up, center: [layout.centerX, layout.centerY],
    tanHalf: Math.tan((sim.fov * Math.PI) / 360),
    time: sim.time, stepK: settings.stepK, rEsc: Math.max(cam.dist, sim.diskOut) * 1.08 + 3,
    diskOut: sim.diskOut, tNorm: computeTNorm(Tdisp), diskGain: 1.5 / Math.max(BB.relLum(Tdisp * gTyp), 1e-30),
    beam: sim.beam, opacity: sim.opacity,
    lensing: +sim.lensing, doppler: +sim.doppler, grav: +sim.grav, disk: +sim.disk, sky: +sim.sky,
    phGrid: +sim.phGrid, eqGrid: +sim.eqGrid, skyGain: sim.skyGain,
    textOn: false,
    bloom: settings.bloom, bloomStrength: settings.bloomStrength, bloomThreshold: 0.8,
    exposure: Math.pow(2, sim.ev), tonemap: settings.tonemap,
  };
}

const home = { t: 0, scroll: 0, titleScale: 1 };
function homeView(cssW, cssH) {
  const minDim = Math.min(cssW, cssH);
  const railW = layout.railW;
  const freeW = cssW - railW;
  const fov = 50, tanHalf = Math.tan((fov * Math.PI) / 360);
  // Title width on screen, in units of the short screen side.
  const wUV = Math.min(1.5, (freeW / minDim) * (freeW < 700 ? 0.92 : 0.8));
  // Keep the Einstein ring in proportion to the letters on narrow screens.
  const D = 90 * Math.min(2, Math.max(1, 1.3 / wUV));
  const s = wUV / title.width;                 // uv per title-canvas pixel
  const wordMid = title.left + title.width / 2;
  const cx = railW / 2 / minDim + (title.gapX - wordMid) * s;
  const cy = (0.5 - (cssW < cssH ? 0.24 : 0.3)) * (cssH / minDim) + home.scroll / minDim;
  home.titleScale = s;
  const still = prefersReducedMotion();
  const t = home.t;
  const ax = still ? 0 : 0.045 * Math.sin((t * 2 * Math.PI) / 47) + 0.012 * Math.sin((t * 2 * Math.PI) / 13);
  const ay = still ? 0 : 0.014 * Math.sin((t * 2 * Math.PI) / 31 + 1.0);
  // Moving the camera by (-dx, -dy) puts the hole at (dx, dy) in view coordinates.
  const dx = ax * 2 * tanHalf * D, dy = ay * 2 * tanHalf * D;
  const az = 0.05;
  const pos = V.roty([-dx, -dy, D], az);
  const fwd = V.roty([0, 0, -1], az), right = V.roty([1, 0, 0], az), up = [0, 1, 0];
  const Tdisp = 6200;
  return {
    pos, fwd, right, up, center: [cx, cy], tanHalf,
    time: sim.time, stepK: Math.max(settings.stepK, 0.07), rEsc: D * 1.1 + 3,
    diskOut: 14, tNorm: computeTNorm(Tdisp), diskGain: 1.5 / BB.relLum(Tdisp), beam: 1, opacity: 2.4,
    lensing: 1, doppler: 1, grav: 1, disk: 0, sky: 1, phGrid: 0, eqGrid: 0, skyGain: 0.85,
    textOn: true, textDist: D + 30,
    textRect: [-title.gapX * s, -(1 - title.gapY / title.H) * title.H * s, title.W * s, title.H * s],
    textColor: [0.86, 0.91, 1.0].map((c) => c * 1.25),
    bloom: settings.bloom, bloomStrength: settings.bloomStrength * 0.8, bloomThreshold: 0.9,
    exposure: 1.0, tonemap: settings.tonemap,
    titleBottomCss: (cssH / 2 - (cy - home.scroll / minDim) * minDim) + (title.bottom - title.gapY) * s * minDim,
  };
}

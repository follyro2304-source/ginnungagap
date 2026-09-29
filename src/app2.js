// ============================================================================
//  Boot
// ============================================================================
const $ = (id) => document.getElementById(id);
const canvas = $('gl');
let renderer = null, settings = null, skyJob = null, route = 'home';
try { renderer = new Renderer(canvas); } catch (e) { console.error(e); }
const REC_TIER = recommendTier(renderer ? renderer.gpu : '');
settings = loadSettings(REC_TIER);

if (!renderer) {
  document.body.classList.add('no-gl');
  $('glError').hidden = false;
  $('homeCaption').textContent = 'This browser could not start WebGL 2, so the live view is unavailable.';
}

function startSky() {
  if (!renderer) return;
  skyJob = renderer.beginSky(settings.skyRes, settings.stars);
  $('loader').hidden = false; $('loaderText').textContent = 'Charting the sky'; $('loaderBar').style.width = '0%';
}
function applyQuality() {
  if (!renderer) return;
  try { renderer.setQuality(settings); if (typeof SP !== 'undefined' && SP.inited) renderer.initSpace(settings.diskOct); }
  catch (e) { console.error(e); $('glError').hidden = false; $('glErrorMsg').textContent = 'The ray tracer failed to compile on this device. Choose Low in Settings, then reload the page.'; }
}

// ============================================================================
//  Small UI helpers
// ============================================================================
function setRangeFill(el) {
  const min = +el.min, max = +el.max, v = +el.value;
  el.style.setProperty('--p', `${((v - min) / (max - min)) * 100}%`);
}
function bindSwitch(btn, get, set) {
  const sync = () => btn.setAttribute('aria-checked', get() ? 'true' : 'false');
  btn.addEventListener('click', () => { set(!get()); sync(); });
  sync();
  return sync;
}
function bindSeg(seg, get, set) {
  const btns = [...seg.querySelectorAll('[role=radio]')];
  const sync = () => btns.forEach((b) => { const on = b.dataset.v === String(get()); b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; });
  btns.forEach((b, i) => {
    b.addEventListener('click', () => { set(b.dataset.v); sync(); });
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const n = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
      n.focus(); n.click();
    });
  });
  sync();
  return sync;
}
function ro(label, id, formula, alt) {
  return `<div class="ro"><span class="k">${label}</span><span class="v" id="${id}"></span>${formula ? `<span class="f">${formula}</span>` : ''}</div>`;
}
const setTxt = (id, t) => { const el = $(id); if (el && el.textContent !== t) el.textContent = t; };

// ============================================================================
//  Inspector: parameters
// ============================================================================
const massRange = $('massRange'), massInput = $('massInput');
function syncMass() {
  massRange.value = Math.log10(Math.min(Math.max(sim.mass, 1), 1e11)); setRangeFill(massRange);
  if (document.activeElement !== massInput) massInput.value = sig(sim.mass, 4).replace(' × 10', 'e').replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]/g, (c) => ({ '⁰': 0, '¹': 1, '²': 2, '³': 3, '⁴': 4, '⁵': 5, '⁶': 6, '⁷': 7, '⁸': 8, '⁹': 9, '⁻': '-' }[c]));
}
function setMass(m, fromPreset) {
  sim.mass = Math.min(Math.max(m, 1e-20), 1e13);
  if (!fromPreset) sim.preset = null;
  syncMass(); syncPresets(); updatePhysics();
}
massRange.addEventListener('input', () => setMass(Math.pow(10, +massRange.value)));
massInput.addEventListener('change', () => {
  const v = parseFloat(massInput.value.replace(/,/g, '').replace(/×\s*10\^?/, 'e'));
  if (isFinite(v) && v > 0) setMass(v); else syncMass();
});

const presetBox = $('presets');
presetBox.innerHTML = BH_PRESETS.map((p) => `<button class="preset" data-id="${p.id}" aria-pressed="false">${p.name}</button>`).join('');
presetBox.addEventListener('click', (e) => {
  const b = e.target.closest('.preset'); if (!b) return;
  const p = BH_PRESETS.find((x) => x.id === b.dataset.id);
  sim.preset = p.id; setMass(p.mass, true);
});
function syncPresets() {
  presetBox.querySelectorAll('.preset').forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === sim.preset));
  const p = BH_PRESETS.find((x) => x.id === sim.preset);
  $('presetNote').textContent = p ? p.note : 'Custom mass. Choose a known black hole above to compare.';
}

function bindRange(id, outId, get, set, fmt) {
  const el = $(id);
  const sync = () => { el.value = get(); setRangeFill(el); if (outId) setTxt(outId, fmt(get())); };
  el.addEventListener('input', () => { set(+el.value); sync(); });
  sync();
  return sync;
}
const syncMdot = bindRange('mdotRange', 'mdotOut', () => Math.log10(sim.mdot), (v) => { sim.mdot = Math.pow(10, v); updatePhysics(); },
  (v) => { const m = Math.pow(10, v); return `${m >= 0.1 ? sig(m * 100, 2) : sig(m * 100, 2)}% of Eddington`; });
const syncDout = bindRange('doutRange', 'doutOut', () => sim.diskOut, (v) => { sim.diskOut = v; }, (v) => `${sig(v, 3)} r_s`.replace('r_s', 'rₛ'));
const syncTdisp = bindRange('tdispRange', 'tdispOut', () => sim.tDisp, (v) => { sim.tDisp = v; updatePhysics(); }, (v) => `${Math.round(v).toLocaleString('en-US')} K`);
const syncRate = bindRange('rateRange', 'rateOut', () => sim.rate, (v) => { sim.rate = v; updatePhysics(); }, (v) => `${sig(v, 2)} rₛ/c per second`);
bindSeg($('cmodeSeg'), () => sim.colorMode, (v) => { sim.colorMode = v; updatePhysics(); });

// Relativistic effects
const EFFECTS = [
  { k: 'lensing', label: 'Gravitational lensing', d: 'Light follows null geodesics of the Schwarzschild metric. Off: rays travel in straight lines.' },
  { k: 'doppler', label: 'Doppler beaming', d: 'Gas moving towards you looks brighter and bluer, because I<sub>ν</sub>/ν³ is conserved along a ray.', ember: true },
  { k: 'grav', label: 'Gravitational redshift', d: 'Light loses energy climbing out of the potential well.', ember: true },
  { k: 'disk', label: 'Accretion disk', d: 'Thin disk from the innermost stable orbit outward.', ember: true },
  { k: 'sky', label: 'Background sky', d: 'Milky Way and stars behind the black hole.' },
  { k: 'phGrid', label: 'Photon sphere grid', d: 'A globe drawn at r = 1.5 rₛ, where light can circle the hole. Lensing lets you see its far side.' },
  { k: 'eqGrid', label: 'Disk-plane grid', d: 'Circles every rₛ in the disk plane. The innermost stable orbit is amber, the photon sphere blue.' },
];
const effBox = $('effects');
effBox.innerHTML = EFFECTS.map((e) => `<div class="tg"><div><span class="k" id="lbl-${e.k}">${e.label}</span><span class="d">${e.d}</span></div><button class="sw${e.ember ? ' ember' : ''}" role="switch" id="sw-${e.k}" aria-labelledby="lbl-${e.k}"></button></div>` +
  (e.k === 'doppler' ? `<div class="ctl sub-ctl ember-ctl" id="beamCtl"><div class="ctl-row"><label for="beamRange">Beaming strength</label><output id="beamOut"></output></div><input type="range" id="beamRange" min="0" max="1" step="0.05"></div>` : '')).join('');
const effSync = EFFECTS.map((e) => bindSwitch($(`sw-${e.k}`), () => sim[e.k], (v) => { sim[e.k] = v; if (e.k === 'doppler') $('beamCtl').hidden = !v; }));
const syncBeam = bindRange('beamRange', 'beamOut', () => sim.beam, (v) => { sim.beam = v; }, (v) => (v >= 0.999 ? 'physical' : `${Math.round(v * 100)}%`));

// Observer controls
const distToS = (d) => Math.log(d / DIST_MIN) / Math.log(DIST_MAX / DIST_MIN);
const sToDist = (s) => DIST_MIN * Math.pow(DIST_MAX / DIST_MIN, s);
const distRange = $('distRange');
distRange.addEventListener('input', () => { cam.tDist = sToDist(+distRange.value); cam.dist = cam.tDist; });
function syncDist() { if (document.activeElement !== distRange) distRange.value = distToS(cam.dist); setRangeFill(distRange); setTxt('distOut', `${sig(cam.dist, 3)} rₛ`); }
const syncFov = bindRange('fovRange', 'fovOut', () => sim.fov, (v) => { sim.fov = v; }, (v) => `${Math.round(v)}°`);
const syncEv = bindRange('expRange', 'expOut', () => sim.ev, (v) => { sim.ev = v; }, (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} EV`);
const syncSky = bindRange('skyRange', 'skyOut', () => sim.skyGain, (v) => { sim.skyGain = v; }, (v) => `${Math.round(v * 100)}%`);
const syncAuto = bindSwitch($('autoOrbit'), () => sim.autoOrbit, (v) => { sim.autoOrbit = v; });

// Readout scaffolding
$('roObserver').innerHTML =
  ro('Inclination', 'o-inc', 'angle between line of sight and disk axis') +
  ro('Distance', 'o-dist', '') +
  ro('Clock rate', 'o-dtau', 'dτ/dt = √(1 − r<sub>s</sub>/r)') +
  ro('Shadow diameter from here', 'o-shadow', 'sin α = (3√3/2)(r<sub>s</sub>/r)√(1 − r<sub>s</sub>/r)') +
  ro('Escape velocity here', 'o-vesc', 'v = c√(r<sub>s</sub>/r)');
$('roGeometry').innerHTML =
  ro('Schwarzschild radius', 'g-rs', 'r<sub>s</sub> = 2GM/c²') +
  ro('Photon sphere', 'g-rph', 'r = 3GM/c² = 1.5 r<sub>s</sub>') +
  ro('Innermost stable orbit', 'g-isco', 'r = 6GM/c² = 3 r<sub>s</sub>') +
  ro('Shadow radius', 'g-bc', 'b<sub>c</sub> = 3√3 GM/c² ≈ 2.598 r<sub>s</sub>') +
  ro('Light-crossing time', 'g-tc', 't = r<sub>s</sub>/c') +
  ro('Photon orbit period', 'g-pph', 'T = 2π · 3√3 GM/c³');
$('roThermo').innerHTML =
  ro('Surface gravity', 'h-kappa', 'κ = c⁴/4GM') +
  ro('Hawking temperature', 'h-th', 'T<sub>H</sub> = ħc³/8πGMk<sub>B</sub>') +
  ro('Evaporation time', 'h-tev', 't = 5120πG²M³/ħc⁴') +
  ro('Entropy', 'h-s', 'S/k<sub>B</sub> = 4πGM²/ħc') +
  ro('Mean density inside r<sub>s</sub>', 'h-rho', 'ρ = 3c⁶/32πG³M²') +
  ro('Tidal stretch across 2 m at the horizon', 'h-tidal', 'Δa = 2GM·ℓ/r<sub>s</sub>³');
$('roAccretion').innerHTML =
  ro('Eddington luminosity', 'a-ledd', 'L<sub>Edd</sub> = 4πGMm<sub>p</sub>c/σ<sub>T</sub>') +
  ro('Disk luminosity', 'a-l', 'L = ṁ L<sub>Edd</sub>') +
  ro('Radiative efficiency', 'a-eta', 'η = 1 − √(8/9), binding energy at the ISCO') +
  ro('Mass accretion rate', 'a-mdot', 'Ṁ = L/ηc²') +
  ro('Peak disk temperature', 'a-tp', 'σT⁴ = F(r), Page–Thorne profile') +
  ro('Peak emission', 'a-lam', 'λ = b/T (Wien)') +
  ro('Hottest ring', 'a-rp', '') +
  ro('Orbital speed at ISCO', 'a-v', 'v = c√(GM/(rc² − 2GM)) = c/2') +
  ro('Orbital period at ISCO', 'a-p', 'T = 2π√(r³/GM), distant clock');
$('roEarth').innerHTML = ro('Distance', 'e-d', '') + ro('Shadow diameter', 'e-sh', 'θ = 2b<sub>c</sub>/d');

function updatePhysics() {
  const d = derive(sim.mass, sim.mdot, cam.dist);
  setTxt('g-rs', fmtLen(d.rs)); setTxt('g-rph', fmtLen(d.rph)); setTxt('g-isco', fmtLen(d.risco));
  setTxt('g-bc', fmtLen(d.bc)); setTxt('g-tc', fmtTime(d.tcross)); setTxt('g-pph', fmtTime(d.Pph));
  setTxt('h-kappa', `${sig(d.kappa)} m/s²`); setTxt('h-th', fmtTemp(d.TH)); setTxt('h-tev', fmtTime(d.tevap));
  setTxt('h-s', sig(d.S)); setTxt('h-rho', `${sig(d.rho)} kg/m³`); setTxt('h-tidal', `${sig(d.tidal)} m/s²`);
  setTxt('a-ledd', `${sig(d.LEdd)} W`); setTxt('a-l', `${sig(d.L / K.Lsun)} L☉`); setTxt('a-eta', `${sig(d.eta * 100)}%`);
  setTxt('a-mdot', `${sig((d.Mdot * K.yr) / K.Msun)} M☉/yr`); setTxt('a-tp', fmtTemp(d.Tpeak));
  const lp = d.lamPeak;
  setTxt('a-lam', `${lp < 1e-6 ? sig(lp * 1e9) + ' nm' : lp < 1e-3 ? sig(lp * 1e6) + ' µm' : sig(lp * 1e3) + ' mm'}, ${bandOf(lp)}`);
  setTxt('a-rp', `${sig(PT.xPeak / 2, 3)} rₛ = ${fmtLen(d.rPeak)}`);
  setTxt('a-v', `${sig(0.5 * K.c / 1000)} km/s`); setTxt('a-p', fmtTime(d.Pisco));
  const p = BH_PRESETS.find((x) => x.id === sim.preset);
  $('earthGrp').hidden = !(p && p.distPc);
  if (p && p.distPc) {
    const dm = p.distPc * K.pc;
    setTxt('e-d', p.distPc >= 1e6 ? `${sig(p.distPc / 1e6)} Mpc` : p.distPc >= 1000 ? `${sig(p.distPc / 1000)} kpc` : `${sig(p.distPc)} pc`);
    setTxt('e-sh', fmtAngle((2 * d.bc) / dm));
  }
  // Disk colour explanation
  const tLabel = fmtTemp(d.Tpeak);
  $('cmodeHint').textContent = sim.colorMode === 'visible'
    ? `The physical peak is ${tLabel}, emitting mostly ${bandOf(d.lamPeak)}. Temperatures are scaled so the peak shows as the colour below; every ratio, redshift and Doppler shift stays exact.`
    : `Rendered at the physical temperature, ${tLabel}. A disk this hot looks blue-white because visible light sits on the long-wavelength tail of its spectrum.`;
  $('tdispCtl').hidden = sim.colorMode !== 'visible';
  const secPerRs = d.tcross;
  $('rateHint').textContent = sim.rate > 0
    ? `One second on screen is ${sig(sim.rate, 2)} rₛ/c, which is ${fmtTime(sim.rate * secPerRs)} for this black hole. The inner edge of the disk orbits every 46.2 rₛ/c.`
    : 'The disk is frozen.';
  updateObserver(d);
}
let lastObs = 0;
function updateObserver(d) {
  d = d || derive(sim.mass, sim.mdot, cam.dist);
  setTxt('o-inc', `${sig(90 - Math.abs((cam.el * 180) / Math.PI), 3)}°`);
  setTxt('o-dist', `${sig(cam.dist, 3)} rₛ = ${fmtLen(cam.dist * d.rs)}`);
  setTxt('o-dtau', sig(d.dtau, 4));
  setTxt('o-shadow', fmtAngle(d.shadowLocal));
  setTxt('o-vesc', `${sig(d.vesc, 3)} c`);
  syncDist();
}

// Play / pause and reset
const playBtn = $('playBtn');
function syncPlay() {
  playBtn.querySelector('use').setAttribute('href', sim.playing ? '#i-pause' : '#i-play');
  playBtn.querySelector('span').textContent = sim.playing ? 'Pause' : 'Play';
  playBtn.setAttribute('aria-label', sim.playing ? 'Pause disk motion' : 'Play disk motion');
}
playBtn.addEventListener('click', () => { sim.playing = !sim.playing; syncPlay(); });
function resetView() { cam.tAz = CAM_DEFAULT.az; cam.tEl = CAM_DEFAULT.el; cam.tDist = CAM_DEFAULT.dist; cam.vAz = cam.vEl = 0; }
$('resetView').addEventListener('click', resetView);

// Inspector visibility
const insp = $('insp');
function setInspector(open, quiet) {
  insp.dataset.hidden = open ? 'false' : 'true';
  $('inspOpen').hidden = open;
  insp.inert = !open;
  measureLayout();
  if (quiet) return;
  if (open) $('inspClose').focus({ preventScroll: true }); else $('inspOpen').focus({ preventScroll: true });
}
$('inspClose').addEventListener('click', () => setInspector(false));
$('inspOpen').addEventListener('click', () => setInspector(true));

// ============================================================================
//  Rail and routing
// ============================================================================
const rail = $('rail');
$('railToggle').addEventListener('click', () => {
  const open = rail.dataset.open !== 'true';
  rail.dataset.open = open; $('railToggle').setAttribute('aria-expanded', open);
  $('railToggle').querySelector('.nav-label').textContent = open ? 'Collapse' : 'Expand';
  $('railToggle').querySelector('.tip').textContent = open ? 'Collapse sidebar' : 'Expand sidebar';
});
const ROUTE_HASH = { home: '#/', 'black-hole': '#/black-hole', spacetime: '#/spacetime' };
document.querySelectorAll('.nav-btn[data-route]').forEach((b) => b.addEventListener('click', () => { location.hash = ROUTE_HASH[b.dataset.route]; }));
function onRoute() {
  route = location.hash.startsWith('#/black-hole') ? 'bh' : location.hash.startsWith('#/spacetime') ? 'space' : 'home';
  $('page-home').hidden = route !== 'home';
  $('page-bh').hidden = route !== 'bh';
  $('page-space').hidden = route !== 'space';
  const navOf = { home: 'home', bh: 'black-hole', space: 'spacetime' };
  document.querySelectorAll('.nav-btn[data-route]').forEach((b) => {
    if (b.dataset.route === navOf[route]) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const interactive = route !== 'home';
  canvas.tabIndex = interactive ? 0 : -1;
  canvas.classList.toggle('grab', interactive);
  canvas.setAttribute('aria-label', route === 'space' ? 'Rendered view of Earth, the Moon and the curvature of spacetime around them' : 'Rendered view of a black hole and the Milky Way');
  document.title = route === 'bh' ? 'Black hole · Ginnungagap' : route === 'space' ? 'Spacetime around Earth · Ginnungagap' : 'Ginnungagap';
  if (route === 'space') initSpace();
  if (route === 'bh') { updatePhysics(); }
  measureLayout();
}
window.addEventListener('hashchange', onRoute);
$('homeScroll').addEventListener('scroll', (e) => { home.scroll = e.target.scrollTop; }, { passive: true });

// ============================================================================
//  Camera input
// ============================================================================
const pointers = new Map();
let pinch0 = 0, dist0 = 0;
const activeCam = () => (route === 'space' ? SP.cam : cam);
const camLimits = () => (route === 'space' ? [spMinDist(SP.cam.focus), 3e13] : [DIST_MIN, DIST_MAX]);
let downAt = null;
canvas.addEventListener('pointerdown', (e) => {
  if (route === 'home') return;
  if (route === 'space' && !SP.inited) return;
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.classList.add('grabbing');
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); dist0 = activeCam().tDist; }
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  const C = activeCam(), [dMin, dMax] = camLimits();
  if (pointers.size === 1) {
    const k = 0.0055 * ((route === 'space' ? 50 : sim.fov) / 60);
    C.tAz -= dx * k; C.tEl = Math.max(-1.5, Math.min(1.5, C.tEl + dy * k));
    C.vAz = -dx * k * 60; C.vEl = dy * k * 60;
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch0 > 0) C.tDist = Math.max(dMin, Math.min(dMax, dist0 * (pinch0 / d)));
  }
});
const endPointer = (e) => {
  if (route === 'space' && SP.inited && downAt && e.type === 'pointerup' && pointers.size === 1 && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5 && performance.now() - downAt.t < 350) spPick(e.clientX, e.clientY, false);
  pointers.delete(e.pointerId); if (!pointers.size) canvas.classList.remove('grabbing'); pinch0 = 0; };
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  if (route === 'home' || (route === 'space' && !SP.inited)) return;
  e.preventDefault();
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  const C = activeCam(), [dMin, dMax] = camLimits();
  C.tDist = Math.max(dMin, Math.min(dMax, C.tDist * Math.exp(dy * (route === 'space' ? 0.0016 : 0.0012))));
}, { passive: false });
canvas.addEventListener('dblclick', (e) => {
  if (route === 'bh') resetView();
  else if (route === 'space' && SP.inited) spPick(e.clientX, e.clientY, true);
});
window.addEventListener('keydown', (e) => {
  if (route === 'home' || !$('settings').hidden) return;
  if (route === 'space' && !SP.inited) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || (t.getAttribute && t.getAttribute('role') === 'radio'))) return;
  const step = 0.06, C = activeCam(), [dMin, dMax] = camLimits();
  let used = true;
  switch (e.key) {
    case 'ArrowLeft': C.tAz += step; break;
    case 'ArrowRight': C.tAz -= step; break;
    case 'ArrowUp': C.tEl = Math.min(1.5, C.tEl + step); break;
    case 'ArrowDown': C.tEl = Math.max(-1.5, C.tEl - step); break;
    case '+': case '=': C.tDist = Math.max(dMin, C.tDist / 1.15); break;
    case '-': case '_': C.tDist = Math.min(dMax, C.tDist * 1.15); break;
    default: used = false;
  }
  if (used && (t === canvas || t === document.body)) e.preventDefault();
});
function updateCamera(dt) {
  if (!pointers.size) {
    cam.tAz += cam.vAz * dt; cam.tEl = Math.max(-1.53, Math.min(1.53, cam.tEl + cam.vEl * dt));
    const damp = Math.exp(-dt * 5); cam.vAz *= damp; cam.vEl *= damp;
    if (sim.autoOrbit && !prefersReducedMotion()) cam.tAz += dt * 0.05;
  }
  const f = 1 - Math.exp(-dt * 12);
  cam.az += (cam.tAz - cam.az) * f; cam.el += (cam.tEl - cam.el) * f;
  cam.dist += (cam.tDist - cam.dist) * f;
}

// ============================================================================
//  Settings dialog
// ============================================================================
const dlg = $('settings');
let lastFocus = null;
function openSettings() {
  lastFocus = document.activeElement;
  dlg.hidden = false;
  syncSettingsUI();
  $('tab-gfx').getAttribute('aria-selected') === 'true' ? $('tab-gfx').focus() : $('tab-ui').focus();
}
function closeSettings() { dlg.hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
$('openSettings').addEventListener('click', openSettings);
$('closeSettings').addEventListener('click', closeSettings);
$('doneSettings').addEventListener('click', closeSettings);
dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) closeSettings(); });
dlg.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeSettings(); return; }
  if (e.key !== 'Tab') return;
  const f = [...dlg.querySelectorAll('button,input,select,[tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null && x.tabIndex >= 0);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
const tabs = [$('tab-gfx'), $('tab-ui')];
function selectTab(t) {
  tabs.forEach((x) => { const on = x === t; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; $(x.getAttribute('aria-controls')).hidden = !on; });
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = tabs[(i + 1) % 2]; selectTab(n); n.focus(); }
  });
});
bindSeg($('gfxMode'), () => settings.mode, (v) => { settings.mode = v; $('gfxSimple').hidden = v !== 'simple'; $('gfxAdvanced').hidden = v !== 'advanced';
  $('gfxModeText').textContent = v === 'simple' ? 'Pick the quality level that suits your hardware. Changes apply immediately.' : 'Tune each part of the renderer. Heavier settings are towards the right of each slider.';
  saveSettings(); });

// Tier cards
const tiersEl = $('tiers');
tiersEl.innerHTML = Object.keys(TIERS).map((k) => {
  const t = TIER_INFO[k];
  return `<button class="tier" role="radio" data-tier="${k}" aria-checked="false">${k === REC_TIER ? '<span class="rec">Recommended</span>' : ''}<span class="t-name">${t.name}</span><span class="t-desc">${t.desc}</span><span class="bars" aria-hidden="true">${[1, 2, 3, 4].map((n) => `<i class="${n <= t.bars ? 'on' : ''}"></i>`).join('')}</span></button>`;
}).join('');
tiersEl.addEventListener('click', (e) => { const b = e.target.closest('.tier'); if (b) applyTier(b.dataset.tier); });
tiersEl.addEventListener('keydown', (e) => {
  if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
  e.preventDefault();
  const keys = Object.keys(TIERS);
  const i = keys.indexOf(e.target.dataset.tier);
  const n = keys[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : keys.length - 1)) % keys.length];
  applyTier(n); tiersEl.querySelector(`[data-tier="${n}"]`).focus();
});
function applyTier(k) {
  const before = { ...settings };
  Object.assign(settings, TIERS[k]); settings.tier = k;
  onGfxChanged(before);
}
$('resetGfx').addEventListener('click', () => applyTier(REC_TIER));

// Advanced controls
const ADV = [
  { group: 'Resolution', items: [
    { key: 'renderScale', label: 'Render scale', type: 'range', min: 0.25, max: 2, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, hint: 'Share of device pixels traced each frame. Above 100% supersamples.' },
    { key: 'dprCap', label: 'Pixel density limit', type: 'select', options: [[1, '1×'], [1.5, '1.5×'], [2, '2×'], [3, '3×']] },
    { key: 'dynRes', label: 'Adaptive resolution', type: 'switch' },
    { key: 'targetFps', label: 'Adaptive target', type: 'select', options: [[30, '30 fps'], [45, '45 fps'], [60, '60 fps']] },
  ] },
  { group: 'Ray tracing', items: [
    { key: 'integrator', label: 'Integrator', type: 'select', options: [['rk4', 'Runge–Kutta, 4th order'], ['verlet', 'Velocity Verlet, 2nd order']] },
    { key: 'maxSteps', label: 'Steps per ray, at most', type: 'range', min: 64, max: 1000, step: 8, fmt: (v) => String(v) },
    { key: 'stepK', label: 'Step length', type: 'range', min: 0.02, max: 0.2, step: 0.005, fmt: (v) => `${v.toFixed(3)} r`, hint: 'Fraction of the current radius per step. Shorter steps are more accurate near the photon sphere.', invert: true },
  ] },
  { group: 'Accretion disk and sky', items: [
    { key: 'diskOct', label: 'Turbulence detail', type: 'range', min: 1, max: 6, step: 1, fmt: (v) => `${v} octave${v > 1 ? 's' : ''}` },
    { key: 'skyRes', label: 'Sky map resolution', type: 'select', options: [[1024, '1024 px per face'], [1536, '1536 px per face'], [2048, '2048 px per face'], [2560, '2560 px per face'], [3072, '3072 px per face']] },
    { key: 'stars', label: 'Stars', type: 'select', options: [[20000, '20 000'], [40000, '40 000'], [80000, '80 000'], [130000, '130 000'], [200000, '200 000'], [260000, '260 000']] },
  ] },
  { group: 'Post-processing and pacing', items: [
    { key: 'bloom', label: 'Bloom', type: 'switch' },
    { key: 'bloomLevels', label: 'Bloom quality', type: 'range', min: 3, max: 7, step: 1, fmt: (v) => `${v} levels` },
    { key: 'bloomStrength', label: 'Bloom strength', type: 'range', min: 0, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: 'tonemap', label: 'Tone mapping', type: 'select', options: [['aces', 'ACES filmic'], ['reinhard', 'Reinhard']] },
    { key: 'fpsCap', label: 'Frame rate limit', type: 'select', options: [[0, 'Unlimited'], [60, '60 fps'], [30, '30 fps']] },
  ] },
];
const advSync = [];
$('advGrid').innerHTML = ADV.map((g) => `<div class="adv-grp"><h3>${g.group}</h3>${g.items.map((it) => {
  const id = `adv-${it.key}`;
  if (it.type === 'switch') return `<div class="tg"><div><span class="k" id="${id}-l">${it.label}</span></div><button class="sw" role="switch" id="${id}" aria-labelledby="${id}-l"></button></div>`;
  if (it.type === 'select') return `<div class="ctl"><div class="ctl-row"><label for="${id}">${it.label}</label></div><select class="sel" id="${id}">${it.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>`;
  return `<div class="ctl"><div class="ctl-row"><label for="${id}">${it.label}</label><output id="${id}-o"></output></div><input type="range" id="${id}" min="${it.min}" max="${it.max}" step="${it.step}">${it.hint ? `<p class="hint">${it.hint}</p>` : ''}</div>`;
}).join('')}</div>`).join('');
ADV.forEach((g) => g.items.forEach((it) => {
  const el = $(`adv-${it.key}`);
  const setv = (v) => { const before = { ...settings }; settings[it.key] = v; settings.tier = 'custom'; onGfxChanged(before); };
  if (it.type === 'switch') { advSync.push(bindSwitch(el, () => settings[it.key], setv)); return; }
  if (it.type === 'select') {
    el.addEventListener('change', () => { const raw = el.value; setv(isNaN(+raw) ? raw : +raw); });
    advSync.push(() => { el.value = String(settings[it.key]); });
    return;
  }
  // Inverted sliders keep "heavier to the right" for settings where smaller is costlier.
  const toUI = (v) => (it.invert ? it.min + it.max - v : v);
  el.addEventListener('input', () => { setv(Math.round(toUI(+el.value) / it.step) * it.step); });
  advSync.push(() => { el.value = toUI(settings[it.key]); setRangeFill(el); setTxt(`adv-${it.key}-o`, it.fmt(settings[it.key])); });
}));
const uiSwitches = [...document.querySelectorAll('[data-set]')].map((b) => bindSwitch(b,
  () => (b.dataset.set === 'reduceMotion' ? prefersReducedMotion() : settings[b.dataset.set]),
  (v) => { const before = { ...settings }; settings[b.dataset.set] = v; onGfxChanged(before); }));

let skyTimer = 0;
function onGfxChanged(before) {
  // Keep the preset label honest: only exact preset values count as that preset.
  const match = Object.keys(TIERS).find((k) => GFX_KEYS.every((key) => key === 'dynRes' || key === 'targetFps' || TIERS[k][key] === settings[key]));
  settings.tier = match || 'custom';
  if (before.skyRes !== settings.skyRes || before.stars !== settings.stars) { clearTimeout(skyTimer); skyTimer = setTimeout(startSky, 350); }
  if (before.integrator !== settings.integrator || before.maxSteps !== settings.maxSteps || before.diskOct !== settings.diskOct) applyQuality();
  if (before.renderScale !== settings.renderScale || before.dprCap !== settings.dprCap || before.dynRes !== settings.dynRes) dynScale = 1;
  saveSettings(); syncSettingsUI();
}
function syncSettingsUI() {
  tiersEl.querySelectorAll('.tier').forEach((b) => { const on = b.dataset.tier === settings.tier; b.setAttribute('aria-checked', on); b.tabIndex = on || (settings.tier === 'custom' && b.dataset.tier === REC_TIER) ? 0 : -1; });
  $('customFlag').hidden = settings.tier !== 'custom';
  advSync.forEach((f) => f()); uiSwitches.forEach((f) => f());
  $('gfxSimple').hidden = settings.mode !== 'simple'; $('gfxAdvanced').hidden = settings.mode !== 'advanced';
  $('fpsChip').hidden = !settings.showFps;
  $('hintChip').hidden = !settings.showHints;
}

// ============================================================================
//  Layout measurement
// ============================================================================
function measureLayout() {
  const mobile = innerWidth <= 760;
  layout.railW = rail.getBoundingClientRect().width;
  const panel = route === 'space' ? $('spInsp') : insp;
  const open = panel.dataset.hidden !== 'true' && route !== 'home';
  layout.inspW = open && !mobile ? panel.getBoundingClientRect().width : 0;
  layout.sheet = open && mobile ? panel.getBoundingClientRect().height : 0;
}
new ResizeObserver(measureLayout).observe(rail);
new ResizeObserver(measureLayout).observe(insp);
new ResizeObserver(measureLayout).observe($('spInsp'));
window.addEventListener('resize', measureLayout);

// ============================================================================
//  Main loop
// ============================================================================
let dynScale = 1, lastNow = performance.now(), frameN = 0, ema = 16.7, lastAdjust = 0, fpsAcc = 0, fpsFrames = 0, fpsShown = 0, sceneRes = [0, 0];
function frame(now) {
  requestAnimationFrame(frame);
  if (!renderer) return;
  const dtMs = now - lastNow;
  if (settings.fpsCap && dtMs < 1000 / settings.fpsCap - 2) return;
  lastNow = now;
  const dt = Math.min(dtMs / 1000, 0.1);
  if (skyJob) {
    const r = skyJob();
    $('loaderBar').style.width = `${Math.round(r.progress * 100)}%`;
    if (r.done) { skyJob = null; $('loader').hidden = true; }
  }
  if (route === 'bh' || route === 'home') updateCamera(dt);
  if (sim.playing) sim.time += dt * sim.rate;
  home.t += dt;

  const cssW = innerWidth, cssH = innerHeight;
  const dpr = Math.min(devicePixelRatio || 1, settings.dprCap);
  const outW = Math.max(1, Math.round(cssW * dpr)), outH = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== outW || canvas.height !== outH) { canvas.width = outW; canvas.height = outH; }
  let sc = settings.renderScale * (settings.dynRes ? dynScale : 1);
  const maxPix = 9.0e6;
  if (outW * outH * sc * sc > maxPix) sc = Math.sqrt(maxPix / (outW * outH));
  const sw = Math.max(16, Math.round(outW * sc)), sh = Math.max(16, Math.round(outH * sc));
  renderer.resize(outW, outH, sw, sh, settings.bloomLevels);
  sceneRes = [sw, sh];

  let view;
  if (route === 'space') {
    view = spaceFrame(dt, now, cssW, cssH);
    if (view) { view.frame = frameN++; renderer.renderSpace(view); }
    else renderer.render(homeView(cssW, cssH));
  }
  if (route === 'space') { /* rendered above */ }
  else if (route === 'bh') {
    view = bhView(cssW, cssH);
    if (now - lastObs > 120) { lastObs = now; updateObserver(); }
  } else {
    view = homeView(cssW, cssH);
    const tb = Math.round(view.titleBottomCss + 36);
    if (tb !== home.tb) { home.tb = tb; document.documentElement.style.setProperty('--title-bottom', `${tb}px`); }
  }
  if (route !== 'space') { view.frame = frameN++; renderer.render(view); }

  // Frame statistics and adaptive resolution
  ema += (dtMs - ema) * 0.1;
  fpsAcc += dtMs; fpsFrames++;
  if (fpsAcc > 500) {
    fpsShown = (1000 * fpsFrames) / fpsAcc; fpsAcc = 0; fpsFrames = 0;
    if (settings.showFps) setTxt('fpsChip', `${Math.round(fpsShown)} fps at ${sw} × ${sh}`);
    if (!dlg.hidden) setTxt('gpuInfo', `${renderer.gpu}. Rendering ${sw} × ${sh} at ${Math.round(fpsShown)} fps.`);
  }
  if (settings.dynRes && !skyJob && now - lastAdjust > 700) {
    lastAdjust = now;
    const target = 1000 / settings.targetFps;
    if (ema > target * 1.12) dynScale = Math.max(0.35, dynScale * 0.9);
    else if (ema < target * 1.03) dynScale = Math.min(1, dynScale * 1.04);
  }
}

// ============================================================================
//  Start
// ============================================================================
function init() {
  syncMass(); syncPresets(); syncMdot(); syncDout(); syncTdisp(); syncRate(); syncFov(); syncEv(); syncSky(); syncAuto(); syncBeam();
  effSync.forEach((f) => f());
  syncPlay(); syncSettingsUI(); selectTab($('tab-gfx'));
  onRoute(); measureLayout();
  if (innerWidth <= 760) setInspector(false, true);
  if (innerHeight > innerWidth * 1.2) { sim.fov = 72; syncFov(); }
  updatePhysics();
  if (renderer) {
    $('gpuInfo').textContent = renderer.gpu;
    drawTitle(); renderer.setText(title.canvas);
    if (document.fonts && document.fonts.load) {
      Promise.all([document.fonts.load('300 200px "Newsreader"'), document.fonts.ready]).then(() => { drawTitle(); renderer.setText(title.canvas); }).catch(() => {});
    }
    applyQuality();
    startSky();
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); $('glError').hidden = false; $('glErrorMsg').textContent = 'The graphics context was lost. Reload the page to restart the simulation.'; });
  }
  requestAnimationFrame((t) => { lastNow = t; frame(t); });
}
init();

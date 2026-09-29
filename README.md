# Ginnungagap

A physically based laboratory for extreme astrophysics that runs in the browser. Every image is computed from physical law, and the numbers beside each view come from the same equations that draw it.

**Live site:** https://ginnungagap.vercel.app

In Norse cosmology, Ginnungagap is the void that existed before anything else, between Niflheim (ice) and Muspelheim (fire).

## Modules

### Black hole
A Schwarzschild black hole with a thin accretion disk, ray traced in real time.

- Exact null geodesics (Binet equation), exact static-observer camera mapping; the shadow matches the analytic size to better than one part in a million.
- Page–Thorne disk temperature profile, blackbody colours, gravitational and Doppler shifts, relativistic beaming.
- Presets for Sgr A\*, M87\*, Cygnus X-1, Gaia BH3 and TON 618, with around 30 live readouts.

### Spacetime around Earth
Earth and the Moon where they are right now, at true scale, with the curvature of spacetime drawn around them.

- **Motion.** Starts from ephemerides for the current date (JPL Keplerian elements for the planets, a low-precision lunar theory for the Moon), then integrates the bodies with a 4th-order symplectic N-body integrator that includes the first post-Newtonian (general relativistic) correction.
- **Grid.** The 2D sheet's depth is the gravitational potential, U/c², which is also how much slower clocks run at each point. Bodies outside the focused system contribute only their tides (equivalence principle).
- **Visuals.** Day and night, city lights, clouds, eclipses, earthshine, and the real sky with the brightest stars in their true positions.
- **Add bodies.** Real spacecraft orbits (ISS, Hubble, Tiangong, GPS, geostationary, LRO), planets where they are today or placed next to Earth as a what-if, and moons of other planets.
- **Clocks.** Compare the proper time of any two clocks. GPS gains 38.5 µs per day on the ground; the ISS loses 24 µs per day.

## Repository layout

| Path | Contents |
| --- | --- |
| `index.html` | The whole app bundled into one self-contained file. This is what is deployed. |
| `src/` | Readable sources: styles, markup, physics, shaders, renderer and UI. |
| `textures/` | Earth, city lights and Moon maps embedded into `index.html` at build time. |
| `tools/` | The build script and the scripts that generate the textures. |

The app uses raw WebGL 2 with no runtime dependencies other than two Google Fonts.

## Building

```bash
python3 tools/build.py      # writes index.html from src/ and textures/
```

Open `index.html` directly in a browser, or serve the folder with any static server.

### Regenerating the textures (optional)

```bash
pip install numpy scipy pillow global-land-mask geonamescache
python3 tools/gen_landmask.py   # downsample the 1 km land mask (cache, not committed)
python3 tools/gen_earth.py      # textures/earth.jpg
python3 tools/gen_lights.py     # textures/lights.jpg
python3 tools/gen_moon.py       # textures/moon_albedo.jpg, textures/moon_height.jpg
```

Earth's colours come from real coastlines plus climate-zone rules, not photographs. The Moon's maria and major ray craters are placed at their real coordinates; smaller craters are generated.

## Data credits

- City locations and populations: [GeoNames](https://www.geonames.org/) (CC BY 4.0), via `geonamescache`.
- Land/water mask: NOAA GLOBE, via `global-land-mask`.
- Planetary elements: E. M. Standish, *Keplerian Elements for Approximate Positions of the Major Planets* (JPL).
- Lunar positions: low-precision formulae from the *Astronomical Almanac*.
- Bright star positions: standard J2000 catalogue values.

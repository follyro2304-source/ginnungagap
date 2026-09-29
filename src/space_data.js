// ============================================================================
//  Spacetime page: data
// ============================================================================
// Brightest stars: name, right ascension (h), declination (deg), V magnitude, effective temperature (K).
const BRIGHT_STARS = [
  ['Sirius', 6.7525, -16.716, -1.46, 9940], ['Canopus', 6.3992, -52.696, -0.74, 7400],
  ['Arcturus', 14.2610, 19.182, -0.05, 4290], ['Vega', 18.6156, 38.784, 0.03, 9600],
  ['Capella', 5.2782, 45.998, 0.08, 4970], ['Rigel', 5.2423, -8.202, 0.13, 12100],
  ['Procyon', 7.6550, 5.225, 0.34, 6530], ['Betelgeuse', 5.9195, 7.407, 0.50, 3600],
  ['Achernar', 1.6286, -57.237, 0.46, 15000], ['Hadar', 14.0637, -60.373, 0.61, 25000],
  ['Altair', 19.8464, 8.868, 0.76, 7700], ['Acrux', 12.4433, -63.099, 0.76, 28000],
  ['Aldebaran', 4.5987, 16.509, 0.86, 3900], ['Antares', 16.4901, -26.432, 0.96, 3400],
  ['Spica', 13.4199, -11.161, 0.97, 22400], ['Pollux', 7.7553, 28.026, 1.14, 4670],
  ['Fomalhaut', 22.9608, -29.622, 1.16, 8600], ['Deneb', 20.6905, 45.280, 1.25, 8500],
  ['Mimosa', 12.7954, -59.689, 1.25, 27000], ['Regulus', 10.1395, 11.967, 1.35, 12500],
  ['Adhara', 6.9771, -28.972, 1.50, 22000], ['Castor', 7.5767, 31.888, 1.58, 10300],
  ['Shaula', 17.5601, -37.104, 1.62, 25000], ['Gacrux', 12.5194, -57.113, 1.64, 3600],
  ['Bellatrix', 5.4189, 6.350, 1.64, 22000], ['Elnath', 5.4382, 28.608, 1.65, 13600],
  ['Miaplacidus', 9.2200, -69.717, 1.67, 9000], ['Alnilam', 5.6036, -1.202, 1.69, 27000],
  ['Alnair', 22.1372, -46.961, 1.74, 13900], ['Alnitak', 5.6793, -1.943, 1.77, 29000],
  ['Alioth', 12.9005, 55.960, 1.77, 9000], ['Dubhe', 11.0621, 61.751, 1.79, 4700],
  ['Mirfak', 3.4054, 49.861, 1.79, 6350], ['Wezen', 7.1399, -26.393, 1.83, 6000],
  ['Sargas', 17.6220, -42.998, 1.86, 7200], ['Kaus Australis', 18.4029, -34.385, 1.85, 9960],
  ['Avior', 8.3752, -59.510, 1.86, 4000], ['Alkaid', 13.7923, 49.313, 1.86, 15500],
  ['Menkalinan', 5.9921, 44.948, 1.90, 9200], ['Atria', 16.8111, -69.028, 1.91, 4100],
  ['Alhena', 6.6285, 16.399, 1.93, 9300], ['Peacock', 20.4275, -56.735, 1.94, 17000],
  ['Polaris', 2.5303, 89.264, 1.98, 6000], ['Saiph', 5.7959, -9.670, 2.09, 26000],
  ['Mintaka', 5.5334, -0.299, 2.23, 29500], ['Mizar', 13.3988, 54.925, 2.23, 9000],
  ['Algol', 3.1361, 40.956, 2.12, 13000], ['Denebola', 11.8177, 14.572, 2.14, 8500],
  ['Hamal', 2.1196, 23.463, 2.00, 4500], ['Schedar', 0.6751, 56.537, 2.24, 4700],
  ['Caph', 0.1530, 59.150, 2.28, 7000], ['Kochab', 14.8451, 74.156, 2.08, 4100],
  ['Alphard', 9.4598, -8.659, 1.98, 4100], ['Nunki', 18.9211, -26.297, 2.05, 18900],
  ['Diphda', 0.7265, -17.987, 2.04, 4800], ['Rasalhague', 17.5822, 12.560, 2.08, 8000],
  ['Almach', 2.0650, 42.330, 2.10, 4500], ['Alpheratz', 0.1398, 29.091, 2.06, 13800],
  ['Mirach', 1.1622, 35.621, 2.05, 3800], ['Enif', 21.7364, 9.875, 2.39, 4400],
  ['Markab', 23.0793, 15.205, 2.48, 9800], ['Scheat', 23.0629, 28.083, 2.42, 3700],
];

// J2000 rotation, equatorial -> galactic (Hipparcos convention). Rows: l=0 direction, l=90, north galactic pole.
const EQ2GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
];
const OBLIQUITY = 23.4392911 * Math.PI / 180;

// Keplerian elements for approximate planetary positions, 1800–2050 (Standish, JPL).
// a (au), e, I, L, long. perihelion, long. node (deg); then rates per Julian century.
const KEPLER = {
  mercury: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593, 0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  venus:   [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255, 0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418],
  emb:     [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0, 0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  mars:    [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  jupiter: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  saturn:  [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, -0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  uranus:  [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503, -0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  neptune: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574, 0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  pluto:   [39.48211675, 0.24882730, 17.14001206, 238.92903833, 224.06891629, 110.30393684, -0.00031596, 0.00005170, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
};

// Look styles understood by the body shader.
const STYLE = { sun: 0, earth: 1, moon: 2, rocky: 3, banded: 4, hazy: 5, icy: 6, volcanic: 7, craft: 8 };

// GM in m^3/s^2, radius in km, rotation period in hours (negative = retrograde), obliquity in degrees.
const CORE_BODIES = {
  sun:   { name: 'Sun', kind: 'Star', GM: 1.32712440018e20, R: 695700, style: STYLE.sun, c0: [1, 0.96, 0.9], c1: [1, 0.9, 0.8], color: '#FFD9A0', rot: 609.12, obl: 7.25, pole: [286.13, 63.87] },
  earth: { name: 'Earth', kind: 'Planet', GM: 3.986004418e14, R: 6371.0, Req: 6378.137, style: STYLE.earth, c0: [0.2, 0.3, 0.5], c1: [0.2, 0.3, 0.5], color: '#7FB2FF', rot: 23.9344696, obl: 23.44 },
  moon:  { name: 'Moon', kind: 'Natural satellite', GM: 4.902800066e12, R: 1737.4, style: STYLE.moon, c0: [0.5, 0.5, 0.5], c1: [0.5, 0.5, 0.5], color: '#D8D2C8', rot: 655.72, obl: 6.68 },
};

// Bodies users can add. "where": earth-orbit (spacecraft), moon-orbit, real (planets), whatif.
const CATALOG = [
  { id: 'iss', group: 'Spacecraft', name: 'ISS', kind: 'Space station', m: 4.2e5, R: 0.055, style: STYLE.craft, color: '#E4E9F1',
    orbit: { around: 'earth', alt: 417, inc: 51.64, ecc: 0.0005 }, blurb: 'The International Space Station, about 420 km up, once around Earth every 93 minutes.' },
  { id: 'hubble', group: 'Spacecraft', name: 'Hubble', kind: 'Space telescope', m: 11110, R: 0.0066, style: STYLE.craft, color: '#E4E9F1',
    orbit: { around: 'earth', alt: 520, inc: 28.47, ecc: 0.0003 }, blurb: 'The Hubble Space Telescope, in low Earth orbit at about 520 km.' },
  { id: 'tiangong', group: 'Spacecraft', name: 'Tiangong', kind: 'Space station', m: 6.6e4, R: 0.028, style: STYLE.craft, color: '#E4E9F1',
    orbit: { around: 'earth', alt: 385, inc: 41.47, ecc: 0.0005 }, blurb: 'China’s space station, about 385 km up.' },
  { id: 'gps', group: 'Spacecraft', name: 'GPS satellite', kind: 'Navigation satellite', m: 1630, R: 0.006, style: STYLE.craft, color: '#E4E9F1',
    orbit: { around: 'earth', alt: 20180, inc: 55.0, ecc: 0.005 }, blurb: 'A GPS Block IIF satellite. Its atomic clocks must be corrected for relativity every day.' },
  { id: 'geo', group: 'Spacecraft', name: 'Geostationary satellite', kind: 'Communications satellite', m: 5000, R: 0.012, style: STYLE.craft, color: '#E4E9F1',
    orbit: { around: 'earth', alt: 35786, inc: 0.0, ecc: 0.0 }, blurb: 'Orbits once per sidereal day, so it hangs over one spot on the equator.' },
  { id: 'lro', group: 'Spacecraft', name: 'Lunar Reconnaissance Orbiter', kind: 'Lunar orbiter', m: 1916, R: 0.004, style: STYLE.craft, color: '#E4E9F1',
    orbit: { around: 'moon', alt: 50, inc: 90, ecc: 0.0 }, blurb: 'NASA’s lunar mapper, in its 50 km polar mapping orbit (2009–2011).' },

  { id: 'mercury', group: 'Planets', name: 'Mercury', kind: 'Planet', GM: 2.2031868e13, R: 2439.7, style: STYLE.rocky, c0: [0.36, 0.33, 0.30], c1: [0.20, 0.19, 0.18], color: '#B9ADA0', rot: 1407.6, obl: 0.03, kepler: 'mercury', pole: [281.01, 61.41] },
  { id: 'venus', group: 'Planets', name: 'Venus', kind: 'Planet', GM: 3.24858592e14, R: 6051.8, style: STYLE.hazy, c0: [0.92, 0.84, 0.64], c1: [0.80, 0.70, 0.50], color: '#F2DDB0', rot: -5832.6, obl: 177.4, kepler: 'venus', pole: [272.76, 67.16] },
  { id: 'mars', group: 'Planets', name: 'Mars', kind: 'Planet', GM: 4.2828372e13, R: 3389.5, style: STYLE.rocky, c0: [0.66, 0.32, 0.17], c1: [0.36, 0.19, 0.11], color: '#E0875A', rot: 24.6229, obl: 25.19, caps: 1, kepler: 'mars', pole: [317.68, 52.89] },
  { id: 'jupiter', group: 'Planets', name: 'Jupiter', kind: 'Planet', GM: 1.26686534e17, R: 69911, style: STYLE.banded, c0: [0.88, 0.78, 0.64], c1: [0.62, 0.44, 0.30], color: '#E8C9A0', rot: 9.925, obl: 3.13, kepler: 'jupiter', pole: [268.06, 64.5], bands: 1.0 },
  { id: 'saturn', group: 'Planets', name: 'Saturn', kind: 'Planet', GM: 3.7931187e16, R: 58232, style: STYLE.banded, c0: [0.90, 0.82, 0.62], c1: [0.74, 0.64, 0.44], color: '#EAD7A8', rot: 10.656, obl: 26.73, kepler: 'saturn', pole: [40.59, 83.54], bands: 0.45, rings: [1.24, 2.27] },
  { id: 'uranus', group: 'Planets', name: 'Uranus', kind: 'Planet', GM: 5.793939e15, R: 25362, style: STYLE.banded, c0: [0.64, 0.84, 0.88], c1: [0.56, 0.78, 0.84], color: '#A8DDE6', rot: -17.24, obl: 97.77, kepler: 'uranus', pole: [257.31, -15.18], bands: 0.12 },
  { id: 'neptune', group: 'Planets', name: 'Neptune', kind: 'Planet', GM: 6.836529e15, R: 24622, style: STYLE.banded, c0: [0.32, 0.48, 0.88], c1: [0.22, 0.34, 0.72], color: '#6F93E8', rot: 16.11, obl: 28.32, kepler: 'neptune', pole: [299.36, 43.46], bands: 0.25 },
  { id: 'pluto', group: 'Planets', name: 'Pluto', kind: 'Dwarf planet', GM: 8.696e11, R: 1188.3, style: STYLE.rocky, c0: [0.80, 0.70, 0.58], c1: [0.42, 0.32, 0.26], color: '#D9C3A6', rot: -153.29, obl: 122.53, kepler: 'pluto', pole: [132.99, -6.16] },

  { id: 'io', group: 'Moons of other planets', name: 'Io', kind: 'Moon of Jupiter', GM: 5.959916e12, R: 1821.6, style: STYLE.volcanic, c0: [0.92, 0.82, 0.38], c1: [0.62, 0.36, 0.14], color: '#EAD27A', rot: 42.46, obl: 0 },
  { id: 'europa', group: 'Moons of other planets', name: 'Europa', kind: 'Moon of Jupiter', GM: 3.202739e12, R: 1560.8, style: STYLE.icy, c0: [0.88, 0.84, 0.76], c1: [0.58, 0.40, 0.30], color: '#E8DDCB', rot: 85.23, obl: 0.1 },
  { id: 'ganymede', group: 'Moons of other planets', name: 'Ganymede', kind: 'Moon of Jupiter', GM: 9.887834e12, R: 2634.1, style: STYLE.rocky, c0: [0.58, 0.54, 0.48], c1: [0.34, 0.30, 0.27], color: '#B9AE9E', rot: 171.7, obl: 0.2 },
  { id: 'callisto', group: 'Moons of other planets', name: 'Callisto', kind: 'Moon of Jupiter', GM: 7.179289e12, R: 2410.3, style: STYLE.rocky, c0: [0.36, 0.31, 0.27], c1: [0.20, 0.17, 0.15], color: '#8C7D6E', rot: 400.5, obl: 0 },
  { id: 'titan', group: 'Moons of other planets', name: 'Titan', kind: 'Moon of Saturn', GM: 8.978138e12, R: 2574.7, style: STYLE.hazy, c0: [0.88, 0.62, 0.26], c1: [0.76, 0.50, 0.20], color: '#E3A95A', rot: 382.7, obl: 0.3 },
  { id: 'triton', group: 'Moons of other planets', name: 'Triton', kind: 'Moon of Neptune', GM: 1.427598e12, R: 1353.4, style: STYLE.icy, c0: [0.86, 0.78, 0.74], c1: [0.66, 0.52, 0.48], color: '#DCC8C0', rot: -141.0, obl: 0 },
  { id: 'phobos', group: 'Moons of other planets', name: 'Phobos', kind: 'Moon of Mars', GM: 7.087e5, R: 11.27, style: STYLE.rocky, c0: [0.30, 0.27, 0.24], c1: [0.18, 0.16, 0.14], color: '#8E8279', rot: 7.65, obl: 0 },
];

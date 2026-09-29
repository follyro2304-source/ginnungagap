import pathlib
HERE = pathlib.Path(__file__).resolve().parent
TEX = HERE.parent / "textures"
CACHE = HERE / "cache"
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
rng = np.random.default_rng(7)

water = np.load(CACHE / 'land4320.npy')
land_hi = 1.0 - water                     # 2160 x 4320, row 0 = +90 lat
W, H = 2048, 1024
land = np.asarray(Image.fromarray((land_hi*255).astype(np.uint8)).resize((W, H), Image.BOX), np.float32) / 255.0

lat = (90 - (np.arange(H) + 0.5) * 180 / H)[:, None] * np.ones((1, W))
lon = (-180 + (np.arange(W) + 0.5) * 360 / W)[None, :] * np.ones((H, 1))

def vnoise(scale, octaves=4, seed=0):
    r = np.random.default_rng(seed)
    acc = np.zeros((H, W), np.float32); amp = 1.0; tot = 0
    for o in range(octaves):
        gh, gw = int(scale * 2**o) + 2, int(scale * 2 * 2**o) + 2
        g = r.random((gh, gw)).astype(np.float32)
        g[:, -1] = g[:, 0]
        up = np.asarray(Image.fromarray(g).resize((W, H), Image.BICUBIC), np.float32)
        acc += amp * up; tot += amp; amp *= 0.5
    return acc / tot

n1 = vnoise(6, 5, 1); n2 = vnoise(20, 3, 2); n3 = vnoise(3, 3, 3)

wla = (vnoise(4, 4, 11) - 0.5) * 12.0
wlo = (vnoise(4, 4, 12) - 0.5) * 16.0
def soft_box(la0, la1, lo0, lo1, edge=4.0, warp=True):
    la = lat + (wla if warp else 0); lo = lon + (wlo if warp else 0)
    fa = np.clip(np.minimum(la - la0, la1 - la) / edge + 0.5, 0, 1)
    fo = np.clip(np.minimum(lo - lo0, lo1 - lo) / edge + 0.5, 0, 1)
    f = fa * fo
    return f * f * (3 - 2 * f)

# Aridity: major deserts and dry steppes (degrees)
arid = np.zeros((H, W), np.float32)
for box, s in [((14, 33, -17, 35), 1.0),   # Sahara
               ((13, 32, 34, 60), 0.95),   # Arabia
               ((25, 38, 44, 70), 0.75),   # Iran / Afghanistan
               ((23, 30, 68, 76), 0.6),    # Thar
               ((36, 47, 58, 72), 0.6),    # Central Asia
               ((37, 46, 75, 112), 0.75),  # Taklamakan / Gobi
               ((-29, -17, 12, 26), 0.7),  # Kalahari / Namib
               ((-32, -19, 114, 146), 0.9),# Australian interior
               ((-28, -16, -72, -67), 0.85),# Atacama
               ((27, 43, -121, -104), 0.6), # SW US / Great Basin
               ((-52, -37, -72, -64), 0.5), # Patagonia
               ((0, 12, 38, 52), 0.55),     # Horn of Africa
               ((20, 30, -115, -104), 0.5)]:# Sonoran / Chihuahuan
    arid = np.maximum(arid, soft_box(*box, edge=9.0) * s)
arid = np.clip(arid * (0.7 + 0.6 * n1) * (0.85 + 0.3 * n2), 0, 1)

alat = np.abs(lat)
# Base vegetation by latitude
trop = np.clip(1 - alat / 14, 0, 1)
boreal = np.clip(1 - np.abs(lat - 58) / 8, 0, 1) * (lat > 0)
tundra = np.clip((lat - 62) / 6, 0, 1) * (lat < 80)
temper = np.clip(1 - np.abs(alat - 42) / 12, 0, 1)

c_trop = np.array([0.018, 0.045, 0.012]); c_temp = np.array([0.045, 0.075, 0.028])
c_boreal = np.array([0.022, 0.040, 0.020]); c_tundra = np.array([0.10, 0.095, 0.070])
c_savanna = np.array([0.16, 0.13, 0.065]); c_desert = np.array([0.52, 0.38, 0.22])
c_red = np.array([0.46, 0.22, 0.10]); c_ice = np.array([0.86, 0.89, 0.93])

sav = np.clip(1 - np.abs(alat - 13) / 6, 0, 1)
col = np.zeros((H, W, 3), np.float32) + c_temp
col = col * (1 - sav[..., None]) + c_savanna * sav[..., None]
col = col * (1 - trop[..., None]) + c_trop * trop[..., None]
col = col * (1 - boreal[..., None]) + c_boreal * boreal[..., None]
col = col * (1 - tundra[..., None]) + c_tundra * tundra[..., None]
red = soft_box(-32, -19, 114, 146, 8) * 0.8 + soft_box(14, 26, -12, 20, 8) * 0.3
desert_col = c_desert * (1 - red[..., None]) + c_red * red[..., None]
arid = np.clip(arid, 0, 1)
dry = np.clip((arid - 0.35) * 2.2, 0, 1)
steppe = np.clip((arid - 0.08) * 3.0, 0, 1) * (1 - dry)
col = col * (1 - steppe[..., None] * 0.7) + c_savanna * steppe[..., None] * 0.7
col = col * (1 - dry[..., None]) + desert_col * dry[..., None]
# Tibetan plateau
tib = soft_box(28, 38, 78, 102, 4, False) * 0.7
col = col * (1 - tib[..., None]) + np.array([0.20, 0.16, 0.11]) * tib[..., None]
col *= (0.82 + 0.36 * n2)[..., None]

# Ice: Antarctica, Greenland, high Arctic
ice = np.clip((-lat - 60) / 3, 0, 1)
ice = np.maximum(ice, soft_box(59, 84, -74, -11, 2, False) * np.clip((lat - 60) / 2, 0, 1))
ice = np.maximum(ice, np.clip((lat - 77) / 3, 0, 1))
# Greenland coastal fringe stays rock
land_bin = land > 0.5
dist_in = ndimage.distance_transform_edt(land_bin)  # pixels from coast, inland
fringe = np.clip(dist_in / 3.0, 0, 1)
ice_g = np.where(lat > 55, ice * fringe, ice)
col = col * (1 - ice_g[..., None]) + c_ice * ice_g[..., None]

# Oceans: deep blue with lighter continental shelves
dist_out = ndimage.distance_transform_edt(~land_bin)
shelf = np.exp(-dist_out / 2.5)
ocean = np.array([0.004, 0.011, 0.032]) * (1 - shelf[..., None]) + np.array([0.012, 0.042, 0.065]) * shelf[..., None]
ocean = ocean * (0.92 + 0.16 * n3[..., None])
sea_ice = np.clip((np.abs(lat) - 74 + (n1 - 0.5) * 10) / 4, 0, 1) * np.clip(n2 * 1.6, 0, 1) * (lat > 0)
ocean = ocean * (1 - sea_ice[..., None]) + np.array([0.80, 0.84, 0.88]) * sea_ice[..., None]
ocean = np.where((lat < -60)[..., None], ocean * (1 - np.clip((-lat - 64) / 4, 0, 1)[..., None]) + c_ice * np.clip((-lat - 64) / 4, 0, 1)[..., None], ocean)

rgb = ocean * (1 - land[..., None]) + col * land[..., None]
srgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(np.clip(rgb, 0, 1), 1 / 2.4) - 0.055)
Image.fromarray((np.clip(srgb, 0, 1) * 255).astype(np.uint8)).save(TEX / 'earth.jpg', quality=86, optimize=True)
# Store land fraction in a small separate map for ocean specular masking
Image.fromarray((land * 255).astype(np.uint8)).save(TEX / 'landmask.png', optimize=True)
print('earth ok')

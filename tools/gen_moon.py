import pathlib
HERE = pathlib.Path(__file__).resolve().parent
TEX = HERE.parent / "textures"
CACHE = HERE / "cache"
import numpy as np
from PIL import Image
from scipy import ndimage
W, H = 2048, 1024
R = 1737.4
lat = np.radians(90 - (np.arange(H) + 0.5) * 180 / H)[:, None] * np.ones((1, W))
lon = np.radians(-180 + (np.arange(W) + 0.5) * 360 / W)[None, :] * np.ones((H, 1))
P = np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], -1).astype(np.float32)

def vnoise(scale, octaves, seed):
    r = np.random.default_rng(seed); acc = np.zeros((H, W), np.float32); amp = 1; tot = 0
    for o in range(octaves):
        g = r.random((int(scale * 2**o) + 2, int(scale * 2 * 2**o) + 2)).astype(np.float32); g[:, -1] = g[:, 0]
        acc += amp * np.asarray(Image.fromarray(g).resize((W, H), Image.BICUBIC), np.float32); tot += amp; amp *= 0.5
    return acc / tot
n1 = vnoise(8, 5, 1); n2 = vnoise(30, 3, 2)

def ang_to(la, lo):
    la, lo = np.radians(la), np.radians(lo)
    c = np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], np.float32)
    return np.arccos(np.clip(P @ c, -1, 1))

# Maria (selenographic lat, lon, diameter km). Longitude 0 faces Earth; east positive.
maria = [(32.8, -15.6, 1146), (28.0, 17.5, 707), (8.5, 31.4, 873), (17.0, 59.1, 556), (-7.8, 51.3, 909),
         (-15.2, 35.5, 333), (-21.3, -16.6, 715), (-24.4, -38.6, 389), (13.3, 3.6, 245), (-10.0, -23.1, 376),
         (7.5, -30.9, 513), (2.4, 1.7, 335), (38.0, 29.0, 384), (44.1, -31.5, 236), (13.3, 86.1, 420),
         (1.3, 87.5, 373), (-38.9, 93.0, 603), (-19.4, -92.8, 327), (27.3, 147.9, 276), (-33.7, 163.5, 318),
         (56.8, 81.5, 273),
         # Oceanus Procellarum as a chain of patches
         (20, -52, 1000), (5, -55, 950), (30, -62, 800), (-5, -45, 750), (12, -40, 800), (40, -50, 520), (-15, -50, 480), (25, -35, 600),
         # Mare Frigoris band
         (56, -30, 380), (58, -5, 380), (58, 20, 360), (55, 38, 300)]
mare = np.zeros((H, W), np.float32)
for la, lo, d in maria:
    a = ang_to(la, lo); r = d / 2 / R
    edge = 1 - np.clip((a - r * (0.98 + 0.5 * (n1 - 0.5) * 2)) / (r * 0.35 + 0.03), 0, 1)
    mare = np.maximum(mare, edge)
mare = np.clip(mare * (0.85 + 0.3 * n2), 0, 1)

# Craters: power-law size distribution, fewer and fresher on maria
rng = np.random.default_rng(5)
height = np.zeros((H, W), np.float32)
albedo_add = np.zeros((H, W), np.float32)
N = 16000
D = 6.0 * (1 - rng.random(N)) ** (-1 / 1.6)
D = D[D < 320]
for d in D:
    z = 2 * rng.random() - 1; lo = rng.random() * 2 * np.pi - np.pi; la = np.arcsin(z)
    r = d / 2 / R
    rows = int(np.ceil(np.degrees(r * 2.2) / 180 * H)) + 2
    cy = int((90 - np.degrees(la)) / 180 * H)
    y0, y1 = max(0, cy - rows), min(H, cy + rows + 1)
    if y1 <= y0: continue
    cl = max(0.05, np.cos(la))
    cols = int(np.ceil(np.degrees(r * 2.2 / cl) / 360 * W)) + 2
    if abs(la) > 1.45: continue
    cx = int((np.degrees(lo) + 180) / 360 * W)
    xs = np.arange(cx - min(cols, W // 2), cx + min(cols, W // 2) + 1) % W
    sub = P[y0:y1][:, xs]
    c = np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], np.float32)
    a = np.arccos(np.clip(sub @ c, -1, 1)) / r      # distance in crater radii
    my = mare[(y0 + y1) // 2, cx % W]
    if my > 0.5 and d > 25 and rng.random() < 0.85: continue
    depth = d * (0.2 if d < 15 else 0.2 * (15 / d) ** 0.5)
    bowl = np.where(a < 1, (a * a - 1) * depth, 0)
    rim = np.where(a >= 0.7, depth * 0.35 * np.exp(-((a - 1.0) / 0.22) ** 2), 0)
    ejecta = np.where(a > 1, depth * 0.12 * np.exp(-(a - 1) * 2.5), 0)
    height[y0:y1, xs] += bowl + rim + ejecta
    fresh = rng.random() < 0.03
    if fresh:
        albedo_add[y0:y1, xs] += 0.05 * np.exp(-np.maximum(a - 0.9, 0) * 2.0) * (a < 3)

# Bright ray craters: Tycho, Copernicus, Kepler, Aristarchus, Proclus
rays = np.zeros((H, W), np.float32)
for la, lo, d, s in [(-43.31, -11.36, 85, 1.0), (9.62, -20.08, 96, 0.7), (8.1, -38.0, 31, 0.45), (23.7, -47.4, 40, 0.6), (16.1, 46.8, 28, 0.35)]:
    a = ang_to(la, lo); r = d / 2 / R
    c = np.radians([la, lo])
    # bearing from crater to each point
    dl = lon - c[1]
    brg = np.arctan2(np.sin(dl) * np.cos(lat), np.cos(c[0]) * np.sin(lat) - np.sin(c[0]) * np.cos(lat) * np.cos(dl))
    k = np.random.default_rng(int(abs(lo) * 10))
    streak = np.zeros_like(a)
    for _ in range(28):
        b0 = k.random() * 2 * np.pi; w = 0.015 + 0.03 * k.random(); L = r * (4 + 12 * k.random())
        db = np.angle(np.exp(1j * (brg - b0)))
        streak = np.maximum(streak, np.exp(-(db / w) ** 2) * np.exp(-a / L))
    halo = np.exp(-np.maximum(a - r, 0) / (r * 2.0))
    rays += s * (0.3 * streak * (a > r * 0.8) + 0.5 * halo)

# Albedo: highlands ~0.15, maria ~0.07 (normal albedo), dark-floored Plato and Grimaldi
alb = 0.165 * (0.85 + 0.3 * n1) * (1 - mare) + 0.068 * (0.85 + 0.3 * n2) * mare
for la, lo, d in [(51.6, -9.4, 101), (-5.2, -68.6, 173)]:
    f = np.clip(1 - (ang_to(la, lo) - d / 2 / R * 0.8) / (d / 2 / R * 0.3), 0, 1)
    alb = alb * (1 - f) + 0.065 * f
alb += 0.02 * np.clip(-height / 8, 0, 1) * (1 - mare)
alb = alb + 0.10 * np.clip(rays, 0, 1.4) + albedo_add
alb = np.clip(alb, 0.03, 0.4)
# Height: smooth maria floors, keep a little large-scale relief
hh = height - ndimage.gaussian_filter(height, 40) * 0.5
hh = hh * (1 - 0.65 * mare) + (n1 - 0.5) * 3.0 * (1 - mare)
hn = np.clip(hh / 6.0 * 0.5 + 0.5, 0, 1)
Image.fromarray((np.clip(alb / 0.32, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)).save(TEX / 'moon_albedo.jpg', quality=85, optimize=True)
Image.fromarray((hn * 255).astype(np.uint8)).save(TEX / 'moon_height.jpg', quality=88, optimize=True)
Image.fromarray((np.clip(alb / 0.32, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)).resize((1024, 512)).save(TEX / 'moon_prev.png')
print('ok', len(D))

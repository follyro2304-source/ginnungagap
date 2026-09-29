import pathlib
HERE = pathlib.Path(__file__).resolve().parent
TEX = HERE.parent / "textures"
CACHE = HERE / "cache"
import numpy as np, geonamescache
from PIL import Image
from scipy import ndimage
W, H = 4096, 2048
acc = np.zeros((H, W), np.float32)
gc = geonamescache.GeonamesCache()
cities = gc.get_cities().values()
low = set('AO BF BI BJ CD CF CG CM DJ ER ET GA GH GM GN GQ GW KE LR LS MG ML MR MW MZ NE NG RW SD SL SN SO SS TD TG TZ UG ZM ZW AF YE HT MM KH LA NP BD PG SB TL'.split())
high = set('US CA GB IE FR DE NL BE LU CH AT IT ES PT DK NO SE FI IS JP KR TW HK SG AU NZ IL AE QA KW BH SA OM CZ SK SI PL HU'.split())
pts = []
for c in cities:
    cc = c['countrycode']; p = c['population']
    k = 0.03 if cc == 'KP' else (0.35 if cc in low else (1.0 if cc in high else 0.7))
    pts.append((c['latitude'], c['longitude'], p, k))
pts = np.array(pts, np.float64)
x = ((pts[:, 1] + 180) / 360 * W) % W
y = (90 - pts[:, 0]) / 180 * H
b = np.power(pts[:, 2], 0.62) * pts[:, 3]
xi = np.clip(x.astype(int), 0, W - 1); yi = np.clip(y.astype(int), 0, H - 1)
# Deposit at several scales: compact cores plus sprawl proportional to population
core = np.zeros((H, W), np.float32); sprawl = np.zeros((H, W), np.float32)
np.add.at(core, (yi, xi), b)
np.add.at(sprawl, (yi, xi), b * np.clip(np.log10(pts[:, 2]) - 4.6, 0, 3))
coslat = np.cos(np.radians(90 - (np.arange(H) + 0.5) * 180 / H))[:, None]
acc = ndimage.gaussian_filter(core, 0.8) + 0.35 * ndimage.gaussian_filter(sprawl, 2.2) + 0.08 * ndimage.gaussian_filter(sprawl, 7)
# Suburban scatter around cities
rng = np.random.default_rng(3)
big = pts[pts[:, 2] > 150000]
for la, lo, p, k in big:
    n = int(min(400, p / 12000))
    r = rng.gamma(1.6, 0.18 * (p / 1e6) ** 0.35, n)
    a = rng.random(n) * 2 * np.pi
    yy = ((90 - (la + r * np.sin(a))) / 180 * H).astype(int)
    xx = (((lo + r * np.cos(a) / max(0.2, np.cos(np.radians(la)))) + 180) / 360 * W).astype(int) % W
    ok = (yy >= 0) & (yy < H)
    np.add.at(acc, (yy[ok], xx[ok]), k * 18.0 * rng.random(ok.sum()))
acc = ndimage.gaussian_filter(acc, 0.6)
land = np.asarray(Image.fromarray((1 - np.load(CACHE / 'land4320.npy')) * 255).convert('L').resize((W, H), Image.BILINEAR), np.float32) / 255
acc *= np.clip(land * 1.5, 0.15, 1)
v = np.log1p(acc / 40.0)
v = v / np.percentile(v[v > 0], 99.7)
img = (np.clip(v, 0, 1) ** 1.25 * 255).astype(np.uint8)
Image.fromarray(img).save(TEX / 'lights.jpg', quality=82, optimize=True)
Image.fromarray(img).resize((2048, 1024), Image.BOX).save(TEX / 'lights_prev.png')
print('ok', (img > 10).mean())

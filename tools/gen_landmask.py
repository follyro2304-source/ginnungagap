"""Step 1: reduce the 1 km GLOBE land/water mask to a 4320x2160 water-fraction grid.
Requires: pip install global-land-mask numpy. Writes tools/cache/land4320.npy (about 37 MB, not committed)."""
import pathlib
import numpy as np
from global_land_mask import globe

CACHE = pathlib.Path(__file__).resolve().parent / 'cache'
CACHE.mkdir(exist_ok=True)
m = globe._mask                      # True = water, row 0 = +90 latitude
H, W = 2160, 4320
out = np.zeros((H, W), np.float32)
for i in range(H):
    out[i] = m[i * 10:(i + 1) * 10].reshape(10, W, 10).sum(axis=(0, 2)) / 100.0
np.save(CACHE / 'land4320.npy', out)
print('wrote', CACHE / 'land4320.npy')

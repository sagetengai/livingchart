"""Check that fixed-camera pairs differ in the artwork, using Phase 1's Pillow/NumPy."""
import json
from pathlib import Path

import numpy as np
from PIL import Image

output = Path(__file__).resolve().parents[2] / "artifacts" / "phase-2-wind"
results = {}
for first in sorted(output.glob("*-a.png")):
    name = first.stem[:-2]
    second = output / f"{name}-b.png"
    with Image.open(first) as a, Image.open(second) as b:
        assert a.size == b.size
        assert a.size == ((3840, 2160) if name.endswith("3840") else (1920, 1080))
        delta = np.abs(np.asarray(a.convert("RGB"), dtype=np.int16) -
                       np.asarray(b.convert("RGB"), dtype=np.int16))
    # Ignore the outer 5% where attribution and map controls can appear.
    height, width, _ = delta.shape
    interior = delta[height//20:-height//20, width//20:-width//20]
    changed = int(np.count_nonzero(np.any(interior > 8, axis=2)))
    assert changed > 100, (name, changed)
    results[name] = changed

assert len(results) == 9, results
(output / "pixel-motion.json").write_text(json.dumps(results, indent=2) + "\n")
print(json.dumps(results, indent=2))

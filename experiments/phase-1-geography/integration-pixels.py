"""Measure wind against a stationary geography baseline and between timed frames."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

OUTPUT = Path(__file__).resolve().parents[2] / 'artifacts/phase-1-geography'

def compare(first, second):
    a = np.asarray(Image.open(OUTPUT / (first + '.png')).convert('RGB')).astype(np.int16)
    b = np.asarray(Image.open(OUTPUT / (second + '.png')).convert('RGB')).astype(np.int16)
    assert a.shape == b.shape == (1080, 1920, 3)
    delta = np.abs(a - b)
    return {'first': first, 'second': second,
            'pixels_over_8': int(np.count_nonzero(delta.max(axis=2) > 8)),
            'mean_absolute_rgb_difference': float(delta.mean())}

results = {
    'static_baseline': compare('geography-baseline', 'geography-baseline-2'),
    'visible_wind': compare('geography-baseline', 'wind-frame-1'),
    'animation': compare('wind-frame-1', 'wind-frame-2'),
    'animation_second_interval': compare('wind-frame-2', 'wind-frame-3'),
    'pan_zoom_animation': compare('wind-after-pan-zoom-1', 'wind-after-pan-zoom-2'),
    'forecast_animation': compare('wind-after-forecast-1', 'wind-after-forecast-2'),
}
assert results['static_baseline']['pixels_over_8'] == 0
assert all(v['pixels_over_8'] > 10000 for k, v in results.items() if k != 'static_baseline')
(OUTPUT / 'integration-pixel-audit.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))

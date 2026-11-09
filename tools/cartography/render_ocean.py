#!/usr/bin/env python3
"""Generate water-only depth and relief plates for the Ocean Studio preview."""
import argparse
import json
from pathlib import Path
from time import perf_counter

import numpy as np
from PIL import Image, ImageFilter

from render_relief import ROOT, land_gradient, phase1

DEPTHS = [0, 150, 600, 1600, 3200]
PALETTES = {
    'night': ['#78A8A8', '#326A78', '#16425A', '#0B2A40', '#061625'],
    'day': ['#B6D9CC', '#79B7B0', '#398C9B', '#246383', '#123A59'],
}


def save_plate(image, alpha, path):
    image.putalpha(alpha)
    image.paste((0, 0, 0, 0), mask=alpha.point(lambda value: 255 if value == 0 else 0))
    image.save(path)


def render(elevation_path, output):
    start = perf_counter()
    day = ROOT / 'artifacts/cartography/day'
    metadata = json.loads((day / 'manifest.json').read_text())
    geography = json.loads((ROOT / 'artifacts/phase-1-geography/manifest.json').read_text())
    keys = ('projection', 'projected_bounds', 'image_source_coordinates')
    if any(metadata[key] != geography[key] for key in keys):
        raise ValueError('Day land mask does not match the Phase 1 geography grid.')
    elevation_hash = phase1.sha256(elevation_path)
    if elevation_hash != metadata['sources']['elevation']['sha256']:
        raise ValueError('Use the original GEBCO elevation GeoTIFF from the Day manifest.')
    with phase1.rasterio.open(elevation_path) as source:
        elevation, affine, projected, bounds = phase1.project_elevation(source)
    height, width = elevation.shape
    with Image.open(day / 'land.png') as image:
        land = np.asarray(image.getchannel('A')) > 0
    if land.shape != elevation.shape or list(projected) != metadata['projected_bounds']:
        raise ValueError('Projected elevation does not match the land mask.')

    water = Image.fromarray((~land).astype(np.uint8) * 255)
    # Keep the baked shoreline stroke and taper into the new color on its water side.
    inner = water.filter(ImageFilter.MinFilter(3))
    feather = Image.blend(inner, water.filter(ImageFilter.MinFilter(7)), 0.55)
    depth = np.maximum(-elevation, 0)

    effects = []
    for name in ('shelf', 'texture', 'vignette'):
        with Image.open(day / f'{name}.png') as image:
            if image.size != (width, height):
                raise ValueError(f'Day {name} does not match the geography grid.')
            effects.append(image.convert('RGBA'))

    output.mkdir(parents=True, exist_ok=True)
    for palette, colors in PALETTES.items():
        flat = Image.fromarray(phase1.palette(depth, colors, DEPTHS)).convert('RGBA')
        sculpted = flat.copy()
        for effect in effects:
            sculpted.alpha_composite(effect)
        for theme, image in (('night', flat), ('day', sculpted)):
            save_plate(image, feather, output / f'{theme}-{palette}.png')

    # Use submerged neighbors so GEBCO/GSHHG shoreline differences do not cast halos.
    submerged = ~land & (elevation < 0)
    spacing = affine.a * np.cos(np.deg2rad((bounds[1] + bounds[3]) / 2))
    dy = land_gradient(-depth, submerged, 0, spacing) * 3
    dx = land_gradient(-depth, submerged, 1, spacing) * 3
    neutral = np.sqrt(0.5)
    tone = (neutral + 0.5 * (dx + dy)) / np.sqrt(1 + dx**2 + dy**2) - neutral
    strength = np.clip(np.where(tone < 0, -0.55 * tone, 0.30 * tone), 0, 0.30)
    alpha = np.rint(strength * np.asarray(feather) * submerged).astype(np.uint8)
    relief = Image.fromarray(np.where(tone < 0, 0, 255).astype(np.uint8)).convert('RGBA')
    save_plate(relief, Image.fromarray(alpha), output / 'relief.png')
    print(f'Rendered Ocean Studio plates in {perf_counter() - start:.2f} s.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--elevation', type=Path, required=True, help='Original GEBCO elevation GeoTIFF')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/cartography/ocean')
    args = parser.parse_args()
    render(args.elevation, args.output)

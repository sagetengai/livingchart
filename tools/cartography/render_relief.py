#!/usr/bin/env python3
"""Generate the Studio's grayscale land relief on the Phase 1 grid."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from render import ROOT, phase1


def land_gradient(surface, land, axis, spacing):
    """Use land neighbors only so underwater slopes cannot cast a coastline halo."""
    pad = [(0, 0), (0, 0)]
    pad[axis] = (1, 1)
    values = np.moveaxis(np.pad(surface, pad, mode='edge'), axis, 0)
    mask = np.moveaxis(np.pad(land, pad, mode='constant'), axis, 0)
    low, high = mask[:-2], mask[2:]
    center = values[1:-1]
    delta = np.where(high, values[2:] - center, 0) + np.where(low, center - values[:-2], 0)
    divisor = np.maximum(1, low.astype(np.uint8) + high)
    return np.moveaxis(delta / (divisor * spacing), 0, axis)


def render(elevation_path, output):
    day = ROOT / 'artifacts/cartography/day'
    metadata = json.loads((day / 'manifest.json').read_text())
    geography = json.loads((ROOT / 'artifacts/phase-1-geography/manifest.json').read_text())
    keys = ('projection', 'projected_bounds', 'image_source_coordinates')
    if any(metadata[key] != geography[key] for key in keys):
        raise ValueError('Day land mask does not match the Phase 1 geography grid.')

    with Image.open(day / 'land.png') as image:
        land_image = image.convert('RGBA')
    alpha = np.asarray(land_image.getchannel('A'))
    land = alpha > 0

    elevation_hash = phase1.sha256(elevation_path)
    if elevation_hash != metadata['sources']['elevation']['sha256']:
        raise ValueError('Use the original GEBCO elevation GeoTIFF from the Day manifest.')
    with phase1.rasterio.open(elevation_path) as source:
        elevation, affine, projected, bounds = phase1.project_elevation(source)
    if elevation.shape != land.shape or list(projected) != metadata['projected_bounds']:
        raise ValueError('Projected elevation does not match the land mask.')
    spacing = affine.a * np.cos(np.deg2rad((bounds[1] + bounds[3]) / 2))
    surface = np.maximum(elevation, 0)
    dy = land_gradient(surface, land, 0, spacing) * 1.65
    dx = land_gradient(surface, land, 1, spacing) * 1.65
    neutral = np.sqrt(0.5)
    incidence = (neutral + 0.5 * (dx + dy)) / np.sqrt(1 + dx**2 + dy**2)
    tones = 128 + (incidence - neutral) * 240
    provenance = {'method': 'GEBCO elevation hillshade, northwest light', 'file': elevation_path.name,
                  'sha256': elevation_hash}

    gray = Image.fromarray(np.rint(np.clip(tones, 0, 255)).astype(np.uint8))
    gray.putalpha(land_image.getchannel('A'))
    output.mkdir(parents=True, exist_ok=True)
    asset = phase1.save_png(gray, output / 'land-relief.png')
    (output / 'manifest.json').write_text(json.dumps({
        **{key: metadata[key] for key in (*keys, 'bounds_wsen', 'affine')},
        'elevation': provenance, 'mask': metadata['sources']['coastline'], 'image': asset,
    }, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--elevation', type=Path, required=True, help='Existing GEBCO elevation GeoTIFF')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/cartography/terrain')
    args = parser.parse_args()
    render(args.elevation, args.output)

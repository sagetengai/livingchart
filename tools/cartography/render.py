#!/usr/bin/env python3
"""Render an offline Sculpted Atlas Day Mode preview."""
import argparse
import importlib.util
import json
from pathlib import Path
from time import perf_counter

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    'phase1_geography', ROOT / 'experiments/phase-1-geography/render.py'
)
phase1 = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(phase1)


def shaded_colors(values, surface, pixel_meters, style):
    stops, colors = zip(*style['ramp'])
    pixels = phase1.palette(values, colors, stops)
    shade = style['hillshade']
    dy, dx = np.gradient(surface, pixel_meters)
    dx *= shade['exaggeration']
    dy *= shade['exaggeration']
    norm = np.sqrt(dx * dx + dy * dy + 1)
    lighting = np.ones_like(values)
    weight_sum = sum(light['weight'] for light in shade['lights'])
    for light in shade['lights']:
        azimuth, altitude = np.deg2rad([light['azimuth'], light['altitude']])
        vertical = np.sin(altitude)
        horizontal = np.cos(altitude)
        incidence = (vertical + horizontal * (dy * np.cos(azimuth) - dx * np.sin(azimuth))) / norm
        strength = shade['blend'] * light['weight'] / weight_sum
        lighting += strength * (np.maximum(incidence, 0) - vertical)
    return Image.fromarray(np.clip(pixels * lighting[..., None], 0, 255).astype(np.uint8))


def overlay(size, color, opacity):
    image = Image.new('RGBA', size, color)
    image.putalpha(Image.fromarray(np.rint(255 * opacity).astype(np.uint8)))
    return image


def render(elevation_path, coastline_path, style_path, output):
    start = perf_counter()
    style = json.loads(style_path.read_text())
    with phase1.rasterio.open(elevation_path) as source:
        elevation, affine, projected, bounds = phase1.project_elevation(source)
        source_resolution = list(source.res)

    land, coastline_info = phase1.read_land(coastline_path, bounds)
    is_land = phase1.rasterize_land(land, elevation.shape, affine)
    if not is_land.any() or is_land.all():
        raise ValueError('The coastline must divide the preview into land and water')

    height, width = elevation.shape
    size = width, height
    latitude = (bounds[1] + bounds[3]) / 2
    metric_pixel = affine.a * np.cos(np.deg2rad(latitude))
    land_mask = Image.fromarray(is_land.astype(np.uint8) * 255)
    height_above_sea = np.maximum(elevation, 0)
    land_layer = shaded_colors(height_above_sea, height_above_sea, metric_pixel, style['land'])
    land_layer.putalpha(land_mask)

    depth = np.maximum(-elevation, 0)
    ocean_layer = shaded_colors(depth, -depth, metric_pixel, style['ocean'])
    ocean_layer.putalpha(land_mask.point(lambda value: 255 - value))

    shelf = style['shelf']
    depths, strengths = zip(*shelf['depth_ramp'])
    shelf_opacity = np.interp(depth, depths, strengths)
    shelf_opacity[is_land] = 0
    shelf_layer = overlay(size, shelf['color'], shelf_opacity)

    texture = style['texture']
    scale = texture['scale_pixels']
    rng = np.random.default_rng(texture['seed'])
    noise = rng.integers(0, 256, size=(max(1, height // scale), max(1, width // scale)), dtype=np.uint8)
    paper = np.asarray(Image.fromarray(noise).resize(size, Image.Resampling.BICUBIC))
    grain = (paper.astype(np.float32) - 127.5) / 127.5
    texture_layer = Image.fromarray(np.where(grain > 0, 255, 0).astype(np.uint8)).convert('RGBA')
    texture_layer.putalpha(Image.fromarray(np.rint(np.abs(grain) * texture['strength'] * 255).astype(np.uint8)))

    vignette = style['vignette']
    radius = np.hypot(np.linspace(-1, 1, width), np.linspace(-1, 1, height)[:, None])
    falloff = np.interp(radius, [vignette['start_radius'], vignette['end_radius']], [0, 1])
    vignette_layer = overlay(size, vignette['color'], vignette['opacity'] * falloff**2)

    layers = {
        'ocean': ocean_layer,
        'shelf': shelf_layer,
        'land': land_layer,
        'texture': texture_layer,
        'vignette': vignette_layer,
    }
    composite = Image.new('RGBA', size)
    for layer in layers.values():
        composite.alpha_composite(layer)
    if composite.getchannel('A').getextrema() != (255, 255):
        raise ValueError('The land and ocean layers leave uncovered pixels')

    output.mkdir(parents=True, exist_ok=True)
    records = [phase1.save_png(image, output / f'{name}.png') for name, image in layers.items()]
    records.append(phase1.save_png(composite.convert('RGB'), output / 'day.png'))
    west, south, east, north = bounds
    manifest = {
        'projection': 'EPSG:3857',
        'projected_bounds': projected,
        'bounds_wsen': bounds,
        'affine': list(affine)[:6],
        'image_source_coordinates': [[west, north], [east, north], [east, south], [west, south]],
        'layer_order_bottom_to_top': list(layers),
        'sources': {
            'elevation': {'file': elevation_path.name, 'sha256': phase1.sha256(elevation_path),
                          'resolution_degrees': source_resolution},
            'coastline': {'file': coastline_path.name, 'sha256': phase1.sha256(coastline_path),
                          **coastline_info},
        },
        'style': style,
        'shoreline_disagreement_pixels': int(np.count_nonzero((elevation >= 0) != is_land)),
        'outputs': records,
        'render_seconds': round(perf_counter() - start, 2),
    }
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f"Rendered {output / 'day.png'} in {manifest['render_seconds']:.2f} s")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--elevation', type=Path, required=True, help='GEBCO elevation GeoTIFF')
    parser.add_argument('--coastline', type=Path, required=True, help='GSHHG shapefile ZIP')
    parser.add_argument('--style', type=Path, default=Path(__file__).with_name('style.json'))
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/cartography/day')
    args = parser.parse_args()
    render(args.elevation, args.coastline, args.style, args.output)

#!/usr/bin/env python3
"""Reproducible, offline GEBCO/GSHHG art-direction previews; no app changes."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import platform
import zipfile

import numpy as np
from PIL import Image, ImageFilter, ImageDraw
import PIL
import pyproj
import rasterio
from rasterio.features import rasterize
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling, transform_bounds, transform
import shapefile
import shapely
from shapely.geometry import box, shape, mapping
from shapely.ops import unary_union
from shapely.validation import explain_validity

DEPTHS = [0, 50, 200, 500, 1000, 2000, 3500, 5000]
PALETTES = {
    'deep-navy': ['#264653', '#203c4c', '#183347', '#112b40', '#0d2439', '#0a1d30', '#071728', '#061322'],
    'blue-black': ['#253943', '#20323c', '#192b35', '#14232e', '#101d28', '#0c1721', '#09121b', '#070e16'],
    'muted-teal': ['#38615f', '#2c5356', '#21434c', '#193744', '#122c3c', '#0d2232', '#091a29', '#071522'],
}
LAND = '#1c292d'
COAST = '#667d7d'


def sha256(path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def rgb(value):
    return np.array([int(value[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float32)


def palette(depth, colors, depths=DEPTHS):
    stops = np.array([rgb(c) for c in colors])
    result = np.empty((*depth.shape, 3), dtype=np.uint8)
    for channel in range(3):
        result[..., channel] = np.interp(depth, depths, stops[:, channel]).astype(np.uint8)
    return result


def relief(elevation, pixel_meters, exaggeration=3):
    # Metric slopes; a fixed exaggeration and NW light for every palette.
    dy, dx = np.gradient(elevation, pixel_meters)
    dx *= exaggeration
    dy *= exaggeration
    norm = np.sqrt(dx * dx + dy * dy + 1)
    illumination = (dx * 0.5 + dy * 0.5 + 0.70710678) / norm
    return np.clip(0.82 + 0.26 * illumination, 0.66, 1.08)


def read_land(archive, bounds):
    """Validate original polygons, then clip; preserve lake/island hierarchy."""
    region = box(*bounds)
    masks, inspections = [], []
    with zipfile.ZipFile(archive) as source:
        projection = source.read('GSHHS_shp/h/GSHHS_h_L1.prj').decode()
        if not pyproj.CRS.from_wkt(projection).equals(pyproj.CRS.from_epsg(4326), ignore_axis_order=True):
            raise ValueError('GSHHG is not WGS84')
        for level in range(1, 5):
            name = f'GSHHS_shp/h/GSHHS_h_L{level}'
            reader = shapefile.Reader(shp=io.BytesIO(source.read(name + '.shp')))
            clipped, count = [], 0
            for record in reader.iterShapes(bbox=bounds):
                geom = shape(record.__geo_interface__)
                if not geom.is_valid:
                    raise ValueError(f'{name}, feature {record.oid}: {explain_validity(geom)}')
                count += 1
                part = geom.intersection(region)
                if not part.is_empty:
                    if not part.is_valid:
                        raise ValueError('Clipping produced invalid coastline geometry')
                    clipped.append(part)
            merged = unary_union(clipped)
            if not merged.is_empty:
                masks.append((merged, level % 2))
            inspections.append({'level': level, 'selected_original_features_validated': count,
                                'intersecting_features': len(clipped), 'all_valid': True})
    land = shapely.GeometryCollection()
    for geom, value in masks:
        land = land.union(geom) if value else land.difference(geom)
    if land.is_empty or not land.is_valid:
        raise ValueError('Final land geometry is empty or invalid')
    return land, {'resolution': 'high', 'crs': 'EPSG:4326', 'levels': inspections,
                  'final_valid': True, 'vertex_count': int(shapely.get_num_coordinates(land))}


def projected_crop():
    # Central/southern gulf detail, fully within the downloaded raster.
    west, east, latitude = -114.5, -108.0, 25.5
    x0, yc, x1, _ = transform_bounds('EPSG:4326', 'EPSG:3857', west, latitude, east, latitude)
    half_height = (x1 - x0) * 9 / 16 / 2
    return (x0, yc - half_height, x1, yc + half_height)


def project_elevation(source):
    if source.crs is None or source.crs.to_epsg() != 4326:
        raise ValueError('Expected EPSG:4326 elevation')
    if source.transform.a <= 0 or source.transform.e >= 0 or source.transform.b or source.transform.d:
        raise ValueError('Expected unrotated north-up elevation')
    projected = projected_crop()
    bounds = transform_bounds('EPSG:3857', 'EPSG:4326', *projected)
    if not box(*source.bounds).buffer(1e-9).covers(box(*bounds)):
        raise ValueError('Preview crop exceeds source coverage')
    width, height = 3840, 2160
    affine = from_bounds(*projected, width, height)
    elevation = np.full((height, width), np.nan, dtype=np.float32)
    reproject(rasterio.band(source, 1), elevation, src_nodata=source.nodata,
              dst_transform=affine, dst_crs='EPSG:3857', dst_nodata=np.nan,
              resampling=Resampling.bilinear, num_threads=1)
    if not np.isfinite(elevation).all():
        raise ValueError('Preview contains uncovered/NoData pixels')
    return elevation, affine, projected, bounds


def rasterize_land(land, grid_shape, affine):
    project = pyproj.Transformer.from_crs(4326, 3857, always_xy=True)
    projected = shapely.transform(land, project.transform, interleaved=False)
    return rasterize([(mapping(projected), 1)], out_shape=grid_shape,
                     transform=affine, dtype='uint8').astype(bool)


def save_png(image, path):
    image.save(path)
    width, height = image.size
    return {'file': path.name, 'bytes': path.stat().st_size, 'sha256': sha256(path),
            'width': width, 'height': height, 'decoded_rgba_mib': round(width * height * 4 / 1024**2, 2)}


def render(sources_path, output):
    inventory = json.loads(sources_path.read_text())
    files = inventory['inputs']
    elevation_path = Path(next(x['path'] for x in files if x['path'].endswith('.tif') and '_tid_' not in x['path']))
    tid_path = Path(next(x['path'] for x in files if '_tid_' in x['path']))
    archive = Path(next(x['path'] for x in files if x['path'].endswith('gshhg-shp-2.3.7.zip')))
    # Check all inventoried inputs, including documentation and duplicate archives.
    for item in files:
        if sha256(item['path']) != item['sha256']:
            raise ValueError(f"Source changed: {item['path']}")
    with rasterio.open(elevation_path) as source, rasterio.open(tid_path) as tid:
        if source.crs.to_epsg() != 4326 or source.transform != tid.transform or source.shape != tid.shape or source.crs != tid.crs:
            raise ValueError('Elevation/TID grids must align in EPSG:4326')
        elevation, affine, projected, bounds = project_elevation(source)
    height, width = elevation.shape
    land, coastline_info = read_land(archive, bounds)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'coastline.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'features': [
        {'type': 'Feature', 'properties': {'source': 'GSHHG 2.3.7 high, levels 1–4'}, 'geometry': mapping(land)}
    ]}, separators=(',', ':')) + '\n')
    land_pixels = rasterize_land(land, elevation.shape, affine)
    # Limit the coast stroke to actual shorelines; do not stroke crop boundaries.
    mask_image = Image.fromarray(land_pixels.astype(np.uint8) * 255)
    edge = np.asarray(mask_image.filter(ImageFilter.MaxFilter(3))) != np.asarray(mask_image.filter(ImageFilter.MinFilter(3)))
    depth = np.maximum(-elevation, 0)
    metric_pixel = affine.a * np.cos(np.deg2rad(25.5))
    lighting = relief(elevation, metric_pixel)
    records, thumbnails = [], []
    for name, colors in PALETTES.items():
        pixels = palette(depth, colors)
        for channel in range(3):
            pixels[..., channel] = np.clip(pixels[..., channel] * lighting, 0, 255).astype(np.uint8)
            pixels[..., channel][land_pixels] = np.clip(rgb(LAND)[channel] * (0.96 + 0.04 * lighting[land_pixels]), 0, 255).astype(np.uint8)
            pixels[..., channel][edge] = (pixels[..., channel][edge] * 0.68 + rgb(COAST)[channel] * 0.32).astype(np.uint8)
        image = Image.fromarray(pixels)
        for w, h in [(3840, 2160), (1920, 1080)]:
            path = output / f'{name}-{w}x{h}.png'
            records.append(save_png(image.resize((w, h), Image.Resampling.LANCZOS), path))
        thumbs = image.resize((960, 540), Image.Resampling.LANCZOS)
        thumbnails.append((name, thumbs))
    contact = Image.new('RGB', (960, 3 * 580), '#07121b')
    draw = ImageDraw.Draw(contact)
    for i, (name, thumb) in enumerate(thumbnails):
        draw.text((20, i * 580 + 14), name.replace('-', ' ').upper(), fill='#b6c9cf')
        contact.paste(thumb, (0, i * 580 + 40))
    contact.save(output / 'comparison.jpg', quality=94)
    manifest = {'source_inventory_sha256': sha256(sources_path), 'bounds_wsen': bounds,
                'projected_bounds': projected, 'projection': 'EPSG:3857',
                'image_source_coordinates': [[bounds[0],bounds[3]], [bounds[2],bounds[3]],
                                             [bounds[2],bounds[1]], [bounds[0],bounds[1]]],
                'crop': 'Central/southern Sea of Cortez detail; not full-gulf coverage',
                'source_resolution_arcseconds': 15, 'resampling': 'bilinear elevation; categorical TID never resampled',
                'lighting': {'azimuth_degrees': 315, 'altitude_degrees': 45, 'vertical_exaggeration': 3,
                             'formula': 'clamp(0.82 + 0.26 * Lambert, 0.66, 1.08)'},
                'palettes': PALETTES, 'depth_stops_meters': DEPTHS, 'land': LAND, 'coast': COAST,
                'coastline': coastline_info,
                'shoreline_disagreement': {
                    'elevation_land_but_gshhg_water_pixels': int(np.count_nonzero((elevation >= 0) & ~land_pixels)),
                    'elevation_water_but_gshhg_land_pixels': int(np.count_nonzero((elevation < 0) & land_pixels)),
                    'total_pixels': width * height,
                    'note': 'Independent shoreline definitions; no source data was changed. GSHHG controls visual land.'},
                'versions': {'python': platform.python_version(), 'rasterio': rasterio.__version__,
                             'gdal': rasterio.__gdal_version__, 'numpy': np.__version__, 'Pillow': PIL.__version__,
                             'pyproj': pyproj.__version__, 'shapely': shapely.__version__, 'pyshp': shapefile.__version__},
                'outputs': records}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'bounds': bounds, 'coastline': coastline_info, 'outputs': records}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path(__file__).resolve().parents[2]
    parser.add_argument('--sources', type=Path, default=root / 'data/phase-1-sources.json')
    parser.add_argument('--output', type=Path, default=root / 'artifacts/phase-1-geography')
    args = parser.parse_args()
    render(args.sources, args.output)

"""Download and render a bounded COP30 selection with the existing chart mask."""
import hashlib
import json
import math
import ssl
from pathlib import Path
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

import numpy as np
from PIL import Image
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject, transform_bounds
from shapely.geometry import shape
from shapely.ops import unary_union

from render_relief import ROOT, land_gradient, phase1

ENDPOINT = 'https://portal.opentopography.org/API/globaldem'
DATASETS = {'COP30': {'name': 'Copernicus GLO-30', 'resolution': 30,
                     'max_area_km2': 450000, 'doi': '10.5069/G9028PQB'}}
GEOGRAPHY = ROOT / 'artifacts/phase-1-geography'
FIELDS = ('west', 'south', 'east', 'north')
MAX_TILE_DEGREES = 1
MAX_REGION_SQUARE_DEGREES = 4
CACHE_VERSION = 1
SYSTEM_CA = Path('/etc/ssl/cert.pem')


def tls_context():
    paths = ssl.get_default_verify_paths()
    if paths.cafile is None and paths.capath is None and SYSTEM_CA.is_file():
        return ssl.create_default_context(cafile=SYSTEM_CA)
    return ssl.create_default_context()


class Cancelled(Exception):
    pass


def identify(dataset, bounds, version=CACHE_VERSION):
    return hashlib.sha256(json.dumps([version, dataset, bounds]).encode()).hexdigest()[:24]


def selection(body):
    dataset = body.get('dataset')
    if dataset not in DATASETS:
        raise ValueError('Choose a supported elevation dataset.')
    try:
        raw = [float(body[field]) for field in FIELDS]
    except (KeyError, TypeError, ValueError):
        raise ValueError('Enter four numeric bounds.') from None
    if not all(math.isfinite(value) for value in raw):
        raise ValueError('Bounds must be finite.')
    bounds = tuple(round(value, 6) for value in raw)
    west, south, east, north = bounds
    chart = json.loads((GEOGRAPHY / 'manifest.json').read_text())['bounds_wsen']
    if not (round(chart[0], 6) <= west < east <= round(chart[2], 6)
            and round(chart[1], 6) <= south < north <= round(chart[3], 6)):
        raise ValueError('Select an ordered region inside the existing chart coastline coverage.')
    if (east - west) * (north - south) > MAX_REGION_SQUARE_DEGREES:
        raise ValueError('Select a smaller region (up to 4 square degrees).')
    return dataset, bounds


def tiles(bounds):
    west, south, east, north = bounds
    columns = math.ceil(round(east - west, 6) / MAX_TILE_DEGREES)
    rows = math.ceil(round(north - south, 6) / MAX_TILE_DEGREES)
    xs = [round(west + (east - west) * i / columns, 6) for i in range(columns + 1)]
    ys = [round(south + (north - south) * i / rows, 6) for i in range(rows + 1)]
    return [(x0, y0, x1, y1) for x0, x1 in zip(xs, xs[1:]) for y0, y1 in zip(ys, ys[1:])]


def estimate(dataset, bounds):
    west, south, east, north = bounds
    # OpenTopography delivers COP30 on a one arc-second grid here. Compression varies.
    cells = math.ceil((east - west) * 3600) * math.ceil((north - south) * 3600)
    return {'tiles': len(tiles(bounds)), 'estimatedBytes': cells * 4,
            'resolution': DATASETS[dataset]['resolution']}


def validate_tiff(path, bounds):
    with phase1.rasterio.open(path) as dem:
        if (dem.driver != 'GTiff' or dem.count != 1 or dem.crs is None or
                dem.width < 2 or dem.height < 2 or min(dem.res) <= 0):
            raise ValueError('The response is not a georeferenced elevation GeoTIFF.')
        footprint = transform_bounds(dem.crs, 'EPSG:4326', *dem.bounds)
        if any(abs(a - b) > 0.002 for a, b in zip(footprint, bounds)):
            raise ValueError('The GeoTIFF footprint does not match the requested tile.')
        for _, window in dem.block_windows():
            dem.read(1, window=window)
        return {'crs': dem.crs.to_string(), 'pixel_size': list(dem.res), 'bytes': path.stat().st_size}


def cancelled(stop):
    if stop.is_set():
        raise Cancelled()


def reserve_call(root):
    ledger = root / 'cache' / 'opentopo-calls.json'
    ledger.parent.mkdir(parents=True, exist_ok=True)
    now = time.time()
    calls = [stamp for stamp in json.loads(ledger.read_text()) if stamp > now - 86400] if ledger.exists() else []
    if len(calls) >= 50:
        raise ValueError('The local OpenTopography limit of 50 calls per 24 hours has been reached.')
    temporary = ledger.with_suffix('.tmp')
    temporary.write_text(json.dumps([*calls, now]))
    temporary.replace(ledger)


def download_tile(root, dataset, bounds, key, stop, progress):
    folder = root / 'sources' / 'opentopography' / dataset
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (identify(dataset, bounds) + '.tif')
    meta = path.with_suffix('.json')
    if path.exists():
        info = validate_tiff(path, bounds)
        if not meta.exists():
            meta.write_text(json.dumps({'dataset': dataset, 'bounds': bounds, 'source': ENDPOINT,
                                        **DATASETS[dataset], **info}, indent=2))
        return path, True
    if not key:
        raise ValueError('Set OPENTOPO_API_KEY before downloading uncached data.')
    params = dict(zip(FIELDS, bounds), demtype=dataset, outputFormat='GTiff', API_Key=key)
    url = ENDPOINT + '?' + urlencode(params)
    for attempt in range(3):
        cancelled(stop)
        reserve_call(root)
        temp = None
        try:
            with tempfile.NamedTemporaryFile(dir=folder, suffix='.part', delete=False) as target:
                temp = Path(target.name)
                with urlopen(url, timeout=25, context=tls_context()) as response:
                    total = int(response.headers.get('Content-Length') or 0)
                    received = 0
                    while chunk := response.read(256 * 1024):
                        cancelled(stop)
                        received += len(chunk)
                        if received > 128 * 1024**2:
                            raise ValueError('The DEM response exceeds the local tile size limit.')
                        target.write(chunk)
                        progress(received, total)
            if not received or (total and received != total):
                raise OSError('Incomplete download')
            try:
                info = validate_tiff(temp, bounds)
            except (ValueError, OSError, phase1.rasterio.errors.RasterioError):
                raise ValueError('OpenTopography returned an invalid elevation GeoTIFF.') from None
            cancelled(stop)
            temp.replace(path)
            meta.write_text(json.dumps({'dataset': dataset, 'bounds': bounds, 'source': ENDPOINT,
                                        **DATASETS[dataset], **info}, indent=2))
            return path, False
        except HTTPError as error:
            if error.code in (401, 403):
                raise ValueError('OpenTopography rejected the API key or account permissions.') from None
            if error.code == 429:
                raise ValueError('OpenTopography rate limit reached. Try again after the quota resets.') from None
            if error.code not in (408, 500, 502, 503, 504):
                raise ValueError(f'OpenTopography rejected the request (HTTP {error.code}).') from None
        except URLError as error:
            if isinstance(error.reason, ssl.SSLCertVerificationError):
                raise ValueError('TLS certificate verification failed. Check the Python CA configuration.') from None
        except (TimeoutError, OSError):
            pass
        finally:
            if temp is not None:
                temp.unlink(missing_ok=True)
        if attempt < 2 and stop.wait(2 ** attempt):
            raise Cancelled()
    raise ValueError('OpenTopography download failed after three attempts. Check connectivity and try again.')


def render_region(root, dataset, bounds, paths, stop):
    destination = root / 'renders' / 'terrain' / identify(dataset, bounds)
    projected = transform_bounds('EPSG:4326', 'EPSG:3857', *bounds)
    west, south, east, north = bounds
    width_m, height_m = projected[2] - projected[0], projected[3] - projected[1]
    scale = max(30 / math.cos(math.radians((south + north) / 2)), max(width_m, height_m) / 4096)
    width, height = max(2, round(width_m / scale)), max(2, round(height_m / scale))
    transform = from_bounds(*projected, width, height)
    elevation = np.full((height, width), np.nan, dtype=np.float32)
    for path in paths:
        cancelled(stop)
        with phase1.rasterio.open(path) as source:
            reproject(phase1.rasterio.band(source, 1), elevation, dst_transform=transform,
                      dst_crs='EPSG:3857', dst_nodata=np.nan, init_dest_nodata=False,
                      resampling=Resampling.bilinear)
    coast_path = GEOGRAPHY / 'coastline.geojson'
    coast = json.loads(coast_path.read_text())
    land = phase1.rasterize_land(unary_union([shape(f['geometry']) for f in coast['features']]),
                                elevation.shape, transform)
    land &= np.isfinite(elevation)
    if not land.any():
        raise ValueError('The selected DEM contains no valid land within the chart mask.')
    cancelled(stop)
    surface = np.where(land, elevation, 0)
    latitude_scale = math.cos(math.radians((south + north) / 2))
    dx = land_gradient(surface, land, 1, transform.a * latitude_scale) * 1.65
    dy = land_gradient(surface, land, 0, -transform.e * latitude_scale) * 1.65
    neutral = math.sqrt(0.5)
    incidence = (neutral + 0.5 * (dx + dy)) / np.sqrt(1 + dx**2 + dy**2)
    gray = Image.fromarray(np.rint(np.clip(128 + (incidence - neutral) * 240, 0, 255)).astype(np.uint8))
    alpha = Image.fromarray(land.astype(np.uint8) * 255)
    gray.putalpha(alpha)
    ratio = min(1, 1200 / max(width, height))
    preview_size = (max(1, round(width * ratio)), max(1, round(height * ratio)))
    preview = gray.resize(preview_size, Image.Resampling.BOX)
    # Nearest land classification keeps downsampled coastal water transparent.
    preview.putalpha(alpha.resize(preview_size, Image.Resampling.NEAREST))
    cancelled(stop)
    destination.mkdir(parents=True, exist_ok=True)
    for name, image in [('relief.png', gray), ('preview.png', preview)]:
        temp = destination / (name + '.tmp')
        image.save(temp, format='PNG')
        temp.replace(destination / name)
    manifest = {'dataset': dataset, 'bounds': bounds, 'projection': 'EPSG:3857',
                'coordinates': [[west, north], [east, north], [east, south], [west, south]],
                'projectedBounds': projected, 'transform': list(transform)[:6],
                'resolution': DATASETS[dataset]['resolution'], 'width': width, 'height': height,
                'previewSize': preview_size, 'mask': 'Phase 1 GSHHG high',
                'maskSha256': phase1.sha256(coast_path), 'source': ENDPOINT,
                'doi': DATASETS[dataset]['doi'], 'sourceBytes': sum(p.stat().st_size for p in paths)}
    temp = destination / 'manifest.tmp'
    temp.write_text(json.dumps(manifest, indent=2))
    temp.replace(destination / 'manifest.json')
    return manifest

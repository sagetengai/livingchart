"""Local-only Elevation Data backend. Run with the existing Rasterio environment."""
import fcntl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
from threading import Event, Lock, Thread
from urllib.parse import urlsplit

from opentopo import (DATASETS, GEOGRAPHY, ROOT, Cancelled, cancelled,
                      download_tile, estimate, identify, render_region, selection, tiles)

PREFIX = '/__elevation'
ACTIVE = ('queued', 'downloading', 'processing', 'cancelling')


def configuration():
    values = {}
    for filename in ('.env', '.env.local'):
        path = ROOT / filename
        if path.is_file():
            for line in path.read_text().splitlines():
                name, _, value = line.partition('=')
                name = name.strip()
                if name in ('OPENTOPO_API_KEY', 'LIVINGCHART_DATA_DIR'):
                    values[name] = value.strip().strip('"\'')
    key = os.environ.get('OPENTOPO_API_KEY', values.get('OPENTOPO_API_KEY', '')).strip()
    location = os.environ.get('LIVINGCHART_DATA_DIR', values.get('LIVINGCHART_DATA_DIR', ''))
    root = Path(location).expanduser()
    return key, root.resolve() if root.is_absolute() and root.is_dir() else None


class Manager:
    def __init__(self):
        self.lock = Lock()
        self.job = None
        self.stop = None
        self.authenticated = False

    def status(self):
        key, root = configuration()
        with self.lock:
            return {'keyConfigured': bool(key), 'storageConfigured': root is not None,
                    'authenticated': self.authenticated, 'datasets': DATASETS,
                    'chartBounds': json.loads((GEOGRAPHY / 'manifest.json').read_text())['bounds_wsen'],
                    'job': self.job}

    def update(self, **changes):
        with self.lock:
            self.job = {**self.job, **changes}

    def start(self, dataset, bounds):
        key, root = configuration()
        if root is None:
            raise ValueError('Set LIVINGCHART_DATA_DIR to an existing absolute directory.')
        ident = identify(dataset, bounds)
        with self.lock:
            if self.job and self.job['state'] in ACTIVE:
                if self.job['id'] == ident:
                    return self.job
                raise ValueError('Finish or cancel the current elevation job first.')
            self.stop = Event()
            self.job = {'id': ident, 'state': 'queued', 'tiles': len(tiles(bounds)),
                        'bounds': bounds, 'dataset': dataset, 'complete': 0, 'cached': 0}
            Thread(target=self.run, args=(root, key, dataset, bounds, ident, self.stop), daemon=True).start()
            return self.job

    def cancel(self):
        with self.lock:
            if self.job and self.job['state'] in ACTIVE:
                self.stop.set()
                self.job = {**self.job, 'state': 'cancelling'}
            return self.job

    def run(self, root, key, dataset, bounds, ident, stop):
        try:
            cache = root / 'cache'
            cache.mkdir(parents=True, exist_ok=True)
            with (cache / 'opentopo.lock').open('a') as lock:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise ValueError('Another elevation job is using this data library.') from None
                paths = []
                cached = 0
                for bounds_tile in tiles(bounds):
                    cancelled(stop)
                    self.update(state='downloading', received=0, total=0)
                    path, hit = download_tile(root, dataset, bounds_tile, key, stop,
                                              lambda received, total: self.update(received=received, total=total))
                    if not hit:
                        with self.lock:
                            self.authenticated = True
                    paths.append(path)
                    cached += int(hit)
                    self.update(complete=len(paths), cached=cached)
                cancelled(stop)
                self.update(state='processing')
                folder = root / 'renders' / 'terrain' / ident
                manifest_path = folder / 'manifest.json'
                manifest = None
                if all((folder / name).is_file() for name in ('manifest.json', 'preview.png', 'relief.png')):
                    manifest = json.loads(manifest_path.read_text())
                if manifest is None:
                    manifest = render_region(root, dataset, bounds, paths, stop)
                cancelled(stop)
                self.update(state='ready', result={**manifest, 'url': f'{PREFIX}/preview/{ident}.png'})
        except Cancelled:
            self.update(state='cancelled')
        except ValueError as error:
            self.update(state='error', error=str(error))
        except OSError:
            self.update(state='error', error='Could not read or write the data library. Check its mount, permissions and free space.')
        except Exception:
            self.update(state='error', error='Could not process the elevation raster. Check the source and chart assets.')


manager = Manager()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def respond(self, status, payload, mime='application/json'):
        data = json.dumps(payload).encode() if mime == 'application/json' else payload
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        # Browser requests enter through the Vite localhost proxy, which sets this header.
        if self.headers.get('X-LivingChart-Local') != 'elevation':
            self.respond(403, {'error': 'Use the local Living Chart preview.'})
            return False
        return True

    def do_GET(self):
        if not self.authorized():
            return
        path = urlsplit(self.path).path
        try:
            if path == PREFIX + '/status':
                self.respond(200, manager.status())
                return
            match = re.fullmatch(PREFIX + r'/preview/([0-9a-f]{24})\.png', path)
            _, root = configuration()
            if match and root:
                image = root / 'renders' / 'terrain' / match[1] / 'preview.png'
                if image.is_file():
                    self.respond(200, image.read_bytes(), 'image/png')
                    return
            self.respond(404, {'error': 'Elevation result is unavailable.'})
        except OSError:
            self.respond(503, {'error': 'The chart assets or elevation storage are unavailable.'})

    def do_POST(self):
        if not self.authorized():
            return
        try:
            path = urlsplit(self.path).path
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 4096 or self.headers.get_content_type() != 'application/json':
                raise ValueError('Send a small JSON request.')
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValueError('Send a JSON object.')
            if path == PREFIX + '/cancel':
                self.respond(200, manager.cancel())
                return
            dataset, bounds = selection(body)
            if path == PREFIX + '/estimate':
                _, root = configuration()
                folder = root / 'sources' / 'opentopography' / dataset if root else None
                cached = sum((folder / (identify(dataset, tile) + '.tif')).is_file() for tile in tiles(bounds)) if folder else 0
                self.respond(200, {**estimate(dataset, bounds), 'bounds': bounds, 'cached': cached})
            elif path == PREFIX + '/download':
                self.respond(202, manager.start(dataset, bounds))
            else:
                self.respond(404, {'error': 'Unknown elevation operation.'})
        except (ValueError, TypeError) as error:
            self.respond(400, {'error': str(error)})
        except OSError:
            self.respond(503, {'error': 'The chart assets or elevation storage are unavailable.'})


if __name__ == '__main__':
    with ThreadingHTTPServer(('127.0.0.1', 18196), Handler) as server:
        print('Elevation backend listening on 127.0.0.1:18196', flush=True)
        server.serve_forever()

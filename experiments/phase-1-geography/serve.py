"""Loopback-only preview; reuse an installed MapLibre distribution without npm install."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--maplibre-dir', type=Path, required=True)
parser.add_argument('--port', type=int, default=8091)
args = parser.parse_args()
vendor = args.maplibre_dir.resolve()
if not (vendor/'maplibre-gl.mjs').is_file():
    parser.error('MapLibre distribution missing')


class PreviewHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        clean = urlsplit(path).path
        if clean.startswith('/vendor/'):
            name = clean.removeprefix('/vendor/')
            if '/' in name or name in {'.','..',''}:
                return str(vendor/'not-found')
            return str(vendor/name)
        return super().translate_path(path)

root = Path(__file__).resolve().parents[2]
handler = partial(PreviewHandler, directory=str(root))
print(f'http://127.0.0.1:{args.port}/experiments/phase-1-geography/preview.html', flush=True)
ThreadingHTTPServer(('127.0.0.1',args.port),handler).serve_forever()

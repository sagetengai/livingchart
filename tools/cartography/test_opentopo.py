import io
import json
from pathlib import Path
import tempfile
from threading import Event
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

import numpy as np
from rasterio.transform import from_bounds
from PIL import Image

import opentopo


class ElevationTest(unittest.TestCase):
    bounds = (-111.6, 24.0, -110.7, 24.8)

    def test_validate_and_chunk_selection(self):
        dataset, bounds = opentopo.selection(dict(zip(opentopo.FIELDS, self.bounds), dataset='COP30'))
        self.assertEqual(bounds, self.bounds)
        self.assertEqual(opentopo.estimate(dataset, bounds)['tiles'], 1)
        parts = opentopo.tiles((-112.0, 24, -110.0, 25.5))
        self.assertEqual(len(parts), 4)
        self.assertAlmostEqual(sum((e-w)*(n-s) for w,s,e,n in parts), 3)
        for invalid in ((-180, 24, -110, 24.8), (-111.6, 25, -110.7, 24.8)):
            with self.assertRaises(ValueError):
                opentopo.selection(dict(zip(opentopo.FIELDS, invalid), dataset='COP30'))

    def test_download_retry_then_cache_and_land_relief(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            tif = root / 'response.tif'
            with opentopo.phase1.rasterio.open(tif, 'w', driver='GTiff', width=40, height=40,
                    count=1, dtype='float32', crs='EPSG:4326',
                    transform=from_bounds(*self.bounds, 40, 40)) as raster:
                raster.write(np.arange(1600, dtype='float32').reshape(40, 40), 1)
            payload = tif.read_bytes()
            response = io.BytesIO(payload)
            response.headers = {'Content-Length': str(len(payload))}
            stop = Event()
            with patch.object(stop, 'wait', return_value=False), patch.object(opentopo, 'urlopen',
                    side_effect=[HTTPError('', 503, '', {}, None), response]) as fetch:
                path, reused = opentopo.download_tile(root, 'COP30', self.bounds, 'test', stop, lambda *_: None)
                self.assertFalse(reused)
                self.assertEqual(fetch.call_count, 2)
                self.assertEqual(opentopo.download_tile(root, 'COP30', self.bounds, '', stop, lambda *_: None),
                                 (path, True))
                self.assertEqual(fetch.call_count, 2)
            self.assertEqual(path.read_bytes(), payload)
            self.assertNotIn('API_Key', path.with_suffix('.json').read_text())
            result = opentopo.render_region(root, 'COP30', self.bounds, [path], stop)
            target = root / 'renders' / 'terrain' / opentopo.identify('COP30', self.bounds)
            with Image.open(target / 'preview.png') as preview:
                alpha = np.asarray(preview.getchannel('A'))
                self.assertEqual(set(np.unique(alpha)), {0, 255})
                self.assertLessEqual(max(preview.size), 1200)
            self.assertEqual(json.loads((target / 'manifest.json').read_text())['projection'], 'EPSG:3857')
            self.assertGreater(result['width'], 1200)

    def test_cancel_before_request(self):
        with tempfile.TemporaryDirectory() as folder:
            stop = Event()
            stop.set()
            with patch.object(opentopo, 'urlopen') as fetch, self.assertRaises(opentopo.Cancelled):
                opentopo.download_tile(Path(folder), 'COP30', self.bounds, 'test', stop, lambda *_: None)
            fetch.assert_not_called()


if __name__ == '__main__':
    unittest.main()

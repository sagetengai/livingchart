import tempfile
import unittest
import zipfile
from pathlib import Path
import numpy as np
import shapefile
from render import palette, PALETTES, DEPTHS, rgb, relief, projected_crop, read_land


class GeographyChecks(unittest.TestCase):
    def test_depth_stops_and_clamping(self):
        for colors in PALETTES.values():
            values = palette(np.array([[-10, *DEPTHS, 9000]]), colors)[0]
            np.testing.assert_array_equal(values[0], rgb(colors[0]))
            np.testing.assert_array_equal(values[-1], rgb(colors[-1]))
            np.testing.assert_array_equal(values[1:-1], [rgb(c) for c in colors])

    def test_northwest_light_and_metric_slope(self):
        east_rise = np.tile(np.arange(4, dtype=np.float32), (4, 1))
        self.assertTrue((relief(east_rise, 1) > relief(-east_rise, 1)).all())
        flat = relief(np.zeros((4, 4), dtype=np.float32), 100)
        np.testing.assert_allclose(flat, 0.82 + 0.26 * 2**-0.5, rtol=1e-6)
        w, s, e, n = projected_crop()
        self.assertAlmostEqual((e-w)/(n-s), 16/9)

    def test_lakes_and_islands_survive_clipping(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / 'coast.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('GSHHS_shp/h/GSHHS_h_L1.prj', 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]')
                for level, (lo, hi) in enumerate([(0,10),(2,8),(4,6),(4.5,5.5)], 1):
                    path = root / str(level)
                    with shapefile.Writer(str(path), shapeType=5) as writer:
                        writer.field('id', 'N')
                        writer.poly([[(lo,lo),(lo,hi),(hi,hi),(hi,lo),(lo,lo)]])
                        writer.record(level)
                    z.write(path.with_suffix('.shp'), f'GSHHS_shp/h/GSHHS_h_L{level}.shp')
            land, report = read_land(archive, (1,1,9,9))
            self.assertAlmostEqual(land.area, 64 - 36 + 4 - 1)
            self.assertTrue(report['final_valid'])


if __name__ == '__main__':
    unittest.main()

"""Inventory read-only source files and inspect full, native-resolution rasters."""
import argparse
import json
from pathlib import Path
import hashlib
import numpy as np
import rasterio


def inventory(root, output):
    items = []
    for path in sorted(root.rglob('*')):
        if not path.is_file() or path.suffix not in {'.tif', '.pdf', '.zip'}:
            continue
        with path.open('rb') as handle:
            digest = hashlib.file_digest(handle, 'sha256').hexdigest()
        item = {'path': str(path.resolve()), 'bytes': path.stat().st_size, 'sha256': digest}
        if path.suffix == '.tif':
            with rasterio.open(path) as source:
                values = source.read(1, masked=True)
                item['raster'] = {
                    'crs': str(source.crs), 'bounds': list(source.bounds),
                    'shape': [source.height, source.width], 'transform': list(source.transform)[:6],
                    'resolution': source.res, 'dtype': source.dtypes[0], 'nodata': source.nodata,
                    'valid_count': int(values.count()), 'min': float(values.min()), 'max': float(values.max())}
                if '_tid_' in path.name:
                    item['raster']['categories'] = [int(v) for v in np.unique(values.compressed())]
        items.append(item)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({'inputs': items, 'note': 'Source files are read-only, outside the Git repository. TID categories are never interpolated.'}, indent=2) + '\n')
    print(f'Inventoried {len(items)} files')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_directory', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[2] / 'data/phase-1-sources.json')
    args = parser.parse_args()
    inventory(args.source_directory, args.output)

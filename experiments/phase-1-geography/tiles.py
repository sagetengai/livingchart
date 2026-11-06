"""Build one disposable XYZ comparison pyramid from the approved preview crop."""
import argparse
import json
import math
from pathlib import Path
from PIL import Image


def build(output):
    metadata = json.loads((output / 'manifest.json').read_text())
    left, bottom, right, top = metadata['projected_bounds']
    image = Image.open(output / 'deep-navy-3840x2160.png').convert('RGBA')
    half_world = math.pi * 6378137
    records = []
    for zoom in range(5, 10):
        span = 2 * half_world / 2**zoom
        x0, x1 = math.floor((left + half_world)/span), math.floor((right + half_world)/span)
        y0, y1 = math.floor((half_world-top)/span), math.floor((half_world-bottom)/span)
        for x in range(x0, x1+1):
            for y in range(y0, y1+1):
                west, north = x*span-half_world, half_world-y*span
                extent = ((west-left)/(right-left)*image.width, (top-north)/(top-bottom)*image.height,
                          (west+span-left)/(right-left)*image.width, (top-north+span)/(top-bottom)*image.height)
                tile = image.transform((256,256), Image.Transform.EXTENT, extent,
                                       Image.Resampling.BILINEAR, fillcolor=(0,0,0,0))
                path = output / f'tiles/{zoom}/{x}/{y}.png'
                path.parent.mkdir(parents=True, exist_ok=True)
                tile.save(path)
                records.append({'file': str(path.relative_to(output)), 'bytes': path.stat().st_size})
    (output/'tile-manifest.json').write_text(json.dumps({
        'palette': 'deep-navy', 'minzoom':5, 'maxzoom':9, 'tile_size':256,
        'bounds_wsen': metadata['bounds_wsen'], 'count':len(records),
        'total_bytes':sum(r['bytes'] for r in records), 'tiles':records}, indent=2)+'\n')
    print(f"{len(records)} tiles; {sum(r['bytes'] for r in records)} bytes")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[2]/'artifacts/phase-1-geography')
    build(parser.parse_args().output)

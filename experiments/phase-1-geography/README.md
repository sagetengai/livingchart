# Phase 1 geography experiments

Offline art-direction studies from actual GEBCO 2026 elevation and GSHHG 2.3.7 coastline. The standalone geography study is complete. An opt-in application integration is now available; see [INTEGRATION.md](INTEGRATION.md) for the combined wind preview and verification. Renderer source and deployment settings remain unchanged.

## Run from the LivingChart repository root

The approved `.venv-phase1` uses existing system-site rasterio, NumPy, Pillow and PyProj, plus project-local Shapely 2.2.0 and PyShp 3.1.6. Exact versions used are in the generated manifest. No JavaScript dependencies were installed. The old prototype dependency tree is preserved with the onboarding backup and supplies Playwright for verification. The integrated app reuses existing compatible workstation dependencies through local symlinks; no packages were installed.

```sh
.venv-phase1/bin/python -B experiments/phase-1-geography/inventory.py "/Users/sage/Desktop/Nautical Living Charts/Charts"
.venv-phase1/bin/python -B -m unittest discover -s experiments/phase-1-geography -p 'test_*.py'
.venv-phase1/bin/python -B experiments/phase-1-geography/render.py
.venv-phase1/bin/python -B experiments/phase-1-geography/tiles.py
```

`inventory.py` creates `data/phase-1-sources.json`. It hashes the original rasters, archives and supplied PDFs, and measures rasters at native resolution. `render.py` rechecks every input hash before processing, validates aligned north-up EPSG:4326 elevation/TID grids, and fails on uncovered pixels or invalid coastline polygons. Original files are never modified. The inventory records absolute source locations for this workstation; pass another source directory to regenerate it elsewhere.

An environment can be recreated with Python 3.13 and the versions in `artifacts/phase-1-geography/manifest.json`. Creating a new environment or installing packages remains a separate explicit action. The current environment inherits existing workstation libraries; it is not a fully isolated dependency lock.

## What the previews show

- Fixed central/southern gulf detail: 114.5°W–108°W, approximately 23.839°N–27.139°N. This is not full-gulf coverage. A fixed Web Mercator 16:9 crop preserves geographic proportions.
- Three palettes share depth stops, lighting, land, coastline, source grid, and bounds. Stops are 0, 50, 200, 500, 1000, 2000, 3500 and 5000 metres.
- Numeric elevation is bilinearly reprojected to 4K. Full HD is downsampled from that result. Upsampling does not create detail beyond the original 15-arc-second grid.
- NW light at 45° altitude, vertical exaggeration 3, metric slope at the crop's central latitude, restrained Lambert shading. The central-latitude metric correction is a regional approximation.
- High-resolution GSHHG land/lake/island levels 1–4 are validated before clipping and combined in hierarchy order. No automatic geometry repair or smoothing. 266 selected original features and the final clipped geometry passed GEOS validity checks.
- GSHHG defines visual land; GEBCO controls water depth. Their shoreline disagreement is 0.766% of 4K pixels. Positive elevation under GSHHG water is displayed at the shallowest depth color, not converted into artificial negative elevation. Both mismatch counts are in the manifest.
- TID is preserved as categorical provenance. It is not interpolated or interpreted as depth/confidence, and this first palette comparison does not visually encode TID classes.

Outputs in ignored `artifacts/phase-1-geography/`: six full-resolution PNGs, `comparison.jpg`, clipped `coastline.geojson`, parameters/checksums/version manifest, navy XYZ comparison tiles, browser captures and reports, and repeat-render checksum evidence. No wind, clouds, labels or product controls are baked into the images.

## Isolated MapLibre preview

Reuse an existing MapLibre distribution; this server does not install anything. On this workstation:

```sh
python3 -B experiments/phase-1-geography/serve.py --maplibre-dir "/Users/sage/Development/copilot-worktrees/mapbox-exif-layer/sagetengai-potential-giggle/maplibre-gl-demo/sea-of-cortez/node_modules/maplibre-gl/dist"
```

Open <http://127.0.0.1:8091/experiments/phase-1-geography/preview.html>. It is loopback-only and uses no external basemap or imagery requests. Change palette, compare the navy image with XYZ tiles, and reset bounds. The navy-only tile experiment disables the palette selector. All images are experimental, not production-approved.

To rerun the headless check with the preserved Playwright installation:

```sh
node experiments/phase-1-geography/audit.mjs "/Users/sage/Desktop/Nautical Living Charts/artifacts/onboarding-backup/20261105T210936Z/node_modules/playwright"
```

The server must be running. Capture sizes are 1920×1080 and 3840×2160 at DPR 1 with the same bounds, no animation and no random seed requirement. The audit waits for MapLibre `idle`, records console/network/map/GL errors, exercises controls, and writes screenshots. It is a smoke/visual check, not a native GPU benchmark. MapLibre distribution used: 6.16.0; Playwright: 1.64.1; Chromium: SwiftShader.

## Integration evaluation

| Method | Measured local result | Implication |
|---|---|---|
| Regional navy image | 2,158,745 bytes; 1 image request; 31.64 MiB decoded RGBA at 4K | Recommended starting point for one fixed wall-display region |
| Navy XYZ pyramid | 109 generated tiles, zoom 5–9, 1,905,812 bytes total | More assets; useful for broader coverage or zoom-dependent loading |
| Visible tiled crop | 70 tile requests, about 1.205 MB payload at each tested viewport | Lower bytes here, many more requests; no native GPU conclusion |

Counts above exclude the common manifest request. The browser report includes it. Local readiness measurements are single-run smoke-test diagnostics with warm OS/server caches, not robust performance comparisons. Screenshot image-vs-tile mean RGB absolute differences were below 0.25 on a 0–255 channel scale at both sizes; the tiled source is a lower-resolution resampling and not pixel-identical.

The image source is already georeferenced in EPSG:3857. Use the manifest's NW/NE/SE/SW corner coordinates with a MapLibre `image` source and an opaque `raster` layer. Keep it below independent clouds and wind, and avoid double-rendering a basemap over it. The experimental viewer demonstrates this without changing `src/App.jsx`. XYZ tiles are an evaluation export, not a committed hosting or production integration decision. Source resolution, texture limits on target hardware, full-gulf framing, and zoom requirements should determine the eventual method.

References: [Rasterio reprojection](https://rasterio.readthedocs.io/en/stable/topics/reproject.html), [MapLibre image source](https://maplibre.org/maplibre-style-spec/sources/#image).

## Provenance, preservation and next decision

GEBCO 2026 elevation/TID and supplied GEBCO documentation remain under the Desktop `Charts` directory; GSHHG 2.3.7 source archives include their README and license. Retain GEBCO and GSHHG attribution and review the supplied terms before distribution. This work does not reinterpret the obsolete prototype README's GEBCO 2024 license statement.

The original checkout was backed up to `/Users/sage/Desktop/Nautical Living Charts/artifacts/onboarding-backup/20261105T210936Z/`. Local package/audit changes are also in the Git stash labeled `Before approved Phase 1 geography: preserve audit and dependency changes`. The old `node_modules` directory is in that backup. Do not blindly apply the old package changes over the newer app manifest.

Current base: `27ddc91a15a91877fcdfe1a5f767e63f4b53a119`; experiment branch: `codex/phase-1-geography`. No commits or pushes were made. Choose a palette, shoreline contrast and framing before production geography integration. Phase 2 wind work has not begun.

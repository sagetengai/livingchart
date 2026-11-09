# Phase 1 bathymetry + existing wind

Ready for local visual review at **http://127.0.0.1:8092/?geography=1**.

The top controls switch between Original Living Chart, Bathymetry + wind, and Geography only. Three palettes are available. All modes share one MapLibre map and preserve its camera when switching. Initial framing is the Phase 1 crop, centered at 111.25°W, 25.5°N; at 1920×1080 the zoom is 7.6983. Pan/zoom is constrained to that crop's coverage. The original application is also available at http://127.0.0.1:8092/ without the experimental controls or geography.

## Implementation

`src/App.jsx` mounts `IntegratedGeography.jsx` only when `?geography=1` is present and the default wind renderer is selected. The component reuses the existing map, wind layer, decoded grid, and forecast controls. It adds the 4K Phase 1 image at the exact NW/NE/SE/SW coordinates in the manifest, plus the matching GSHHG polygon land mask. No independent map or new forecast pipeline is created.

In custom modes the original basemap, low-opacity GEBCO WMS, Natural Earth land/coast, labels, and GOES clouds are hidden. The visible order is **Phase 1 bathymetry → existing wind → matching GSHHG land**. The opaque raster cannot cover the wind; land hides trails over the coastline used by the bathymetry. Original mode restores the original layers and their visibility. Geography-only disables the existing layer's display, and switching back resumes it.

Production default is `NewParticleMotion`; `FeedbackWindLayer` is an existing opt-in via `?windRenderer=feedback`. This comparison deliberately uses the default. Original App ordering places the WMS raster and GOES imagery below the wind and land/coast above it, before the first symbol layer. No renderer source or particle parameters were changed. Existing trails are instanced fading points extending upwind, not the proposed Phase 2 tapered trail redesign.

The original data path remains: GFS `status.json` → selected `wind_YYYYMMDDHH.jpeg` → EXIF U/V ranges and decoded red/green channels in `fetchWindGrid` → existing water-mask blue channel and JPEG re-encoding → `setWindSource(grid.source)`. The renderer decodes this texture, converts m/s to internal mph, advances normalized geographic positions through transform feedback, projects through MapLibre, and alpha-blends points into the map framebuffer. Positive U is eastward; positive V is northward. The readout reports meteorological wind-from direction. The motion retains its original visual time scale, not real-time air-parcel travel.

## Verification, 2026-11-05

Playwright Chromium, 1920×1080, DPR 1. All screenshots and JSON reports are in `artifacts/phase-1-geography/`.

- Real GFS status and 22:00/23:00 UTC forecast JPEG requests returned HTTP 200. No synthetic fallback; 1440×721 global grid with finite EXIF U/V ranges. Initial U range −25.614 to 30.646 m/s and V −21.900 to 36.070 m/s.
- 3,640 active particle slots. Instrumented existing instance methods counted 722 wind draw submissions and 512 completed buffer swaps by the end. The initial source loaded before instrumentation; a subsequent forecast load was observed explicitly.
- One actual GPU update compared 3,342 non-reset particles with CPU nearest-cell U/V. 99.22% moved in the positive vector direction; median directional cosine 0.9959; median displacement/predicted-speed ratio 0.9819. GPU filtering, JPEG re-encoding, nearest-cell sampling and coastline masking account for small differences; this is a consistency check, not exact bitwise equivalence.
- Geography-only screenshots separated in time were pixel-identical. With the same camera and palette, wind changed 86,224 pixels by more than 8/255 in at least one RGB channel. Successive timed wind frames changed 162,419 and 162,278 pixels. This isolates visible wind from the stationary background and controls.
- After animated pan/zoom to 110.65°W, 25.65°N, zoom 8.3, timed frames changed 150,405 pixels. After forecast advance from 22:00 to 23:00 UTC, timed frames changed 151,085 pixels. Draws and updates continued in both cases.
- Original/combined/geography comparisons retain identical initial center and zoom. All three palettes were captured. The matching GSHHG mask and image registration were visually inspected at initial and changed zoom.
- No JavaScript/console errors, failed requests, or GL errors. Warnings: four software-driver `ReadPixels` stalls and an existing OpenFreeMap missing `circle-11` sprite. No framebuffer-feedback or invalid-operation warnings occurred in the default renderer.
- `npm test`: 19/19 pass. `npm run build`: pass, with the bundle-size advisory. Renderer, `windData.js`, GFS module and package manifests have no diff from HEAD.

**SwiftShader was used. Native GPU performance remains unverified.** Readback instrumentation is diagnostic and is not suitable for performance measurement.

## Rendering findings

The earlier 8091 preview was a standalone geography viewer and never instantiated a wind renderer. Wind was not hidden by a shader failure there; it was absent. Reusing the real application and putting the opaque bathymetry below its working default wind layer restored visible animation without particle tuning.

Integration-specific fixes: use `getLayersOrder()` because serialized MapLibre styles omit custom wind layers; clean up added sources on development reload; allow mode changes while original WMS/cloud requests are pending. A separate control check delays GFS by 15 seconds and exercises the actual selectors.

The unused experimental `FeedbackWindLayer` has a separate apparent framebuffer/attached-texture feedback hazard in its `presentTrail` path. It was left intact and was not used to establish this prototype. No Phase 2 work was started.

The forecast's existing Natural Earth water mask and readout mask are unchanged. GSHHG provides more detailed visual land, so some fine coastal water gaps/readout differences can remain. The display is a regional visual prototype, not a navigational chart.

## Review artifacts and reproduction

- `integrated-preview-1920.png`: combined app with controls.
- `wind-frame-1.png`, `wind-frame-2.png`, `wind-frame-3.png`: timed animation evidence.
- `original-comparison.png`, `geography-baseline.png`: same-camera comparisons.
- `integrated-blue-black.png`, `integrated-muted-teal.png`: other palettes.
- `wind-after-pan-zoom-*.png`, `wind-after-forecast-*.png`: continued animation.
- `integration-browser-audit.json`: network, GL, particle, camera, draw/update and capture-time evidence.
- `integration-pixel-audit.json`: image-difference measurements.
- `integration-control-audit.json`: actual selector interactions and delayed-wind startup check.

From `/Users/sage/Development/livingchart`:

```sh
npm run dev -- --host 127.0.0.1 --port 8092 --strictPort
node experiments/phase-1-geography/integration-audit.mjs "/Users/sage/Desktop/Nautical Living Charts/artifacts/onboarding-backup/20261105T210936Z/node_modules/playwright"
node experiments/phase-1-geography/integration-controls.mjs "/Users/sage/Desktop/Nautical Living Charts/artifacts/onboarding-backup/20261105T210936Z/node_modules/playwright"
.venv-phase1/bin/python experiments/phase-1-geography/integration-pixels.py
```

The audit requires a running dev server and uses existing Playwright; it installs nothing. These local generated assets are ignored and are not packaged for deployment. Work remains uncommitted on `codex/phase-1-geography`. Prior uncommitted work, backup and stash remain preserved. No commit, push, deployment, deployment-setting change or dependency installation was performed for this integration.

## Ocean Studio preview

Generate the Ocean plates after generating the Phase 1 and Sculpted Atlas Day assets. Use the original GEBCO elevation GeoTIFF recorded in the Day manifest.

```sh
.venv-phase1/bin/python -B tools/cartography/render_ocean.py --elevation /path/to/gebco_elevation.tif
node experiments/phase-2-wind/ocean-check.mjs /path/to/playwright /tmp/ocean-check
```

The generator writes water-only depth and relief plates to the ignored `artifacts/cartography/ocean/` directory. The 4K plates use the existing Web Mercator crop and GSHHG land mask. Day keeps the baked shelf, texture, and vignette in its depth color blend. In the Phase 2 preview, the Ocean sliders blend depth color, relief, and static texture into the existing bathymetry layer. The texture is generated once with WebGL and clipped using the existing coastline mask. Setting all three to zero restores the baked image. The browser check captures both chart themes at 1920×1080.

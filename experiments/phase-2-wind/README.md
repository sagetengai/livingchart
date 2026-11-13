# Phase 2 wind studies

Run `npm run dev -- --host 127.0.0.1 --port 8092` from the project root and open [the local Phase 2 preview](http://127.0.0.1:8092/?phase2=1). Expand **Wind Studio** in the upper right. Use the preview's **Theme** selector to switch between Day and Night, and **Renderer** to compare History ribbons with Original particles. The panel is available only in the Vite development preview.

## Wind Studio controls

| Control | Effect |
| --- | --- |
| Particle count | 100–2,400 ribbon head slots. Diagnostics shows the applied capacity. GPUs with a smaller texture limit report the limit when you click Apply. |
| History positions | Number of stored points per ribbon, sampled at 10 Hz. |
| Trail width and taper strength | Nominal screen-space width from 0.5–5 CSS pixels and the existing 0.3–2 taper range. |
| Trail opacity | Base ribbon opacity from 0–100%, multiplied by the theme and Wind layer opacity and capped at 100% before the trail envelope. |
| Speed multiplier | Visual advection rate through the existing forecast. |
| Trail lifetime and fade duration | Base head lifetime and the time a stopped head fades before respawning. |
| Random seed | Unsigned 32-bit seed for the existing shader. The shader fixes the seeding distribution. |
| Wind tint | RGB tint shared by both renderers for the current theme. |
| Night palette | Selects an existing sea treatment. Day uses the fixed Sculpted Atlas raster. |
| Wind | Toggles the selected renderer's visibility and scales its opacity. |
| Land | Controls the separate Night fill. Day land shading is part of the Bathymetry image. |
| Bathymetry | Controls visibility and opacity of the current theme raster. |
| Clouds | Controls the existing GOES observation layer when available. |
| Coastline | Controls the existing coastline line overlay independently of the land fill. |
| Effects | The active ribbon layer uses normal blending. Bloom and accumulation are reserved for the compositor. |
| Diagnostics | Ribbon FPS uses measured frame time. Active heads count advancing ribbon heads, or the original renderer's live particles. Water percentages describe the original global wind grid and regional ribbon coast mask separately. **Show masks** displays both as read-only thumbnails, with water in blue. |

Width, taper, opacity, speed, lifetime, fade, tint, palettes, and layer controls update live. Count and history require new GPU buffers. Seed changes restart ribbons so the new seed and existing history stay consistent. **Apply** commits all three together. Changing the theme, selecting a treatment, or loading, importing, or resetting a preset stages those three values while applying the live settings. The three staged values belong to the current theme. The running ribbon buffers stay in use until you click **Apply**.

**Save Preset** and **Load Preset** use separate browser storage slots for Day and Night. **Reset to Defaults** restores the current theme's settings and leaves its saved slot available. **Export JSON** includes staged settings, and **Import JSON** validates the file against the currently selected theme. Both version 1 and version 2 files load from the existing storage slots. Legacy seed counts from 50 to 99 are preserved on load. Editing the count uses the new range.

Version 2 stores `theme`, `palette`, `mapLayers`, and one `windLayer` object. The `WindLayerConfig` fields are `id`, `name`, `enabled`, `seedCount`, `seed`, `history`, `color`, `opacity`, `layerOpacity`, `width`, `taper`, `speed`, `lifetime`, `fade`, `blendMode`, and `effects`. The current layer has ID `phase2-wind` and name `History ribbons`. The supported blend mode is `normal`. Both `effects.bloom` and `effects.accumulation` must be false.

The browser check uses the existing Playwright tooling with Chrome and a running dev preview. An optional final path writes the screenshot.

```sh
node experiments/phase-2-wind/studio-check.mjs /absolute/path/to/playwright /tmp/wind-studio.png
```

## Terrain controls

Expand **Terrain** in Wind Studio to set the land base color and toggle relief. Relief opacity controls the overall blend. Contrast scales the tonal departures from neutral, and Shadow and Highlight strength scale the dark and light sides independently. Night starts with blue-charcoal land and 25% relief. Day starts with its original baked land plate and relief hidden. A Day color override uses the separate land fill, and **Use baked Day land** restores the original plate.

Terrain is saved with the current theme in version 2 preset JSON. Existing presets without a terrain entry load the theme defaults. Ocean shading is part of the existing palette images.

The relief source uses the Phase 1 EPSG:3857 crop and the existing Day land plate's GSHHG alpha. It draws above the land fill and below wind. The preview recolors the raster only when the tonal controls change. MapLibre handles pan and zoom on the same image coordinates.

Generate the relief using the existing cartography environment.

```sh
.venv-phase1/bin/python tools/cartography/render_relief.py --elevation /path/to/gebco_2026_n30.0_s22.0_w-115.0_e-108.0_geotiff.tif
```

The generator computes northwest lighting from the original GEBCO elevation, using land-only neighbors at the coast. The PNG and georeferencing manifest go under `artifacts/cartography/terrain/`. The 15 arc-second source limits the terrain detail at close zooms.

To repeat the browser checks and capture the four terrain views, run this against the local preview on port 18195.

```sh
node experiments/phase-2-wind/terrain-check.mjs /absolute/path/to/playwright /tmp/terrain-check
```

## OpenTopography elevation data

Copy `.env.example` to `.env.local` and fill in the private `OPENTOPO_API_KEY` and `LIVINGCHART_DATA_DIR`. The storage path must be an existing absolute directory on the mounted data drive. Start the elevation backend and Vite in separate terminals.

```sh
.venv-phase1/bin/python tools/cartography/elevation_server.py
npm run dev -- --host 127.0.0.1 --port 18197
```

Open [the local Phase 2 preview](http://127.0.0.1:18197/?phase2=1), then expand **Wind Studio** and **Elevation Data**. The initial selection is the La Paz test region. Choose a viewport or enter bounds manually. **Preview region and estimate** draws the footprint and reports the estimated uncompressed size and cached tile count. **Download elevation data** starts the job, and **Apply to Preview** swaps in the regional relief below wind. The original relief remains visible outside the selected region. **Restore original terrain** brings it back inside the region. The active theme's Terrain controls still govern visibility and style.

The backend writes original GeoTIFFs and metadata under `sources/opentopography/COP30/` and georeferenced grayscale PNGs under `renders/terrain/`. The browser loads only the preview PNG, capped at 1,200 pixels on the long edge. The larger relief is capped at 4,096 pixels. Both use the Phase 1 GSHHG coastline and Web Mercator. Selections are restricted to the existing coastline footprint and four square degrees, with requests split into tiles of at most one degree per side. The backend serializes jobs per data library and limits requests to 50 per rolling day. Cancellation takes effect between download reads or raster processing steps.

COP30 is a digital surface model that can include vegetation and built features. Credit the Copernicus DEM and OpenTopography when using derived outputs. [Dataset and licensing](https://portal.opentopography.org/datasetMetadata?otCollectionID=OT.032021.4326.1) · [API limits](https://opentopography.org/developers)

## Stage 4A performance

Chrome with ANGLE Metal on Apple M3, 1440 × 1000 drawing buffer at DPR 1, Night Calligraphic, 96 history positions, and the same camera and forecast. Each count warmed up before a five-second sample, with the Studio closed to exclude its diagnostic readback. FPS and P95 measure the full map frame interval.

| Seed capacity | Spawned GPU slots | Mean FPS | P95 frame | History texture |
| ---: | ---: | ---: | ---: | ---: |
| 480 | 480 | 60.0 | 17.8 ms | 720 KiB |
| 960 | 960 | 60.1 | 17.6 ms | 1,440 KiB |
| 1,920 | 1,920 | 60.0 | 17.7 ms | 2,880 KiB |

Frame cadence stayed near 60 FPS in this profile while history memory scaled linearly. The sample does not measure GPU headroom beyond that cadence. The browser check also applies the 2,400-slot maximum.

## Future compositor

Prefer one MapLibre custom layer with a shared WebGL compositor. The current renderer already draws premultiplied ribbons into MapLibre's active framebuffer and preserves GL state across the custom draw. A future compositor can render the wind group into its own transparent framebuffer and resolve it at the existing wind draw position. Keep forecast and coastal textures, shader programs, and projection setup shared. Style-only layers can draw from the same head and history textures. Layers with independent seeds, speeds, or lifetimes need separate simulation state and histories within that shared layer.

- **Add and screen** can use premultiplied blend factors for RGB inside the wind group, with an explicit alpha policy. Screen against the basemap would need the map destination color, so define that behavior separately from blending within wind.
- **Bloom** can downsample the wind target, blur the bright contribution in two passes, and composite it with the clean strokes. Group-level bloom is also the approach shown in the ArcGIS example. [FlowRenderer sample](https://developers.arcgis.com/javascript/latest/sample-code/layers-imagery-afrenderer-blending/)
- **Long exposure** can ping-pong between two accumulation targets and apply time-based decay. Start by clearing them on camera, projection, or size changes to avoid carrying screen-space trails into a new view.

This keeps one map integration and avoids duplicating the forecast, mask, and effect targets for every style. Nelson's layered wind study provides the visual reference for the group. [Silky wind map](https://www.esri.com/arcgis-blog/products/arcgis-online/mapping/make-this-silky-wind-map-in-arcgis-online)

## How the strokes work

A MapLibre custom layer draws between the Phase 1 bathymetry and coastline mask. It reuses the application's decoded global NOAA GFS vector grid. A fixed 30 Hz GPU simulation interpolates valid grid samples, follows the vectors with midpoint integration, and blends consecutive forecasts over three seconds. The speed setting accelerates visual time. Particle positions remain in geographic coordinates, with unwrapped longitude stored through a crossing.

Two floating-point state textures alternate between simulation passes. Every third step copies one state row into a texture-backed history ring on the GPU. An instanced triangle strip per particle projects that history through MapLibre and widens it in screen space. The width envelope tapers both ends. Particle age controls opacity, and generation IDs prevent a respawn from connecting to a previous path.

The ring makes memory use proportional to particle count × history length and avoids uploading geometry each frame. Each frame uses one ribbon draw plus a small simulation draw per elapsed fixed step. Midpoint integration requires another field sample per step. It follows curvature through the interpolated vector field without the extra sampling of a higher-order integrator. The 10 Hz history trades some path sampling precision for fewer history copies.

## Reproduce the audit

From the project root, with the existing Vite, Playwright, and Phase 1 Python environments:

```sh
npm run dev -- --host 127.0.0.1 --port 8092 --strictPort
NATIVE=1 FORECAST=1794002400 node experiments/phase-2-wind/audit.mjs /absolute/path/to/playwright
.venv-phase1/bin/python experiments/phase-2-wind/pixels.py
```

Use a forecast timestamp available in the live catalog, or omit `FORECAST` to select the current forecast and pin it for that run. The audit compares the same geographic extent, deep-navy palette, seed 20261105, and nominal simulation times of 14 and 15 seconds. The original renderer's steps use its existing 50 ms update interval. Output is written to `artifacts/phase-2-wind/`. `NATIVE=1` selects installed Chrome with ANGLE Metal. Without it, the audit uses Playwright Chromium and records the actual renderer.

## Limits

The preview requires WebGL 2 floating-point color attachments. The regional camera is constrained to the Phase 1 crop. Longitude-wrap handling is implemented in the shader, but the regional visual audit does not exercise an antimeridian crossing. The wind mask and bathymetry coastline use different resolutions, so coastal wind can disappear before reaching detailed land. Additional forecast and coastline conditions, a sustained display run, and a direct Euler-versus-midpoint visual comparison would extend this audit.

## Results on November 6, 2026

Chrome identified the renderer as ANGLE Metal on Apple M3. The Calligraphic measurements below use a four-second steady-state window and a separate one-second pan/zoom. Frame times include the map. GPU timings are sparse samples of the custom wind layer only.

| CSS viewport | DPR | Drawing buffer | Mean frame | P95 frame | Frame SD | Pan/zoom P95 | Mean wind GPU |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1920 × 1080 | 1 | 1920 × 1080 | 16.67 ms | 17.50 ms | 0.48 ms | 17.50 ms | 0.74 ms |
| 3840 × 2160 | 1 | 3840 × 2160 | 16.67 ms | 17.50 ms | 0.54 ms | 17.90 ms | 2.96 ms |
| 1920 × 1080 | 2 | 3840 × 2160 | 16.67 ms | 17.50 ms | 0.50 ms | 18.10 ms | 1.89 ms |

Each profile submitted 240 ribbon draws and 119–120 simulation draws in the steady-state window. Calligraphic uses a 480 × 96 RGBA32F history texture (720 KiB) and two 480 × 1 state textures (15 KiB total). The 1440 × 721 wind texture is about 3.96 MiB per forecast, with up to two textures held for blending. These estimates exclude map textures and framebuffers.

The two frames per treatment showed visible movement at both resolutions. At 1080p, the Calligraphic pair changed 37,597 interior pixels by more than 8 levels in at least one channel. Its 4K pair changed 76,591 pixels. The pan/zoom pair continued changing with the camera held at the new framing. A one-step GPU readback of 156 moving particles gave a median direction cosine of 0.9987 against the CPU's decoded GFS vectors, with a median speed ratio of 1.011 after accounting for the visual speed multiplier.

Visual inspection found long continuous curves with tapered ends and legible coastlines in Calligraphic. Fine currents produced lighter, thinner lines. Atmospheric held softer, longer paths. The first multi-profile Chrome run had context errors in the 4K original capture. The final audit launched a fresh Chrome process per profile and completed with no page exceptions or WebGL errors. The console still reported a missing resource and the OpenFreeMap `circle-11` sprite warning.

See `artifacts/phase-2-wind/comparison.jpg` and `comparison-4k.jpg` for the contact sheets, `*-a.png` and `*-b.png` for the full-resolution frames, and `native.json` and `pixel-motion.json` for the measurements.

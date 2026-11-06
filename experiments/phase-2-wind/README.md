# Phase 2 wind studies

Open [the local preview](http://127.0.0.1:8092/?phase2=1). The default study is Calligraphic. Use **Renderer** to compare with the existing particles, **Treatment** to switch among the three ribbon presets, and **Tune strokes** to change the eight artistic controls. All treatments share the forecast and the Phase 1 map. The experiment is enabled by the development server and the `phase2` query parameter.

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

# Tengai – Living Nautical Chart (V1)

A premium full‑screen nautical visualization for the Sea of Cortez.

## Overview
- Bathymetric relief and depth contours (GEBCO 2024)
- Natural‑Earth coastlines & curated labels
- Animated wind particles (demo field, later real forecast)
- Three art‑direction themes (Living, Classic, Sculpted)
- Runs locally in a browser; later deployable to a Raspberry Pi kiosk.

## Quick start
```bash
# Clone the repo (or copy this folder)
cd "$(pwd)"
npm install          # install JS dependencies
npm run dev          # start a local dev server (http://localhost:8080)
```

The app expects the processed data assets in `data/processed/`. Run the preparation scripts the first time:
```bash
python3 scripts/prepare_bathymetry.py   # download & clip GEBCO
python3 scripts/generate_contours.py    # create SVG contours
```

## Development notes
- Themes are defined in `config/themes.json` and injected as CSS custom properties.
- The wind engine reads `data/demo/wind_demo.json` by default.
- Tests: `npm test` (Jest) and `pytest tests/` (Python).

## License & Data attribution
- Code: MIT
- Bathymetry: GEBCO 2024, © IHO‑NGDC, CC‑BY 4.0
- Coastline/labels: Natural Earth, public domain
- Wind demo data: synthetic (no external license)

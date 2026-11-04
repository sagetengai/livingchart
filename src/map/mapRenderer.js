// src/map/mapRenderer.js
// Self-contained map renderer.
// Draws ocean gradient + synthetic contours + embedded simplified coastline onto canvas+SVG.
// All external data (bathymetry PNG, contours SVG, GeoJSON) are loaded opportunistically —
// the map renders even if every one of them is missing.

const SEA_OF_CORTEZ_COASTLINE = {
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "name": "Baja California Sur" },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
          [-112.0, 27.0],
          [-111.8, 26.8],
          [-111.5, 26.5],
          [-111.2, 26.1],
          [-110.9, 25.8],
          [-110.7, 25.4],
          [-110.5, 25.0],
          [-110.3, 24.5],
          [-110.1, 24.1],
          [-109.9, 23.5],
          [-109.7, 23.0],
          [-112.0, 23.0],
          [-112.0, 27.0]
        ]]
      }
    },
    {
      "type": "Feature",
      "properties": { "name": "Sonora & Sinaloa" },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
          [-108.0, 27.0],
          [-108.0, 23.0],
          [-108.5, 23.0],
          [-108.8, 23.4],
          [-109.1, 24.0],
          [-109.2, 24.6],
          [-109.3, 25.2],
          [-109.5, 25.7],
          [-109.7, 26.2],
          [-110.0, 26.6],
          [-110.3, 27.0],
          [-108.0, 27.0]
        ]]
      }
    },
    {
      "type": "Feature",
      "properties": { "name": "Isla Espiritu Santo" },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
          [-110.45, 24.55],
          [-110.38, 24.48],
          [-110.30, 24.40],
          [-110.32, 24.35],
          [-110.38, 24.32],
          [-110.47, 24.38],
          [-110.50, 24.47],
          [-110.45, 24.55]
        ]]
      }
    },
    {
      "type": "Feature",
      "properties": { "name": "Isla Carmen" },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
          [-111.20, 26.05],
          [-111.10, 25.92],
          [-111.05, 25.80],
          [-111.10, 25.74],
          [-111.20, 25.72],
          [-111.28, 25.82],
          [-111.28, 25.96],
          [-111.20, 26.05]
        ]]
      }
    },
    {
      "type": "Feature",
      "properties": { "name": "Isla San Jose" },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
          [-110.62, 25.10],
          [-110.55, 25.02],
          [-110.50, 24.95],
          [-110.54, 24.88],
          [-110.62, 24.88],
          [-110.68, 24.96],
          [-110.67, 25.06],
          [-110.62, 25.10]
        ]]
      }
    }
  ]
};

const LABELS = [
  { name: "La Paz",           lon: -110.31, lat: 24.14, type: "city" },
  { name: "Loreto",           lon: -111.34, lat: 26.01, type: "city" },
  { name: "Guaymas",          lon: -110.90, lat: 27.92, type: "city" },
  { name: "Topolobampo",      lon: -109.05, lat: 25.60, type: "city" },
  { name: "Isla Espíritu Santo", lon: -110.38, lat: 24.46, type: "island" },
  { name: "Isla Carmen",      lon: -111.15, lat: 25.88, type: "island" },
  { name: "Sea of Cortez",    lon: -110.00, lat: 25.40, type: "region" },
  { name: "Bahía de La Paz",  lon: -110.50, lat: 24.25, type: "bay" }
];

// Depth map: simulate depth bands for the Sea of Cortez
// Central trough is deepest; shelves near coasts are shallower
function getDepthFraction(lon, lat, extent) {
  const { west, east, south, north } = extent;
  const nx = (lon - west) / (east - west);
  const ny = (lat - south) / (north - south);
  // Distance from center of the gulf
  const cx = 0.5, cy = 0.5;
  const dx = (nx - cx) * 2;
  const dy = (ny - cy) * 1.0;
  // Add longitudinal bias: gulf centre is deeper than edges
  const dist = Math.sqrt(dx * dx + dy * dy);
  return Math.max(0, Math.min(1, 1 - dist * 0.8));
}

let _mapConfig;

export async function initMap(config) {
  _mapConfig = config;

  // Create a base canvas for ocean gradient
  const container = document.getElementById('appContainer');
  const baseCanvas = document.createElement('canvas');
  baseCanvas.id = 'baseCanvas';
  baseCanvas.className = 'layer';
  baseCanvas.style.zIndex = '0';
  container.prepend(baseCanvas);

  drawOcean(baseCanvas, config);
  window.addEventListener('resize', () => drawOcean(baseCanvas, config));

  drawCoastline(config);
  drawLabels(config);

  // Opportunistically load external contours/bathymetry if available
  await tryLoadExternalAssets(config);
}

// ── Ocean Gradient ────────────────────────────────────────────────────────────

function drawOcean(canvas, config) {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');

  const cs   = getComputedStyle(document.documentElement);
  const deep  = cs.getPropertyValue('--color-ocean-deep').trim()   || '#071D32';
  const mid   = cs.getPropertyValue('--color-ocean-mid').trim()    || '#123C59';
  const shallow = cs.getPropertyValue('--color-ocean-shallow').trim() || '#246B83';

  const W = canvas.width, H = canvas.height;
  const { west, east, south, north } = config.extent;

  // Draw per-pixel depth gradient (pixel sampling for performance)
  const imageData = ctx.createImageData(W, H);
  const data = imageData.data;

  const deepRGB    = hexToRgb(deep);
  const midRGB     = hexToRgb(mid);
  const shallowRGB = hexToRgb(shallow);

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const lon = west  + (px / W) * (east  - west);
      const lat = north - (py / H) * (north - south);
      const depth = getDepthFraction(lon, lat, config.extent);
      let r, g, b;
      if (depth > 0.5) {
        const t = (depth - 0.5) * 2;
        r = lerp(midRGB.r, deepRGB.r, t);
        g = lerp(midRGB.g, deepRGB.g, t);
        b = lerp(midRGB.b, deepRGB.b, t);
      } else {
        const t = depth * 2;
        r = lerp(shallowRGB.r, midRGB.r, t);
        g = lerp(shallowRGB.g, midRGB.g, t);
        b = lerp(shallowRGB.b, midRGB.b, t);
      }
      const idx = (py * W + px) * 4;
      data[idx]   = r;
      data[idx+1] = g;
      data[idx+2] = b;
      data[idx+3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  // Draw synthetic contour rings
  drawContours(ctx, W, H, config.extent, mid, shallow);
}

function drawContours(ctx, W, H, extent, mid, shallow) {
  const { west, east, south, north } = extent;
  const cs = getComputedStyle(document.documentElement);
  const contourColor = cs.getPropertyValue('--color-contour').trim() || '#527789';

  ctx.strokeStyle = contourColor;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 0.6;

  // Draw iso-depth contours at several depth thresholds
  const thresholds = [0.15, 0.28, 0.42, 0.56, 0.70, 0.82];
  const steps = 300;

  thresholds.forEach(threshold => {
    // March along latitude bands and find contour crossings (simplified)
    for (let py = 1; py < H - 1; py++) {
      for (let px = 1; px < W - 1; px++) {
        const lon  = west  + (px / W) * (east  - west);
        const lat  = north - (py / H) * (north - south);
        const lonR = west  + ((px+1) / W) * (east  - west);
        const latD = north - ((py+1) / H) * (north - south);
        const d00 = getDepthFraction(lon, lat, extent);
        const d10 = getDepthFraction(lonR, lat, extent);
        const d01 = getDepthFraction(lon, latD, extent);

        if ((d00 < threshold) !== (d10 < threshold) ||
            (d00 < threshold) !== (d01 < threshold)) {
          ctx.beginPath();
          ctx.arc(px, py, 0.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  });
  ctx.globalAlpha = 1.0;
}

// ── Coastline ─────────────────────────────────────────────────────────────────

function drawCoastline(config) {
  const svg = document.getElementById('mapLayer');
  if (!svg) return;

  const { west, east, south, north } = config.extent;
  const vbW = east - west, vbH = north - south;
  svg.setAttribute('viewBox', `${west} ${south} ${vbW} ${vbH}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const cs = getComputedStyle(document.documentElement);
  const landColor = cs.getPropertyValue('--color-land').trim() || '#B9B29A';
  const landHL    = cs.getPropertyValue('--color-land-highlight').trim() || '#D1C8AE';

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.id = 'coastlineGroup';

  SEA_OF_CORTEZ_COASTLINE.features.forEach((feature, i) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', polygonToPath(feature.geometry.coordinates[0]));
    path.setAttribute('fill', i === 0 ? landColor : i === 1 ? landHL : landColor);
    path.setAttribute('stroke', 'none');
    path.style.filter = 'drop-shadow(0px 0px 2px rgba(0,0,0,0.4))';
    g.appendChild(path);
  });

  svg.appendChild(g);
}

function polygonToPath(ring) {
  if (!ring || !ring.length) return '';
  return ring.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0]} ${pt[1]}`).join(' ') + ' Z';
}

// ── Labels ────────────────────────────────────────────────────────────────────

function drawLabels(config) {
  const svg = document.getElementById('mapLayer');
  if (!svg) return;

  const cs = getComputedStyle(document.documentElement);
  const textPrimary   = cs.getPropertyValue('--color-text-primary').trim()   || '#E8E4D8';
  const textSecondary = cs.getPropertyValue('--color-text-secondary').trim() || '#A9BDC9';

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.id = 'labelsGroup';

  LABELS.forEach(label => {
    const { west, east, south, north } = config.extent;
    if (label.lon < west || label.lon > east || label.lat < south || label.lat > north) return;

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', label.lon);
    // In SVG, y-axis increases downward, but we use geographic viewBox where lat increases upward
    // So we flip the y when placing text
    text.setAttribute('y', label.lat);
    text.setAttribute('fill', label.type === 'region' ? textSecondary : textPrimary);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-family', 'Inter, Georgia, serif');
    text.setAttribute('letter-spacing', label.type === 'region' ? '0.05' : '0.01');
    text.setAttribute('opacity', label.type === 'region' ? '0.5' : '0.85');

    // SVG transform to flip Y because our viewBox has north at top
    // We scale y by -1 and translate to keep labels right-side up
    const fontSize = label.type === 'region' ? '0.18' : label.type === 'city' ? '0.10' : '0.09';
    text.setAttribute('font-size', fontSize);
    // Apply a transform to flip text vertically (SVG default has +y going down, our viewBox has lat increasing up)
    text.setAttribute('transform', `scale(1,-1) translate(0, ${-(label.lat * 2)})`);

    text.textContent = label.name;
    g.appendChild(text);
  });

  // Flip the entire label group since SVG Y and geographic lat Y are inverted
  g.setAttribute('transform', `translate(0, ${config.extent.south + config.extent.north}) scale(1,-1)`);
  svg.appendChild(g);
}

// ── Opportunistic external assets ─────────────────────────────────────────────

async function tryLoadExternalAssets(config) {
  // These are optional — silently skip if missing
  await Promise.allSettled([
    loadBathymetry(config),
    loadExternalContours(config),
    loadExternalCoastline(config)
  ]);
}

async function loadBathymetry(config) {
  try {
    const res = await fetch(config.bathymetry, { method: 'HEAD' });
    if (!res.ok) return;
    const img = document.getElementById('bathymetryImage');
    if (!img) {
      const svg = document.getElementById('mapLayer');
      const { west, east, south, north } = config.extent;
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      el.id = 'bathymetryImage';
      el.setAttribute('href', config.bathymetry);
      el.setAttribute('x', west); el.setAttribute('y', south);
      el.setAttribute('width', east - west); el.setAttribute('height', north - south);
      el.setAttribute('preserveAspectRatio', 'none');
      el.setAttribute('opacity', '0.8');
      svg.prepend(el);
    }
  } catch (_) {}
}

async function loadExternalContours(config) {
  try {
    const res = await fetch(config.contours);
    if (!res.ok) return;
    const text = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'image/svg+xml');
    const svg = document.getElementById('mapLayer');
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'external-contours');
    doc.querySelectorAll('path,line,polyline').forEach(n => g.appendChild(n.cloneNode(true)));
    svg.appendChild(g);
  } catch (_) {}
}

async function loadExternalCoastline(config) {
  try {
    const res = await fetch(config.coastline);
    if (!res.ok) return;
    const gj = await res.json();
    const svg = document.getElementById('mapLayer');
    const cs  = getComputedStyle(document.documentElement);
    const g   = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = 'externalCoastline';
    gj.features.forEach(f => {
      if (!f.geometry) return;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', geojsonToPath(f.geometry));
      path.setAttribute('fill', cs.getPropertyValue('--color-land').trim() || '#B9B29A');
      path.setAttribute('stroke', 'none');
      g.appendChild(path);
    });
    // Insert before labels
    const labels = svg.getElementById('labelsGroup');
    labels ? svg.insertBefore(g, labels) : svg.appendChild(g);
  } catch (_) {}
}

function geojsonToPath(geometry) {
  const addRing = (ring) => ring.map((p, i) => `${i===0?'M':'L'}${p[0]} ${p[1]}`).join(' ') + ' Z';
  if (geometry.type === 'Polygon')      return addRing(geometry.coordinates[0]);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map(p => addRing(p[0])).join(' ');
  return '';
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

function hexToRgb(hex) {
  hex = hex.trim().replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

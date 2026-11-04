// src/wind/windRenderer.js

/**
 * Simple Canvas 2D wind particle renderer.
 * Uses the wind field provided by windProvider.getWindField().
 * Particles move according to bilinear interpolated wind vectors.
 */

import { getWindField } from './windProvider.js';
import { loadJSON } from '../app/utils.js';

let canvas, ctx;
let width, height;
let mapConfig;
let windField;
let particles = [];

// Configurable constants (can be tuned later)
const MAX_PARTICLES = 2000;
const PARTICLE_MAX_AGE = 200; // frames
const PARTICLE_LINE_WIDTH = 1.2;
const PARTICLE_OPACITY = 0.4;
const REDUCED_MOTION = false; // set true for low‑power mode

/** Initialise the wind renderer after map config is ready */
export async function initWind(config) {
  mapConfig = config;
  canvas = document.getElementById('windCanvas');
  if (!canvas) throw new Error('windCanvas element not found');
  ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  windField = await getWindField();
  createParticles();
  requestAnimationFrame(step);
}

function resizeCanvas() {
  width = canvas.clientWidth;
  height = canvas.clientHeight;
  canvas.width = width;
  canvas.height = height;
}

function createParticles() {
  particles = [];
  for (let i = 0; i < MAX_PARTICLES; i++) {
    particles.push(spawnParticle());
  }
}

function spawnParticle() {
  // Random geographic position within map extent
  const { west, east, south, north } = mapConfig.extent;
  const lon = west + Math.random() * (east - west);
  const lat = south + Math.random() * (north - south);
  const screen = geoToScreen(lon, lat);
  return {
    lon,
    lat,
    x: screen.x,
    y: screen.y,
    age: Math.random() * PARTICLE_MAX_AGE,
    maxAge: PARTICLE_MAX_AGE,
  };
}

function geoToScreen(lon, lat) {
  // Simple linear mapping based on SVG viewBox (equirectangular)
  const { west, east, south, north } = mapConfig.extent;
  const x = ((lon - west) / (east - west)) * width;
  const y = height - ((lat - south) / (north - south)) * height; // flip Y because SVG lat increases northward
  return { x, y };
}

function bilinearInterp(lon, lat) {
  const g = windField.grid;
  const i = (lon - g.lonStart) / g.lonStep;
  const j = (lat - g.latStart) / g.latStep;
  const i0 = Math.floor(i);
  const j0 = Math.floor(j);
  const i1 = i0 + 1;
  const j1 = j0 + 1;
  // Clamp indices
  const clamp = (val, max) => Math.max(0, Math.min(val, max - 1));
  const w = g.width;
  const h = g.height;
  const i0c = clamp(i0, w);
  const i1c = clamp(i1, w);
  const j0c = clamp(j0, h);
  const j1c = clamp(j1, h);
  const tx = i - i0;
  const ty = j - j0;

  const u00 = g.u[j0c][i0c];
  const u10 = g.u[j0c][i1c];
  const u01 = g.u[j1c][i0c];
  const u11 = g.u[j1c][i1c];
  const v00 = g.v[j0c][i0c];
  const v10 = g.v[j0c][i1c];
  const v01 = g.v[j1c][i0c];
  const v11 = g.v[j1c][i1c];

  const u = (1 - tx) * (1 - ty) * u00 + tx * (1 - ty) * u10 + (1 - tx) * ty * u01 + tx * ty * u11;
  const v = (1 - tx) * (1 - ty) * v00 + tx * (1 - ty) * v10 + (1 - tx) * ty * v01 + tx * ty * v11;
  return { u, v };
}

function step() {
  if (document.hidden && !REDUCED_MOTION) {
    // Pause animation when tab is not visible
    requestAnimationFrame(step);
    return;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.globalAlpha = PARTICLE_OPACITY;
  ctx.lineWidth = PARTICLE_LINE_WIDTH;
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-wind-primary') || '#D6EAF0';

  particles.forEach(p => {
    // Age handling
    if (p.age >= p.maxAge) {
      // Reset particle
      Object.assign(p, spawnParticle());
    }
    // Interpolate wind at particle geographic location
    const { u, v } = bilinearInterp(p.lon, p.lat);
    // Simple speed scaling – adjust factor for visual speed
    const speedFactor = 0.02; // tweak as needed
    const dx = u * speedFactor;
    const dy = -v * speedFactor; // negative because screen Y is inverted
    const newLon = p.lon + dx * (gLonStep() / (mapConfig.extent.east - mapConfig.extent.west));
    const newLat = p.lat + dy * (gLatStep() / (mapConfig.extent.north - mapConfig.extent.south));
    const newScreen = geoToScreen(newLon, newLat);

    // Draw particle trail
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(newScreen.x, newScreen.y);
    ctx.stroke();

    // Update particle state
    p.lon = newLon;
    p.lat = newLat;
    p.x = newScreen.x;
    p.y = newScreen.y;
    p.age++;
  });

  requestAnimationFrame(step);
}

function gLonStep() {
  return windField.grid.lonStep;
}
function gLatStep() {
  return windField.grid.latStep;
}

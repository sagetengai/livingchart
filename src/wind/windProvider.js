// src/wind/windProvider.js

/**
 * Wind provider – returns a wind field object.
 * For V1 we load a deterministic demo JSON from data/demo/wind_demo.json.
 * The returned object format:
 * {
 *   grid: { width, height, lonStart, latStart, lonStep, latStep, u[][], v[][] },
 *   metadata: { source, description, validTime }
 * }
 */

export async function getWindField() {
  const response = await fetch('/data/demo/wind_demo.json');
  if (!response.ok) {
    throw new Error(`Failed to load wind demo data: ${response.status}`);
  }
  const windData = await response.json();
  // Simple validation
  const { grid, metadata } = windData;
  if (!grid || !metadata) {
    throw new Error('Invalid wind field structure');
  }
  return windData;
}

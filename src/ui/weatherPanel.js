// src/ui/weatherPanel.js

/**
 * Minimal weather overlay panel.
 * Shows a static message for demo data and basic wind stats.
 */

import { getWindField } from '../wind/windProvider.js';

export function initWeatherPanel() {
  const panel = document.getElementById('weatherPanel');
  if (!panel) return;

  // Populate with demo info – can be enhanced later.
  panel.innerHTML = '<div>Demo wind field – synthetic</div>';

  // Optionally display average speed/direction
  getWindField().then(data => {
    const { u, v } = data.grid;
    let sumU = 0,
      sumV = 0,
      count = 0;
    for (let row = 0; row < u.length; row++) {
      for (let col = 0; col < u[0].length; col++) {
        sumU += u[row][col];
        sumV += v[row][col];
        count++;
      }
    }
    const avgU = sumU / count;
    const avgV = sumV / count;
    const speed = Math.sqrt(avgU * avgU + avgV * avgV).toFixed(1);
    const dirRad = Math.atan2(avgU, avgV); // meteorological conversion later
    const dirDeg = ((dirRad * 180) / Math.PI + 360) % 360;
    panel.innerHTML += `<div>Avg wind speed: ${speed} m/s</div>`;
    panel.innerHTML += `<div>Avg direction (to): ${dirDeg.toFixed(0)}°</div>`;
    panel.innerHTML += `<div>Valid time: ${data.metadata.validTime}</div>`;
  }).catch(err => {
    console.warn('Wind data unavailable for panel', err);
  });
}

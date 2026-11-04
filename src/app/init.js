// src/app/init.js
// Application bootstrap: load configuration, apply theme, initialise renderers

import { loadJSON } from '../app/utils.js';
import { applyTheme } from '../app/utils.js';
import { initMap } from '../map/mapRenderer.js';
import { initWind } from '../wind/windRenderer.js';
import { initWeatherPanel } from '../ui/weatherPanel.js';

(async function main() {
  try {
    // Load configuration files
    const mapConfig = await loadJSON('/config/map.json');
    const themes = await loadJSON('/config/themes.json');

    // Theme handling
    const selector = document.getElementById('themeSelect');
    const defaultTheme = selector.value; // initial value from HTML
    applyTheme(themes[defaultTheme]);

    selector.addEventListener('change', (e) => {
      const themeName = e.target.value;
      applyTheme(themes[themeName]);
    });

    // Initialise map and wind layers
    await initMap(mapConfig);
    await initWind(mapConfig);
    initWeatherPanel();

    console.log('Tengai visualization ready');
  } catch (err) {
    console.error('Fatal error during init:', err);
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.top = 0;
    overlay.style.left = 0;
    overlay.style.right = 0;
    overlay.style.bottom = 0;
    overlay.style.background = 'rgba(0,0,0,0.8)';
    overlay.style.color = '#fff';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = 1000;
    overlay.textContent = 'Failed to start application: ' + err.message;
    document.body.appendChild(overlay);
  }
})();

// src/app/utils.js

/**
 * Helper utilities for the Tengai app.
 */

/**
 * Load a JSON file from the given URL relative to the server root.
 * Returns a Promise that resolves to the parsed object.
 */
export async function loadJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return await response.json();
}

/**
 * Apply a theme object by writing CSS custom properties to :root.
 * Theme keys are expected to match the CSS variable names without the "--" prefix.
 */
export function applyTheme(theme) {
  const root = document.documentElement;
  Object.entries(theme).forEach(([key, value]) => {
    root.style.setProperty(`--color-${toKebabCase(key)}`, value);
  });
}

// Convert camelCase or PascalCase to kebab-case (e.g., oceanDeep -> ocean-deep)
function toKebabCase(str) {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

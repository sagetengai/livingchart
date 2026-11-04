// src/map/labels.js

/**
 * Render geographic labels onto the SVG map.
 * Labels data is expected to be a GeoJSON FeatureCollection where each feature has a "name" property.
 * Simple collision avoidance is performed by checking bounding boxes of previously placed labels.
 */

export function renderLabels(svg, labelsGeoJSON) {
  const existingBBoxes = [];
  const labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  labelGroup.setAttribute('class', 'labels');

  labelsGeoJSON.features.forEach(feature => {
    const { name } = feature.properties || {};
    if (!name) return;
    const [lon, lat] = feature.geometry.coordinates; // assume Point
    const x = lon;
    const y = lat;

    // Create SVG text element
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', y);
    text.setAttribute('fill', 'var(--color-text-primary)');
    text.setAttribute('font-size', '0.12'); // relative to viewBox units
    text.setAttribute('font-family', 'Inter, sans-serif');
    text.textContent = name;

    // Simple collision detection: compute bbox after rendering (approximate)
    // Since we cannot measure before rendering, we use a heuristic distance check.
    const tooClose = existingBBoxes.some(b => {
      const dx = b.x - x;
      const dy = b.y - y;
      const distSq = dx * dx + dy * dy;
      return distSq < 0.05; // adjust threshold as needed
    });
    if (tooClose) return; // skip overlapping label

    existingBBoxes.push({ x, y });
    labelGroup.appendChild(text);
  });

  svg.appendChild(labelGroup);
}

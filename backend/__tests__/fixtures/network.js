/**
 * Réseaux routiers synthétiques au format compact BD TOPO (voir services/bdtopo.compactSegment)
 */

const LAT0 = 44.5;
const LON0 = 6.0;

function segment(coords, overrides = {}) {
  return {
    nature: 'Route à 1 chaussée',
    importance: 5,
    urban: false,
    access: 'Libre',
    direction: 'Double sens',
    level: '0',
    private: false,
    width: null,
    lanes: null,
    greenway: false,
    ref: null,
    name: null,
    ...overrides,
    coords,
  };
}

/**
 * Ligne sinueuse de a vers b (sinusoïde perpendiculaire), altitude croissante
 */
function wiggly(a, b, { amplitude = 0.0015, waves = 3, points = 30, z0 = 500 } = {}) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const coords = [];
  for (let i = 0; i <= points; i++) {
    const t = i / points;
    const off = Math.sin(t * Math.PI * 2 * waves) * amplitude;
    coords.push([a[0] + dx * t + nx * off, a[1] + dy * t + ny * off, z0 + t * 40]);
  }
  coords[0] = [a[0], a[1], z0];
  coords[points] = [b[0], b[1], z0 + 40];
  return coords;
}

/**
 * Grille size × size de routes sinueuses (~1 km entre carrefours)
 */
function gridSegments({ size = 6, step = 0.01, overrides = () => ({}) } = {}) {
  const node = (i, j) => [LON0 + i * step, LAT0 + j * step];
  const segments = [];
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (i + 1 < size) segments.push(segment(wiggly(node(i, j), node(i + 1, j)), overrides(i, j, 'h')));
      if (j + 1 < size) segments.push(segment(wiggly(node(i, j), node(i, j + 1)), overrides(i, j, 'v')));
    }
  }
  return segments;
}

module.exports = { segment, wiggly, gridSegments, CENTER: { lat: LAT0, lon: LON0 } };

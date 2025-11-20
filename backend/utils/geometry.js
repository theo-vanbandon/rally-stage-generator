/**
 * Fonctions utilitaires de géométrie
 */

/**
 * Vérifie si deux segments se croisent géométriquement
 */
function segmentsIntersect(p1, p2, p3, p4) {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const [x3, y3] = p3;
  const [x4, y4] = p4;

  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (Math.abs(denom) < 1e-10) return false;

  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

  return ua > 0.05 && ua < 0.95 && ub > 0.05 && ub < 0.95;
}

/**
 * Vérifie si un point est proche d'un segment
 */
function isNearSegment(point, seg, tolerance = 0.0001) {
  const [px, py] = point;
  const [x1, y1] = seg[0];
  const [x2, y2] = seg[1];

  const minX = Math.min(x1, x2) - tolerance;
  const maxX = Math.max(x1, x2) + tolerance;
  const minY = Math.min(y1, y2) - tolerance;
  const maxY = Math.max(y1, y2) + tolerance;

  return px >= minX && px <= maxX && py >= minY && py <= maxY;
}

/**
 * Vérifie si trois points sont alignés (segments dans le prolongement)
 */
function areSegmentsAligned(a, b, c) {
  const vec1 = [b[0] - a[0], b[1] - a[1]];
  const vec2 = [c[0] - b[0], c[1] - b[1]];
  const crossProduct = vec1[0] * vec2[1] - vec1[1] * vec2[0];
  return Math.abs(crossProduct) < 0.000001;
}

module.exports = {
  segmentsIntersect,
  isNearSegment,
  areSegmentsAligned
};

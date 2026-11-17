/**
 * Géométrie des tulipes, dans un repère 100 × 100 (y vers le bas, comme le SVG) : partagée par le dessin à l'écran
 * (composant Tulip) et par le roadbook PDF, pour qu'ils soient identiques
 */

export const C = 50; // centre horizontal
export const CY = 56; // centre vertical (un peu bas : la sortie a plus de place)
export const R = 38; // rayon 1 de la tulipe = 60 m sur le terrain
export const RING_R = 12; // rond-point : rayon de l'anneau dessiné

// Tête de flèche nettement plus large que le trait (8) pour rester visible même quand la route file tout droit
const HEAD_LENGTH = 15;
const HEAD_HALF_WIDTH = 12;
const HEAD_TIP = 3; // la pointe dépasse un peu le bout de la route

/** Point de la tulipe (x à droite, y vers l'avant, rayon 1) → coordonnées du repère 100 × 100 */
const toBox = ([x, y]) => [C + x * R, CY - y * R];

/** Forme d'une branche : géométrie réelle si disponible, sinon trait droit selon l'angle */
export function branchPoints(path, angle) {
  if (path?.length) return [[C, CY], ...path.map(toBox)];
  const a = (angle * Math.PI) / 180;
  return [
    [C, CY],
    [C + R * Math.sin(a), CY - R * Math.cos(a)],
  ];
}

/**
 * Flèche de sortie : tracé coupé à la base de la tête ; la tête est orientée selon la fin de la route mesurée sur
 * toute sa longueur (et non sur les deux derniers points, trop proches pour être fiables)
 * @returns {{line: number[][], head: number[][]}}
 */
export function exitArrow(points) {
  const end = points.at(-1);
  let base = points[0];
  let keep = 1;
  let travelled = 0;
  for (let i = points.length - 1; i > 0; i--) {
    const [a, b] = [points[i], points[i - 1]];
    const step = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (travelled + step >= HEAD_LENGTH) {
      const t = (HEAD_LENGTH - travelled) / step;
      base = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      keep = i;
      break;
    }
    travelled += step;
  }
  const len = Math.hypot(end[0] - base[0], end[1] - base[1]) || 1;
  const [dx, dy] = [(end[0] - base[0]) / len, (end[1] - base[1]) / len];
  const tip = [end[0] + dx * HEAD_TIP, end[1] + dy * HEAD_TIP];
  return {
    line: [...points.slice(0, keep), base],
    head: [
      tip,
      [base[0] - dy * HEAD_HALF_WIDTH, base[1] + dx * HEAD_HALF_WIDTH],
      [base[0] + dy * HEAD_HALF_WIDTH, base[1] - dx * HEAD_HALF_WIDTH],
    ],
  };
}

/**
 * Rond-point : parcours sur l'anneau dans le sens de circulation (antihoraire vu du ciel : on part par la droite),
 * de l'entrée (en bas) jusqu'à la sortie
 * @returns {{start: number[], end: number[], sweep: number, points: number[][]}} points : l'arc en segments
 */
export function roundaboutArc(exit) {
  const at = (deg) => {
    const a = (deg * Math.PI) / 180;
    return [C + RING_R * Math.sin(a), CY - RING_R * Math.cos(a)];
  };
  const sweep = Math.min(359, Math.max(10, 180 - exit));
  const steps = Math.max(4, Math.ceil(sweep / 10));
  const points = Array.from({ length: steps + 1 }, (_, i) => at(180 - (sweep * i) / steps));
  return { start: at(180), end: at(180 - sweep), sweep, points };
}

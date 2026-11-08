/**
 * Fonctions utilitaires de géométrie
 */

/**
 * Calcule la distance entre deux coordonnées [lon, lat] (formule de Haversine)
 * @param {Array} coord1 - [lon, lat]
 * @param {Array} coord2 - [lon, lat]
 * @returns {number} Distance en km
 */
export function haversineDistance(coord1, coord2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const [lon1, lat1] = coord1;
  const [lon2, lat2] = coord2;
  const R = 6371; // Rayon de la Terre en km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Distances cumulées (km) le long d'une polyligne [lon, lat]
 * @param {Array} coords
 * @returns {number[]}
 */
export function cumulativeDistances(coords) {
  const out = [0];
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + haversineDistance(coords[i - 1], coords[i]));
  return out;
}

/**
 * Point [lon, lat] situé à une distance donnée depuis le départ
 * @param {Array} coords - Polyligne [lon, lat]
 * @param {number[]} cumulative - Distances cumulées (voir cumulativeDistances)
 * @param {number} km
 */
export function pointAtKm(coords, cumulative, km) {
  if (!coords.length) return null;
  if (km <= 0) return coords[0];
  let i = 1;
  while (i < cumulative.length && cumulative[i] < km) i++;
  if (i >= cumulative.length) return coords[coords.length - 1];
  const span = cumulative[i] - cumulative[i - 1];
  const t = span > 0 ? (km - cumulative[i - 1]) / span : 0;
  const [a, b] = [coords[i - 1], coords[i]];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Emprise [sud, ouest, nord, est] du carré de recherche (identique au backend)
 */
export function bboxAround(lat, lon, radiusKm) {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
}

/** Distance d'un point à un segment (coordonnées planes) */
function distToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Point et tangente unitaire à une distance donnée le long d'une polyligne plane */
function sampleAt(pts, cum, d) {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const [a, b] = [pts[i - 1], pts[i]];
  const span = cum[i] - cum[i - 1] || 1;
  const t = Math.max(0, Math.min(1, (d - cum[i - 1]) / span));
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], t: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] };
}

const angleBetween = (u, v) => (Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))) * 180) / Math.PI;
const unit = ([x, y]) => {
  const len = Math.hypot(x, y) || 1;
  return [x / len, y / len];
};

/** Coupe une polyligne plane à une distance donnée depuis son début */
function cutPolyline(pts, d) {
  const out = [pts[0]];
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (run + seg >= d) {
      const t = seg ? (d - run) / seg : 0;
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
      return out;
    }
    run += seg;
    out.push(pts[i]);
  }
  return out;
}

const ARROW_ROAD_TURN_MAX = 30; // virage max de la route entre deux points de la flèche (tous les 4 px)
const ARROW_ROAD_TOTAL_MAX = 110; // virage total max de la route sous une flèche
const ARROW_SHAFT_TURN_MAX = 40; // un trait décalé qui tourne plus que ça fait un zigzag : rejeté
const ARROW_HEAD_BACK = 10; // le trait s'arrête 10 px avant la pointe, caché sous elle

/**
 * Grosses flèches de sens de parcours d'une boucle, dessinées À CÔTÉ du tracé (coordonnées écran, en pixels) :
 * chaque flèche suit la route en parallèle, du côté extérieur de la boucle. Si elle passerait trop près d'un
 * autre morceau de la spéciale, elle est déplacée de l'autre côté, ou supprimée. Les flèches évitent les virages
 * serrés et les abords du pivot (le trait décalé y ferait des zigzags) en glissant le long de la boucle.
 * @param {number[][]} pts - Tracé complet de la spéciale, en pixels
 * @param {[number, number]} range - Indices (dans pts) du début et de la fin de la boucle
 * @returns {{shaft: number[][], head: {x: number, y: number, angle: number}}[]} head = pointe exacte de la flèche,
 *   angle en degrés (écran, horaire) ; le trait s'arrête juste sous la pointe
 */
export function loopArrows(pts, [i0, i1], { spacing = 170, offset = 24, length = 70, clearance = 16, min = 3, max = 8 } = {}) {
  const loop = pts.slice(i0, i1 + 1);
  if (loop.length < 2) return [];
  const cum = [0];
  for (let i = 1; i < loop.length; i++) cum.push(cum[i - 1] + Math.hypot(loop[i][0] - loop[i - 1][0], loop[i][1] - loop[i - 1][1]));
  const total = cum[cum.length - 1];
  // Les flèches restent à l'écart des deux bouts de la boucle (pivot : la route y tourne vers les bras)
  const margin = 8 + length / 2;
  const usable = total - 2 * margin;
  if (usable <= 0) return [];
  const count = Math.min(max, Math.floor(total / (length * 1.4)), Math.max(min, Math.round(total / spacing)));
  if (count < 1) return [];
  const cx = loop.reduce((acc, p) => acc + p[0], 0) / loop.length;
  const cy = loop.reduce((acc, p) => acc + p[1], 0) / loop.length;

  const clearOf = (q) => {
    for (let i = 1; i < pts.length; i++) if (distToSegment(q, pts[i - 1], pts[i]) < clearance) return false;
    return true;
  };
  // Tangente lissée sur ±8 px : insensible aux petits crochets du tracé
  const tangentAt = (d) => {
    const a = sampleAt(loop, cum, Math.max(0, d - 8)).p;
    const b = sampleAt(loop, cum, Math.min(total, d + 8)).p;
    return unit([b[0] - a[0], b[1] - a[1]]);
  };

  const arrowAt = (mid) => {
    const samples = [];
    for (let d = mid - length / 2; d <= mid + length / 2 + 0.01; d += 4) samples.push({ p: sampleAt(loop, cum, d).p, t: tangentAt(d) });
    // Route trop tournante sous la flèche : on cherchera ailleurs
    for (let i = 1; i < samples.length; i++) if (angleBetween(samples[i - 1].t, samples[i].t) > ARROW_ROAD_TURN_MAX) return null;
    if (angleBetween(samples[0].t, samples[samples.length - 1].t) > ARROW_ROAD_TOTAL_MAX) return null;

    const m = samples[Math.floor(samples.length / 2)];
    const outward = (m.p[0] - cx) * -m.t[1] + (m.p[1] - cy) * m.t[0] > 0 ? 1 : -1;
    for (const side of [outward, -outward]) {
      const line = samples.map(({ p, t }) => [p[0] - side * offset * t[1], p[1] + side * offset * t[0]]);
      let smooth = true;
      for (let i = 2; i < line.length && smooth; i++) {
        const u = unit([line[i - 1][0] - line[i - 2][0], line[i - 1][1] - line[i - 2][1]]);
        const v = unit([line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]]);
        smooth = angleBetween(u, v) <= ARROW_SHAFT_TURN_MAX;
      }
      if (!smooth || !line.every(clearOf)) continue;
      let lineLength = 0;
      for (let i = 1; i < line.length; i++) lineLength += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      const tip = line[line.length - 1];
      // Direction de la pointe : dernier tronçon d'au moins 10 px du trait
      let j = line.length - 2;
      while (j > 0 && Math.hypot(tip[0] - line[j][0], tip[1] - line[j][1]) < 10) j--;
      const dir = unit([tip[0] - line[j][0], tip[1] - line[j][1]]);
      return {
        shaft: cutPolyline(line, Math.max(0, lineLength - ARROW_HEAD_BACK)),
        head: { x: tip[0], y: tip[1], angle: (Math.atan2(dir[1], dir[0]) * 180) / Math.PI },
      };
    }
    return null;
  };

  const arrows = [];
  const step = usable / count;
  for (let k = 0; k < count; k++) {
    const nominal = margin + (k + 0.5) * step;
    // Position prévue, puis glissements de part et d'autre (sans sortir de sa part de boucle)
    for (const shift of [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45]) {
      const arrow = arrowAt(nominal + shift * step);
      if (arrow) {
        arrows.push(arrow);
        break;
      }
    }
  }
  return arrows;
}

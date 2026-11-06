/**
 * Géométrie des routes vues comme des courbes continues (et non comme une suite de segments droits).
 *
 * Les points IGN sont irrégulièrement espacés (5 m dans un virage, 50 m ailleurs) : relier ces points par des
 * segments coupe les virages et fausse les directions. Ici, la route est une courbe qui passe exactement par
 * les points IGN :
 *  - tangente en un point : cercle passant par les trois points les plus proches (exact sur un arc de cercle)
 *  - tracé : spline de Catmull-Rom centripète (passe par les points, sans boucle ni dépassement)
 *
 * Tous les points sont en mètres [est, nord].
 */

const MIN_GAP_M = 0.3; // points plus proches = doublons de numérisation
const TANGENT_MIN_M = 2; // points trop proches du départ ignorés pour la tangente (bruit)
const TANGENT_MAX_M = 80; // au-delà, un point ne renseigne plus sur la courbure locale
// Écarts entre points plus inégaux que ça : changement de densité de numérisation, donc transition ligne
// droite / virage ou coin (l'IGN met peu de points sur une ligne droite, beaucoup dans un virage) : pas de cercle
const CORNER_RATIO = 1.8;
const KINK_ZONE_M = 8; // zone au ras du nœud où l'on cherche un artefact de numérisation
const KINK_MIN_TURN_DEG = 30;
const MIN_ROAD_RADIUS_M = 3.5; // aucune route ne tourne plus court : en dessous, c'est un artefact
// Tangente robuste : route lue à partir de 12 m du carrefour (au-delà de tout crochet de liaison), sur 20 m
const ROBUST_AWAY_M = 12;
const ROBUST_SPAN_M = 20;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const norm = (v) => Math.hypot(v[0], v[1]);
const unit = (v) => {
  const n = norm(v);
  return n ? [v[0] / n, v[1] / n] : [0, 1];
};

/** Cap (0-360°, 0 = nord, 90 = est) d'un vecteur [est, nord] */
const headingDeg = ([dx, dy]) => ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;

/** Supprime les points en double */
function dedupe(pts) {
  const out = [];
  for (const p of pts) if (!out.length || norm(sub(p, out.at(-1))) >= MIN_GAP_M) out.push(p);
  return out;
}

/**
 * Tangente unitaire au premier point d'une courbe, orientée vers la suite de la courbe.
 * Elle est prise sur le cercle passant par le premier point et les deux points suivants : exacte pour un virage
 * de rayon constant, quelle que soit la densité des points IGN. Devant un coin (écarts très inégaux),
 * on garde la direction du premier segment.
 */
function startTangent(pts) {
  const p0 = pts[0];
  // Premier point utile (≥ 2 m, pour ne pas se fier à un doublon) puis le point suivant immédiatement :
  // des points consécutifs, pour ne jamais "sauter" un coin
  const i1 = pts.findIndex((p, i) => i > 0 && norm(sub(p, p0)) >= TANGENT_MIN_M);
  if (i1 === -1) return unit(sub(pts[1] ?? [p0[0], p0[1] + 1], p0));
  const p1 = pts[i1];
  const chord = unit(sub(p1, p0));
  const p2 = pts.slice(i1 + 1).find((p) => norm(sub(p, p1)) >= MIN_GAP_M);
  if (!p2 || norm(sub(p1, p0)) > TANGENT_MAX_M) return chord;

  // Écarts très inégaux entre points = un coin (angle vif) plutôt qu'un virage régulier : pas de cercle
  const ratio = norm(sub(p2, p1)) / norm(sub(p1, p0));
  if (ratio < 1 / CORNER_RATIO || ratio > CORNER_RATIO) return chord;

  // Centre du cercle passant par p0, p1, p2
  const [ax, ay] = p0;
  const [bx, by] = p1;
  const [cx, cy] = p2;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return chord; // points alignés : ligne droite
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const r = sub(p0, [ux, uy]);
  if (norm(r) > 1e5) return chord; // rayon gigantesque : ligne droite
  let t = unit([-r[1], r[0]]);
  if (t[0] * chord[0] + t[1] * chord[1] < 0) t = [-t[0], -t[1]];
  return t;
}

/**
 * Spline de Catmull-Rom centripète passant par `pts`, échantillonnée environ tous les `spacing` mètres.
 * Le premier point peut recevoir une tangente imposée (celle du cercle osculateur).
 */
function spline(pts, { spacing = 1, startDir = null } = {}) {
  const p = dedupe(pts);
  if (p.length < 2) return p.slice();
  // Points fantômes aux extrémités, placés selon la tangente du cercle osculateur (et non en ligne droite)
  const startT = startDir ?? startTangent(p);
  const endT = startTangent([...p].reverse()); // orientée vers l'intérieur de la courbe
  const firstGap = norm(sub(p[1], p[0]));
  const lastGap = norm(sub(p.at(-1), p.at(-2)));
  const first = [p[0][0] - startT[0] * firstGap, p[0][1] - startT[1] * firstGap];
  const last = [p.at(-1)[0] - endT[0] * lastGap, p.at(-1)[1] - endT[1] * lastGap];
  const ctrl = [first, ...p, last];
  const out = [p[0]];

  for (let i = 1; i < ctrl.length - 2; i++) {
    const [P0, P1, P2, P3] = [ctrl[i - 1], ctrl[i], ctrl[i + 1], ctrl[i + 2]];
    // Paramétrage centripète (alpha = 0,5) : évite boucles et dépassements dans les virages serrés
    const t0 = 0;
    const t1 = t0 + Math.sqrt(norm(sub(P1, P0))) || t0 + 1e-6;
    const t2 = t1 + Math.sqrt(norm(sub(P2, P1))) || t1 + 1e-6;
    const t3 = t2 + Math.sqrt(norm(sub(P3, P2))) || t2 + 1e-6;
    const n = Math.max(1, Math.ceil(norm(sub(P2, P1)) / spacing));
    for (let k = 1; k <= n; k++) {
      const t = t1 + ((t2 - t1) * k) / n;
      const lerp = (A, B, ta, tb) => [
        ((tb - t) / (tb - ta)) * A[0] + ((t - ta) / (tb - ta)) * B[0],
        ((tb - t) / (tb - ta)) * A[1] + ((t - ta) / (tb - ta)) * B[1],
      ];
      const A1 = lerp(P0, P1, t0, t1);
      const A2 = lerp(P1, P2, t1, t2);
      const A3 = lerp(P2, P3, t2, t3);
      const B1 = lerp(A1, A2, t0, t2);
      const B2 = lerp(A2, A3, t1, t3);
      out.push(lerp(B1, B2, t1, t2));
    }
  }
  return out;
}

/** Courbe coupée à `maxLen` mètres de longueur (le dernier point est interpolé) */
function cutAtLength(pts, maxLen) {
  const out = [pts[0]];
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const step = norm(sub(pts[i], pts[i - 1]));
    if (len + step >= maxLen) {
      const t = step ? (maxLen - len) / step : 0;
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
      return out;
    }
    len += step;
    out.push(pts[i]);
  }
  return out;
}

/** Point situé à `at` mètres le long de la courbe (ou son extrémité) */
function pointAtLength(pts, at) {
  return cutAtLength(pts, at).at(-1);
}

/** Longueur d'une courbe */
function curveLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += norm(sub(pts[i], pts[i - 1]));
  return len;
}

/** Centre du cercle passant par trois points (null s'ils sont alignés) */
function circleCenter([ax, ay], [bx, by], [cx, cy]) {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  return [(a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d, (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d];
}

/**
 * Tangente de la route au carrefour quand le voisinage du nœud n'est pas fiable (crochet de liaison, nœud décalé,
 * point parasite) : on lit la route là où elle s'est éloignée de ROBUST_AWAY_M du carrefour — forcément au-delà
 * du crochet — en faisant passer un cercle par trois de ses points sur 20 m, puis on prolonge ce cercle jusqu'au
 * carrefour. Exacte pour un virage régulier.
 */
function robustTangent(curve, fallback) {
  const origin = curve[0];
  let s0 = null;
  let len = 0;
  for (let i = 1; i < curve.length; i++) {
    len += norm(sub(curve[i], curve[i - 1]));
    if (s0 === null && norm(sub(curve[i], origin)) >= ROBUST_AWAY_M) s0 = len;
  }
  if (s0 === null) return fallback;
  const a = pointAtLength(curve, s0);
  const b = pointAtLength(curve, Math.min(s0 + ROBUST_SPAN_M / 2, len));
  const c = pointAtLength(curve, Math.min(s0 + ROBUST_SPAN_M, len));
  if (norm(sub(c, a)) < 2) return unit(sub(a, origin));
  const center = circleCenter(a, b, c);
  // Ligne droite : on prolonge la route jusqu'au carrefour
  if (!center || norm(sub(a, center)) > 1e5) return unit(sub(c, a));
  // Point du cercle le plus proche du carrefour, et tangente du cercle en ce point, dans le sens de la route
  const r = unit(sub(origin, center));
  let t = [-r[1], r[0]];
  const along = sub(c, a);
  if (t[0] * along[0] + t[1] * along[1] < 0) t = [-t[0], -t[1]];
  return t;
}

/**
 * Artefact de numérisation au ras du nœud (décroché, crochet de jonction) : dans les 8 premiers mètres, un point
 * IGN impose une cassure brutale (virage de moins de 3,5 m de rayon, ce qu'aucune route ne fait) qui reste
 * isolée — le point suivant ne poursuit pas la rotation dans le même sens. Un vrai virage serré, lui, tourne
 * progressivement sur plusieurs points : il est respecté.
 * @returns {number} indice du point fautif, -1 s'il n'y en a pas
 */
function nodeKinkIndex(pts) {
  const signedTurn = (i) =>
    i + 1 < pts.length ? ((headingDeg(sub(pts[i + 1], pts[i])) - headingDeg(sub(pts[i], pts[i - 1])) + 540) % 360) - 180 : 0;
  let travelled = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const before = norm(sub(pts[i], pts[i - 1]));
    travelled += before;
    if (travelled > KINK_ZONE_M) break;
    const turn = signedTurn(i);
    const radius = Math.min(before, norm(sub(pts[i + 1], pts[i]))) / ((Math.abs(turn) * Math.PI) / 180);
    if (Math.abs(turn) <= KINK_MIN_TURN_DEG || radius >= MIN_ROAD_RADIUS_M) continue;
    const next = signedTurn(i + 1);
    const isolated = Math.sign(next) !== Math.sign(turn) || Math.abs(next) < Math.abs(turn) / 3;
    if (isolated) return i;
  }
  return -1;
}

/**
 * Route partant d'un carrefour (0, 0) : courbe lisse sur `reach` mètres, avec la tangente réelle au carrefour
 * @param {Array} pts - Points IGN en mètres, le premier étant le carrefour
 * @returns {{curve: Array, tangent: number[]}} courbe échantillonnée (carrefour inclus) et tangente au carrefour
 */
function roadCurve(pts, reach) {
  const origin = pts[0];
  let p = dedupe(pts);
  if (p.length < 2) return { curve: [origin ?? [0, 0]], tangent: [0, 1] };
  // Nœud propre : la tangente locale (cercle des 3 points voisins) est exacte, virages serrés comme coins.
  // Artefact de numérisation au ras du nœud : on lit la tangente sur la route elle-même, plus loin (robustTangent).
  // L'artefact est aussi retiré du dessin : la courbe va du carrefour au premier point de la vraie route
  const kinkAt = nodeKinkIndex(p);
  const kink = kinkAt !== -1;
  if (kink) p = [origin, ...p.slice(kinkAt + 1)];
  const local = startTangent(p);
  const full = spline(p, { spacing: 1, startDir: local });
  const tangent = kink ? robustTangent(cutAtLength(full, 60), local) : local;
  return { curve: cutAtLength(full, reach), tangent };
}

module.exports = { headingDeg, dedupe, startTangent, robustTangent, nodeKinkIndex, spline, cutAtLength, pointAtLength, curveLength, roadCurve };

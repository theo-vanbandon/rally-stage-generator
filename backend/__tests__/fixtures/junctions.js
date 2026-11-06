/**
 * Carrefours types pour tester les tulipes du roadbook sur des géométries exactes.
 *
 * Les tracés sont décrits en mètres (est, nord) autour du carrefour (0, 0), puis convertis en [lon, lat].
 */
const { segment } = require('./network');
const { buildNetwork } = require('../../services/roadNetwork');
const { describeStage, preferencesFor } = require('../../services/stageGenerator');

const LAT0 = 45;
const LON0 = 5;
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);

/** Point en mètres → [lon, lat, z] (arrondi comme les données IGN pour que les extrémités se rejoignent) */
const ll = ([x, y]) => [
  Math.round((LON0 + x / M_PER_DEG_LON) * 1e7) / 1e7,
  Math.round((LAT0 + y / M_PER_DEG_LAT) * 1e7) / 1e7,
  100,
];

/** Ligne droite de a vers b (mètres), un point tous les `step` mètres */
function straight(a, b, step = 20) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
}

/** Point à `dist` mètres dans la direction `heading` (0 = nord, 90 = est) depuis `from` */
const towards = (from, heading, dist) => {
  const h = (heading * Math.PI) / 180;
  return [from[0] + Math.sin(h) * dist, from[1] + Math.cos(h) * dist];
};

/**
 * Arc de cercle partant de `from` avec le cap `heading`, tournant de `turn` degrés (positif = droite)
 * sur un rayon `radius` mètres
 */
function arc(from, heading, turn, radius, step = 5) {
  const pts = [from];
  const n = Math.max(2, Math.ceil(((Math.abs(turn) * Math.PI) / 180) * radius / step));
  let h = heading;
  let p = from;
  const dh = turn / n;
  const chord = 2 * radius * Math.sin(((Math.abs(dh) * Math.PI) / 180) / 2);
  for (let i = 0; i < n; i++) {
    p = towards(p, h + dh / 2, chord);
    h += dh;
    pts.push(p);
  }
  return { pts, end: p, heading: h };
}

/** Route (liste de points en mètres) → tronçon BD TOPO */
const road = (pts, overrides) => segment(pts.map(ll), overrides);

/**
 * Construit un réseau autour d'un carrefour et une spéciale qui suit les tronçons `pathSegs`
 * (indices dans `segments`, dans l'ordre de passage). Chaque tronçon d'accès est prolongé par une longue
 * route d'importance 3 pour que départ et arrivée soient reliés au reste du réseau (point stop).
 * @returns {object} spéciale décrite (roadbook, géométrie…)
 */
function stageThrough(segments, pathSegs) {
  const network = buildNetwork(segments, { lat: LAT0, lon: LON0 });
  const prefs = preferencesFor(network, 'mixed');
  const edgeOfSeg = new Map(network.edges.map((e) => [e.seg, e]));

  const steps = [];
  let node = null;
  for (const segIndex of pathSegs) {
    const e = edgeOfSeg.get(segIndex);
    if (!e) throw new Error(`tronçon ${segIndex} non roulable`);
    const forward = node === null ? true : e.a === node;
    if (node === null) {
      // Premier tronçon : sens déduit du tronçon suivant
      const next = edgeOfSeg.get(pathSegs[1]);
      const reversedFits = next && (next.a === e.a || next.b === e.a);
      steps.push({ edge: e.id, forward: !reversedFits });
      node = reversedFits ? e.a : e.b;
      continue;
    }
    steps.push({ edge: e.id, forward });
    node = forward ? e.b : e.a;
  }

  const visited = new Set();
  steps.forEach(({ edge, forward }, i) => {
    const e = network.edges[edge];
    if (i === 0) visited.add(forward ? e.a : e.b);
    visited.add(forward ? e.b : e.a);
  });
  const lengthKm = steps.reduce((sum, s) => sum + network.edges[s.edge].lengthKm, 0);
  const candidate = {
    id: 'test',
    walk: { steps, lengthKm, visited },
    eval: { score: 1, twistDegPerKm: 0, straightShare: 0, urbanShare: 0 },
  };
  return describeStage(network, prefs, candidate);
}

/** Case du roadbook au carrefour (0, 0) */
const junctionCase = (stage) => {
  const [lon, lat] = ll([0, 0]);
  return stage.roadbook.find((c) => Math.abs(c.coord[0] - lon) < 1e-6 && Math.abs(c.coord[1] - lat) < 1e-6);
};

module.exports = { ll, straight, towards, arc, road, stageThrough, junctionCase };

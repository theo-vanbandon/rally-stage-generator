/**
 * Construction du graphe routier et caractérisation "rallye" de chaque tronçon
 */
const {
  haversineKm,
  bearing,
  signedAngle,
  lineLengthKm,
  resample,
  createProjection,
} = require("../utils/geometry");

const STEP_KM = 0.025; // pas de rééchantillonnage pour mesurer la courbure
const NOISE_DEG = 2; // variations de cap ignorées (bruit de numérisation)
const STRAIGHT_TOLERANCE_DEG = 6;
const STRAIGHT_MIN_KM = 0.3; // une "ligne droite" compte à partir de 300 m
const SAMPLE_EVERY = 2; // un échantillon sur 2 (50 m) conservé pour la détection de chevauchement
const DENSITY_CELL_KM = 0.25;
const DENSITY_STEP_KM = 0.05;
const DENSE_URBAN_KM = 4.5; // km de rues urbaines dans 750 m × 750 m au-delà duquel on est en centre-bourg/ville
const ANCHOR_IMPORTANCE = 3; // routes d'importance 1 à 3 : réseau principal, mène toujours quelque part
const BORDER_KM = 0.3;
const BRANCH_KEEP_M = 60; // points IGN gardés au départ de chaque route d'un carrefour (tulipes)
const BRANCH_FAR_M = 150;

/**
 * Type de revêtement d'un tronçon (null = non roulable en spéciale)
 */
function surfaceOf(seg) {
  if (seg.nature === "Route à 1 chaussée") return "paved";
  if (seg.nature === "Route empierrée") return "gravel";
  if (seg.nature === "Chemin") return "dirt";
  return null;
}

/**
 * Le tronçon peut-il accueillir une spéciale ? (indépendant du mode de revêtement)
 */
function isDrivable(seg) {
  if (!surfaceOf(seg)) return false;
  if (seg.access !== "Libre") return false;
  if (seg.private || seg.greenway) return false;
  if (seg.direction === "Sens direct" || seg.direction === "Sens inverse") return false;
  if (seg.importance <= 2) return false;
  if (seg.level === "Gué ou radier") return false;
  return true;
}

/**
 * Préférence de base selon le gabarit : les petites routes étroites sont les plus "rallye"
 */
function basePreference(seg) {
  const byImportance = { 3: 0.5, 4: 0.85, 5: 1, 6: 0.7 }[seg.importance] ?? 0.7;
  let widthFactor = 1;
  if ((seg.width && seg.width >= 6.5) || (seg.lanes && seg.lanes >= 3)) widthFactor = 0.6;
  else if (seg.width && seg.width <= 4) widthFactor = 1.1;
  else if (seg.lanes === 1) widthFactor = 1.1;
  return byImportance * widthFactor;
}

/**
 * Complète les altitudes manquantes par interpolation linéaire le long du tronçon
 */
function fillElevations(coords) {
  const z = coords.map((c) => c[2]);
  const known = z.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
  if (known.length === 0) return z;
  for (let i = 0; i < z.length; i++) {
    if (z[i] !== null) continue;
    const prev = known.filter((k) => k < i).pop();
    const next = known.find((k) => k > i);
    if (prev === undefined) z[i] = z[next];
    else if (next === undefined) z[i] = z[prev];
    else z[i] = z[prev] + ((z[next] - z[prev]) * (i - prev)) / (next - prev);
  }
  return z;
}

/**
 * Mesures géométriques d'un tronçon : sinuosité, lignes droites, caps d'entrée/sortie
 */
function measureShape(coords2d) {
  const pts = resample(coords2d, STEP_KM);
  const headings = [];
  const stepLengths = [];
  for (let i = 1; i < pts.length; i++) {
    const d = haversineKm(pts[i - 1], pts[i]);
    if (d < 1e-6) continue;
    headings.push(bearing(pts[i - 1], pts[i]));
    stepLengths.push(d);
  }

  let twistDeg = 0;
  let straightKm = 0;
  let longestStraightKm = 0;
  let runHeading = headings[0];
  let runKm = stepLengths[0] || 0;

  const closeRun = () => {
    if (runKm >= STRAIGHT_MIN_KM) straightKm += runKm;
    if (runKm > longestStraightKm) longestStraightKm = runKm;
  };

  for (let i = 1; i < headings.length; i++) {
    const delta = Math.abs(signedAngle(headings[i - 1], headings[i]));
    if (delta > NOISE_DEG) twistDeg += Math.min(delta, 90);

    if (Math.abs(signedAngle(runHeading, headings[i])) <= STRAIGHT_TOLERANCE_DEG) {
      runKm += stepLengths[i];
    } else {
      closeRun();
      runHeading = headings[i];
      runKm = stepLengths[i];
    }
  }
  closeRun();

  // Caps mesurés sur ~50 m pour ne pas dépendre du tout premier sommet
  const k = Math.min(2, pts.length - 1);
  const headStart = bearing(pts[0], pts[k]);
  const headEnd = bearing(pts[pts.length - 1 - k], pts[pts.length - 1]);

  return { pts, twistDeg, straightKm, longestStraightKm, headStart, headEnd };
}

/**
 * Supprime les centres urbains (villes, centres-bourgs) mais garde les rues des hameaux et l'habitat
 * le long des routes de campagne, très fréquent dans le Nord et classé "urbain" par l'IGN.
 *
 * Critère : densité de rues urbaines autour du tronçon (km de rues dans une fenêtre de 750 m × 750 m).
 * Ordres de grandeur mesurés : Lille ≥ 7,5 ; centre de Laventie 6,9 ; centre de Fleurbaix 5,8 ;
 * hameau des Rouges Bancs 1,7.
 *
 * @param {Array} segments
 * @param {{toXY: Function}} projection
 */
function dropDenseUrbanAreas(segments, projection) {
  const urban = segments.filter((s) => s.urban);
  const grid = new Map();
  // Clé numérique de cellule (une chaîne par point coûtait cher en mémoire sur les grandes zones)
  const cellKey = (x, y) => Math.floor(x / DENSITY_CELL_KM) * 1e6 + Math.floor(y / DENSITY_CELL_KM);

  // Échantillons de chaque rue urbaine, à plat (x, y, x, y…) : des centaines de milliers de petits tableaux sinon
  const urbanSamples = urban.map((s) => {
    const pts = resample(s.coords.map((c) => [c[0], c[1]]), DENSITY_STEP_KM);
    const flat = new Float64Array(pts.length * 2);
    pts.forEach((p, i) => {
      const [x, y] = projection.toXY(p);
      flat[2 * i] = x;
      flat[2 * i + 1] = y;
    });
    return flat;
  });
  for (const flat of urbanSamples) {
    for (let i = 0; i < flat.length; i += 2) {
      const key = cellKey(flat[i], flat[i + 1]);
      grid.set(key, (grid.get(key) || 0) + DENSITY_STEP_KM);
    }
  }

  const densityAt = (x, y) => {
    let total = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) total += grid.get(cellKey(x + dx * DENSITY_CELL_KM, y + dy * DENSITY_CELL_KM)) || 0;
    }
    return total;
  };

  // Densité médiane le long du tronçon : une route de campagne qui touche le bord d'un bourg reste utilisable
  const dense = new Set();
  urban.forEach((s, i) => {
    const flat = urbanSamples[i];
    const densities = new Float64Array(flat.length / 2);
    for (let k = 0; k < densities.length; k++) densities[k] = densityAt(flat[2 * k], flat[2 * k + 1]);
    densities.sort();
    if (densities[Math.floor((densities.length - 1) / 2)] >= DENSE_URBAN_KM) dense.add(s);
  });
  return segments.filter((s) => !dense.has(s));
}

/**
 * Gabarit d'une branche dans une tulipe : grand axe (trait épais), route, piste (pointillés)
 */
function branchKind(seg) {
  if (seg.nature === "Route empierrée" || seg.nature === "Chemin") return "track";
  if (seg.importance <= ANCHOR_IMPORTANCE || seg.nature !== "Route à 1 chaussée") return "major";
  return "road";
}

/**
 * Forme d'une route au départ d'un carrefour : ses vrais points IGN sur les 60 premiers mètres (plus le point
 * suivant, pour connaître la courbure au-delà), en décimètres (est, nord) par rapport au carrefour.
 * Les points ne sont pas rééchantillonnés : la courbe continue est reconstruite à partir d'eux (utils/curve).
 * @param {Array} coords - Tracé [lon, lat] partant du carrefour
 */
function branchShape(coords, projection) {
  const [x0, y0] = projection.toXY(coords[0]);
  const out = [];
  let travelled = 0;
  let prev = [0, 0];
  for (let i = 1; i < coords.length; i++) {
    const [x, y] = projection.toXY(coords[i]);
    let p = [(x - x0) * 1000, (y - y0) * 1000];
    const step = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    if (step === 0) continue;
    // Point très lointain (longue ligne droite) : ramené à BRANCH_FAR_M pour rester dans un Int16
    if (travelled + step > BRANCH_FAR_M) {
      const t = (BRANCH_FAR_M - travelled) / step;
      p = [prev[0] + (p[0] - prev[0]) * t, prev[1] + (p[1] - prev[1]) * t];
    }
    out.push(Math.round(p[0] * 10), Math.round(p[1] * 10));
    travelled += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
    if (travelled >= BRANCH_KEEP_M) break;
  }
  return Int16Array.from(out);
}

/**
 * Route utilisable en liaison (rejoindre le départ, quitter l'arrivée) : toute route publique,
 * y compris en ville et sur les grands axes, mais pas les chemins de terre
 */
/**
 * Vitesse moyenne estimée d'une route de liaison (km/h), pour choisir le trajet le plus rapide et estimer le temps :
 * selon l'importance IGN (1 = grand axe … 6 = desserte), plus lente en agglomération et sur route empierrée
 */
function linkSpeedKmh(seg) {
  const byImportance = { 1: 90, 2: 80, 3: 70, 4: 60, 5: 50, 6: 40 };
  let speed = byImportance[seg.importance] ?? 40;
  if (seg.nature === "Route empierrée") speed = Math.min(speed, 30);
  if (seg.urban) speed = Math.min(speed, 40);
  return speed;
}

/** Sens de circulation d'une route de liaison : 0 double sens, 1 sens de numérisation (a→b), -1 inverse (b→a) */
const linkOneWay = (seg) => (seg.direction === "Sens direct" ? 1 : seg.direction === "Sens inverse" ? -1 : 0);

function isLinkRoad(seg) {
  if (seg.nature === "Chemin") return false;
  if (seg.private) return false;
  return seg.access === "Libre" || seg.access === "A péage";
}

/**
 * Tronçon de spéciale. Sa géométrie est stockée à plat (Float64Array lon, lat : mêmes valeurs exactes, une
 * fraction de la mémoire de centaines de milliers de petits tableaux) et relue à la demande sous la forme
 * habituelle [[lon, lat], …] via `coords`.
 */
class Edge {
  constructor(fields, coords2d) {
    Object.assign(this, fields);
    const flat = new Float64Array(coords2d.length * 2);
    coords2d.forEach(([lon, lat], i) => {
      flat[2 * i] = lon;
      flat[2 * i + 1] = lat;
    });
    this.flat = flat;
  }

  get coords() {
    const { flat } = this;
    const out = new Array(flat.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = [flat[2 * i], flat[2 * i + 1]];
    return out;
  }
}

/**
 * Branche d'un carrefour (pour les tulipes). Toutes les formes sont rangées dans un seul Int16Array partagé :
 * un tableau typé par branche coûtait plus en en-têtes qu'en données. `shape` en est une vue, créée à la demande.
 */
class Branch {
  constructor(seg, kind, store, offset, length) {
    this.seg = seg;
    this.kind = kind;
    this.store = store;
    this.offset = offset;
    this.length = length;
  }

  get shape() {
    return this.store.subarray(this.offset, this.offset + this.length);
  }
}

/**
 * Construit le graphe à partir des tronçons compacts de la BD TOPO
 *
 * - edges : tronçons utilisables en spéciale (hors villes et centres-bourgs)
 * - nodes[i].links / linkIds : voisins par le réseau de liaison (toutes routes publiques) et route empruntée
 * - linkGeometries[id] / linkFrom[id] / linkSeg[id] : tracé de chaque route de liaison, son nœud de départ, son tronçon
 * - linkKm[id] / linkSpeed[id] / linkOneWay[id] : longueur, vitesse estimée (km/h) et sens de circulation (liaisons)
 * - nodes[i].branches : toutes les routes du carrefour { seg, kind, shape } pour les tulipes
 * - nodes[i].anchor : nœud relié au "reste du monde" (grand axe, agglomération, bord de la zone)
 * - nodes[i].border : nœud au bord de la zone téléchargée (sa route continue au-delà)
 *
 * @param {Array} segments - Tronçons (voir bdtopo.compactSegment)
 * @param {{lat: number, lon: number}} center - Origine de la projection locale
 * @param {{consume?: boolean}} [options] - consume : libère chaque tronçon brut (segments[i] = null) dès qu'il est
 *   traité. Le pic mémoire devient alors « le plus gros des deux » (bruts ou réseau) plutôt que leur somme : c'est ce
 *   qui permet de construire les grandes zones (100 000 tronçons) sur un serveur à 512 Mo.
 */
function buildNetwork(segments, center, { consume = false } = {}) {
  const projection = createProjection(center.lat, center.lon);
  const nodeIndex = new Map();
  const nodes = [];
  const edges = [];
  // Géométrie des routes de liaison (tracé du point stop) : tableau plat lon,lat en Float32 (précision ~3 cm)
  const linkGeometries = [];
  const linkFrom = [];
  const linkKm = [];
  const linkSpeed = [];
  const linkOneWays = [];
  // Indices des tronçons gardés pour les spéciales (des indices et non les objets : ils peuvent ainsi être libérés)
  const kept = new Set(dropDenseUrbanAreas(segments, projection));
  const stageIndex = new Uint8Array(segments.length);
  segments.forEach((seg, i) => {
    if (kept.has(seg)) stageIndex[i] = 1;
  });
  kept.clear();

  const nodeOf = (c) => {
    const key = `${c[0]},${c[1]}`;
    let idx = nodeIndex.get(key);
    if (idx === undefined) {
      idx = nodes.length;
      nodeIndex.set(key, idx);
      nodes.push({ coord: [c[0], c[1]], edges: [], links: [], linkIds: [], branches: [], roadDegree: 0, anchor: false, border: false });
    }
    return idx;
  };

  const linkSeg = [];
  // Formes des branches, écrites directement dans un tableau partagé qui grandit au besoin (voir Branch) ;
  // les branches elles-mêmes sont créées à la fin, quand le tableau a sa taille définitive
  let shapeStore = new Int16Array(1 << 16);
  let shapeUsed = 0;
  const pending = { node: [], seg: [], kind: [], offset: [], length: [] };
  const addBranch = (node, segIndex, kind, shape) => {
    if (shapeUsed + shape.length > shapeStore.length) {
      const bigger = new Int16Array(Math.max(shapeStore.length * 2, shapeUsed + shape.length));
      bigger.set(shapeStore.subarray(0, shapeUsed));
      shapeStore = bigger;
    }
    shapeStore.set(shape, shapeUsed);
    pending.node.push(node);
    pending.seg.push(segIndex);
    pending.kind.push(kind);
    pending.offset.push(shapeUsed);
    pending.length.push(shape.length);
    shapeUsed += shape.length;
  };
  segments.forEach((seg, segIndex) => {
    if (consume) segments[segIndex] = null; // la boucle garde `seg` jusqu'à la fin de ce tour, puis il est libérable
    const a = nodeOf(seg.coords[0]);
    const b = nodeOf(seg.coords[seg.coords.length - 1]);
    // Intersections du roadbook : on ne compte que les vraies routes, pas les chemins de terre
    if (seg.nature !== "Chemin") {
      nodes[a].roadDegree++;
      nodes[b].roadDegree++;
    }
    if (a === b) return;

    // Branches du carrefour pour les tulipes du roadbook : tronçon d'origine, gabarit et forme
    const kind = branchKind(seg);
    addBranch(a, segIndex, kind, branchShape(seg.coords, projection));
    addBranch(b, segIndex, kind, branchShape([...seg.coords].reverse(), projection));

    if (isLinkRoad(seg)) {
      const linkId = linkGeometries.length;
      linkGeometries.push(Float32Array.from(seg.coords.flatMap((c) => [c[0], c[1]])));
      linkFrom.push(a);
      linkSeg.push(segIndex);
      linkKm.push(lineLengthKm(seg.coords));
      linkSpeed.push(linkSpeedKmh(seg));
      linkOneWays.push(linkOneWay(seg));
      nodes[a].links.push(b);
      nodes[a].linkIds.push(linkId);
      nodes[b].links.push(a);
      nodes[b].linkIds.push(linkId);
      // Un grand axe ou une agglomération mène forcément ailleurs
      if (seg.importance <= ANCHOR_IMPORTANCE || !stageIndex[segIndex]) {
        nodes[a].anchor = true;
        nodes[b].anchor = true;
      }
    }

    if (!stageIndex[segIndex] || !isDrivable(seg)) return;

    const coords2d = seg.coords.map((c) => [c[0], c[1]]);
    const shape = measureShape(coords2d);
    // Les tronçons de quelques mètres sont gardés : aux carrefours, ils assurent la continuité du réseau
    const lengthKm = lineLengthKm(coords2d);

    const samples = [];
    for (let i = 0; i < shape.pts.length; i += SAMPLE_EVERY) samples.push(...projection.toXY(shape.pts[i]));

    const edge = new Edge(
      {
        id: edges.length,
        seg: segIndex,
        a,
        b,
        z: fillElevations(seg.coords),
        lengthKm,
        twistDeg: shape.twistDeg,
        straightKm: shape.straightKm,
        longestStraightKm: shape.longestStraightKm,
        headStart: shape.headStart,
        headEnd: shape.headEnd,
        samples: Float64Array.from(samples),
        surface: surfaceOf(seg),
        basePref: basePreference(seg),
        ref: seg.ref,
        name: seg.name,
        importance: seg.importance,
        urban: seg.urban === true,
      },
      coords2d
    );
    edges.push(edge);
    nodes[a].edges.push(edge.id);
    nodes[b].edges.push(edge.id);
  });

  const store = shapeStore.slice(0, shapeUsed); // taille exacte
  shapeStore = null;
  for (let i = 0; i < pending.node.length; i++) {
    nodes[pending.node[i]].branches.push(new Branch(pending.seg[i], pending.kind[i], store, pending.offset[i], pending.length[i]));
  }

  markBorderAnchors(nodes, projection);
  return {
    nodes,
    edges,
    projection,
    linkGeometries,
    linkFrom,
    linkSeg,
    linkKm: Float32Array.from(linkKm),
    linkSpeed: Uint8Array.from(linkSpeed),
    linkOneWay: Int8Array.from(linkOneWays),
  };
}

/**
 * Les routes qui sortent de la zone téléchargée continuent au-delà : leurs extrémités au bord sont des ancres
 */
function markBorderAnchors(nodes, projection) {
  if (nodes.length === 0) return;
  const xy = nodes.map((n) => projection.toXY(n.coord));
  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  xy.forEach(([x, y], i) => {
    if (x - x0 < BORDER_KM || x1 - x < BORDER_KM || y - y0 < BORDER_KM || y1 - y < BORDER_KM) {
      nodes[i].anchor = true;
      nodes[i].border = true;
    }
  });
}

module.exports = { buildNetwork, dropDenseUrbanAreas, isDrivable, isLinkRoad, linkSpeedKmh, branchKind, branchShape, surfaceOf, basePreference, measureShape, fillElevations };

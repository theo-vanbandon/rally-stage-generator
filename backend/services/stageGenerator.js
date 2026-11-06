/**
 * Génération de spéciales de rallye sur le graphe routier hors agglomération
 *
 * Principe :
 *  1. on lance des milliers de marches aléatoires pondérées (petites routes sinueuses favorisées,
 *     demi-tours et culs-de-sac pénalisés, jamais deux fois le même carrefour)
 *  2. chaque tracé candidat est noté (sinuosité, lignes droites, gabarit, revêtement, chevauchement)
 *  3. on retient les meilleurs tracés distincts ; la graine rend le résultat reproductible
 */
const { haversineKm, bearing, signedAngle, createRng } = require("../utils/geometry");
const { headingDeg, pointAtLength, curveLength, roadCurve } = require("../utils/curve");

// pref : préférence par revêtement (0 = interdit)
// unpaved : part de terre (empierré + chemin) exigée ; relaxedMin : plancher accepté si la zone en manque
const SURFACE_MODES = {
  asphalt: { pref: { paved: 1, gravel: 0, dirt: 0 }, unpaved: [0, 0], relaxedMin: 0 },
  gravel: { pref: { paved: 0.2, gravel: 1, dirt: 0.7 }, unpaved: [0.6, 1], relaxedMin: 0.35 },
  mixed: { pref: { paved: 0.7, gravel: 1, dirt: 0.7 }, unpaved: [0.25, 0.75], relaxedMin: 0.1 },
};

const LENGTH_PRESETS = {
  short: [5, 9],
  medium: [9, 16],
  long: [16, 25],
};

const WALKS = 6000;
const TIME_BUDGET_MS = 4000; // garde-fou ; en pratique < 500 ms
const FINALISTS = 300;
const TWIST_REF_DEG_PER_KM = 650; // sinuosité d'une très bonne route de spéciale (médiane du réseau rural ≈ 400)
// Part de tracé commune tolérée entre deux propositions, relâchée par paliers sur les petites zones
const OVERLAP_TIERS = [0.3, 0.5, 0.7, 0.9];
const SHOWN_MEMORY = 500; // tracés déjà proposés mémorisés par zone
const SHORTLIST = 6;
const ALTERNATIVES = 2;
const SPUR_KM = 1.5; // impasse plus courte = accès privé, jamais emprunté
// Hameaux et routes bordées de maisons (les centres-bourgs sont déjà exclus du graphe) :
// autorisés, comme sur les rallyes du Nord, mais la campagne reste préférée
const URBAN_FACTOR = 0.45;
const URBAN_RUN_MAX_KM = 2; // longueur max d'un passage habité d'un seul tenant
const URBAN_SHARE_MAX = 0.4; // part max de la spéciale en zone habitée
const REACH_CAP_KM = 30;
const PK_MERGE_KM = 0.03; // changement de revêtement à moins de 30 m d'un carrefour : noté dans sa case
// Nœuds de carrefour à moins de 25 m l'un de l'autre le long du tracé = un seul carrefour physique
// (l'IGN découpe souvent un carrefour décalé ou triangulaire en deux nœuds reliés par quelques mètres de route)
const JUNCTION_CLUSTER_KM = 0.025;
const STOP_MIN_KM = 0.3; // point stop : environ 300 m après l'arrivée lancée
const EXIT_WIDE_NETWORK_NODES = 300; // réseau atteint assez vaste : il mène forcément ailleurs

const clamp = (x, min, max) => Math.max(min, Math.min(max, x));

/**
 * Préférence de chaque tronçon pour un mode de revêtement (0 = interdit). Mis en cache sur le réseau.
 */
function preferencesFor(network, mode) {
  network.prefCache ??= {};
  if (network.prefCache[mode]) return network.prefCache[mode];

  const factors = SURFACE_MODES[mode].pref;
  const pref = new Float64Array(network.edges.length);
  for (const e of network.edges) pref[e.id] = e.basePref * factors[e.surface] * (e.urban ? URBAN_FACTOR : 1);

  pruneShortSpurs(network, pref);

  const usableDegree = new Uint16Array(network.nodes.length);
  for (const e of network.edges) {
    if (pref[e.id] > 0) {
      usableDegree[e.a]++;
      usableDegree[e.b]++;
    }
  }

  network.prefCache[mode] = { mode, pref, usableDegree, reach: computeReach(network, pref) };
  return network.prefCache[mode];
}

/** Indice d'un tronçon orienté : 2·id pour a→b, 2·id+1 pour b→a */
const dirIndex = (edgeId, forward) => 2 * edgeId + (forward ? 0 : 1);

/**
 * Portée de chaque tronçon orienté : plus longue distance parcourable en le prenant puis en continuant
 * sans faire demi-tour (borne supérieure, plafonnée). Évite de s'engager dans une branche trop courte.
 */
function computeReach(network, pref) {
  const { nodes, edges } = network;
  const reach = new Float32Array(edges.length * 2);
  const inQueue = new Uint8Array(edges.length * 2);
  const queue = [];

  for (const e of edges) {
    if (pref[e.id] <= 0) continue;
    for (const forward of [true, false]) {
      const d = dirIndex(e.id, forward);
      reach[d] = e.lengthKm;
      queue.push(d);
      inQueue[d] = 1;
    }
  }

  while (queue.length) {
    const d = queue.pop();
    inQueue[d] = 0;
    const e = edges[d >> 1];
    const from = d & 1 ? e.b : e.a;
    // Tout tronçon qui arrive sur "from" (sauf e lui-même) peut se prolonger par d
    for (const pid of nodes[from].edges) {
      if (pid === e.id || pref[pid] <= 0) continue;
      const p = edges[pid];
      const pd = dirIndex(pid, p.b === from);
      const candidate = Math.min(REACH_CAP_KM, p.lengthKm + reach[d]);
      if (candidate > reach[pd] + 0.05) {
        reach[pd] = candidate;
        if (!inQueue[pd]) {
          inQueue[pd] = 1;
          queue.push(pd);
        }
      }
    }
  }
  return reach;
}

/**
 * Désactive les impasses courtes (accès de ferme, chemins de maison) : on élague le graphe
 * depuis les culs-de-sac et on coupe les branches de moins de SPUR_KM
 */
function pruneShortSpurs(network, pref) {
  const { nodes, edges } = network;
  const degree = new Int32Array(nodes.length);
  for (const e of edges) {
    if (pref[e.id] > 0) {
      degree[e.a]++;
      degree[e.b]++;
    }
  }

  const depth = new Float64Array(nodes.length); // plus longue branche déjà élaguée sous ce nœud
  const removed = new Uint8Array(edges.length);
  const queue = [];
  for (let n = 0; n < nodes.length; n++) if (degree[n] === 1) queue.push(n);

  while (queue.length) {
    const n = queue.pop();
    if (degree[n] !== 1) continue;
    const eid = nodes[n].edges.find((id) => pref[id] > 0 && !removed[id]);
    if (eid === undefined) continue;
    const e = edges[eid];
    const m = e.a === n ? e.b : e.a;
    const branch = depth[n] + e.lengthKm;

    removed[eid] = 1;
    degree[n]--;
    degree[m]--;
    if (branch < SPUR_KM) pref[eid] = 0;
    depth[m] = Math.max(depth[m], branch);
    if (degree[m] === 1) queue.push(m);
  }
}

const twistPerKm = (e) => (e.lengthKm > 0 ? e.twistDeg / e.lengthKm : 0);

/** Cap d'entrée / de sortie d'un tronçon selon le sens de parcours */
const entryHeading = (e, forward) => (forward ? e.headStart : (e.headEnd + 180) % 360);
const exitHeading = (e, forward) => (forward ? e.headEnd : (e.headStart + 180) % 360);

function pickWeighted(items, weights, rng) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items.at(-1);
}

/**
 * Tirage d'un tronçon de départ, pondéré par sa qualité et sa longueur
 */
function createStartSampler(network, pref) {
  const ids = [];
  const cumulative = [];
  let total = 0;
  for (const e of network.edges) {
    if (pref[e.id] <= 0) continue;
    const quality = 0.3 + clamp(twistPerKm(e) / TWIST_REF_DEG_PER_KM, 0, 1.5);
    total += pref[e.id] ** 2 * quality * Math.min(e.lengthKm, 2);
    ids.push(e.id);
    cumulative.push(total);
  }
  return (rng) => {
    const r = rng() * total;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return ids[lo];
  };
}

/**
 * Peut-on rejoindre le reste du réseau depuis ce nœud sans emprunter la spéciale ?
 * (accès au départ, sortie de l'arrivée vers la liaison suivante)
 * Parcours en largeur sur les routes de liaison en évitant les nœuds de la spéciale, jusqu'à une ancre
 * (grand axe, agglomération, bord de zone) ou un réseau assez vaste pour mener ailleurs.
 */
function hasExit(network, from, stageNodes) {
  // Version rapide (appelée des milliers de fois par génération) : on cherche une sortie sans construire le chemin
  const { nodes } = network;
  const seen = new Set([from]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    for (const next of nodes[queue[head]].links) {
      if (seen.has(next) || stageNodes.has(next)) continue;
      if (nodes[next].anchor) return true;
      seen.add(next);
      if (seen.size >= EXIT_WIDE_NETWORK_NODES) return true;
      queue.push(next);
    }
  }
  return false;
}

/**
 * Chemin de sortie vers le reste du réseau, sans emprunter la spéciale : liste d'étapes
 * { node, link } depuis `from` (link = route de liaison empruntée pour arriver au nœud, -1 au départ).
 * null si le nœud est enfermé.
 */
function exitPath(network, from, stageNodes) {
  const { nodes } = network;
  const parent = new Map([[from, { prev: -1, link: -1 }]]);
  const queue = [from];
  const pathTo = (n) => {
    const path = [];
    for (let cur = n; cur !== -1; cur = parent.get(cur).prev) path.unshift({ node: cur, link: parent.get(cur).link });
    return path;
  };
  for (let head = 0; head < queue.length; head++) {
    const { links, linkIds } = nodes[queue[head]];
    for (let k = 0; k < links.length; k++) {
      const next = links[k];
      if (parent.has(next) || stageNodes.has(next)) continue;
      parent.set(next, { prev: queue[head], link: linkIds[k] });
      if (nodes[next].anchor || parent.size >= EXIT_WIDE_NETWORK_NODES) return pathTo(next);
      queue.push(next);
    }
  }
  return null;
}

/**
 * Une marche aléatoire depuis un tronçon de départ.
 * Elle ne s'arrête qu'une fois la longueur visée atteinte ET sur un carrefour d'où l'on peut repartir.
 */
function randomWalk(network, prefs, startEdgeId, forward, targetKm, minKm, maxKm, rng) {
  const { nodes, edges } = network;
  const { pref, usableDegree, reach } = prefs;

  const first = edges[startEdgeId];
  const steps = [{ edge: startEdgeId, forward }];
  const startNode = forward ? first.a : first.b;
  let node = forward ? first.b : first.a;
  const visited = new Set([startNode, node]);
  let lengthKm = first.lengthKm;
  let heading = exitHeading(first, forward);
  let urbanRunKm = first.urban ? first.lengthKm : 0;
  let urbanKm = urbanRunKm;

  let finishOk = false;
  for (;;) {
    if (lengthKm >= targetKm && hasExit(network, node, visited)) {
      finishOk = true;
      break;
    }
    const options = [];
    const weights = [];

    for (const eid of nodes[node].edges) {
      if (pref[eid] <= 0) continue;
      const e = edges[eid];
      const fwd = e.a === node;
      const next = fwd ? e.b : e.a;
      if (visited.has(next)) continue;
      if (lengthKm + e.lengthKm > maxKm) continue;
      if (e.urban && (urbanRunKm + e.lengthKm > URBAN_RUN_MAX_KM || urbanKm + e.lengthKm > URBAN_SHARE_MAX * maxKm)) continue;

      const turn = Math.abs(signedAngle(heading, entryHeading(e, fwd)));
      let w = pref[eid] ** 2 * (0.4 + clamp(twistPerKm(e) / TWIST_REF_DEG_PER_KM, 0, 1.6));
      if (turn > 150) w *= 0.03;
      else if (turn > 110) w *= 0.35;
      if (lengthKm + reach[dirIndex(eid, fwd)] < minKm) w *= 0.001; // branche sans issue assez longue
      if (usableDegree[next] <= 1) w *= lengthKm + e.lengthKm >= minKm ? 0.4 : 0.03;

      options.push({ eid, fwd, next });
      weights.push(w);
    }

    if (options.length === 0) break;
    const choice = pickWeighted(options, weights, rng);
    steps.push({ edge: choice.eid, forward: choice.fwd });
    visited.add(choice.next);
    const chosen = edges[choice.eid];
    lengthKm += chosen.lengthKm;
    urbanRunKm = chosen.urban ? urbanRunKm + chosen.lengthKm : 0;
    if (chosen.urban) urbanKm += chosen.lengthKm;
    heading = exitHeading(chosen, choice.fwd);
    node = choice.next;
  }

  return { steps, lengthKm, startNode, endNode: node, visited, finishOk };
}

/**
 * Part du tracé qui repasse à moins de 70 m d'une portion déjà parcourue (aller-retour, parallèles)
 */
function selfProximity(network, steps) {
  const xs = [];
  const ys = [];
  const along = [];
  let offset = 0;
  for (const { edge, forward } of steps) {
    const e = network.edges[edge];
    const s = e.samples;
    const n = s.length / 2;
    for (let k = 0; k < n; k++) {
      const i = forward ? k : n - 1 - k;
      xs.push(s[2 * i]);
      ys.push(s[2 * i + 1]);
      along.push(offset + (n > 1 ? (k / (n - 1)) * e.lengthKm : 0));
    }
    offset += e.lengthKm;
  }

  const CELL = 0.1;
  const MIN_GAP_KM = 0.7; // on ignore les points voisins le long du tracé
  const grid = new Map();
  const key = (cx, cy) => cx * 100003 + cy;
  for (let i = 0; i < xs.length; i++) {
    const k = key(Math.floor(xs[i] / CELL), Math.floor(ys[i] / CELL));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }

  let close = 0;
  for (let i = 0; i < xs.length; i++) {
    const cx = Math.floor(xs[i] / CELL);
    const cy = Math.floor(ys[i] / CELL);
    let found = false;
    for (let dx = -1; dx <= 1 && !found; dx++) {
      for (let dy = -1; dy <= 1 && !found; dy++) {
        for (const j of grid.get(key(cx + dx, cy + dy)) || []) {
          if (Math.abs(along[i] - along[j]) < MIN_GAP_KM) continue;
          const ddx = xs[i] - xs[j];
          const ddy = ys[i] - ys[j];
          if (ddx * ddx + ddy * ddy < 0.07 * 0.07) {
            found = true;
            break;
          }
        }
      }
    }
    if (found) close++;
  }
  return xs.length ? close / xs.length : 0;
}

/**
 * Note d'un tracé candidat
 */
function evaluate(network, prefs, walk, [minKm, maxKm] = [walk.lengthKm, walk.lengthKm]) {
  const { edges } = network;
  let twist = 0;
  let straightKm = 0;
  let prefKm = 0;
  let urbanKm = 0;
  let unpavedKm = 0;

  for (let i = 0; i < walk.steps.length; i++) {
    const { edge, forward } = walk.steps[i];
    const e = edges[edge];
    if (e.urban) urbanKm += e.lengthKm;
    if (e.surface !== "paved") unpavedKm += e.lengthKm;
    twist += e.twistDeg;
    straightKm += e.straightKm;
    prefKm += prefs.pref[edge] * e.lengthKm;
    if (i > 0) {
      const prev = walk.steps[i - 1];
      const turn = Math.abs(signedAngle(exitHeading(edges[prev.edge], prev.forward), entryHeading(e, forward)));
      if (turn > 20) twist += Math.min(turn, 120);
    }
  }

  const L = walk.lengthKm;
  const twistDegPerKm = twist / L;
  const deadEnds =
    (prefs.usableDegree[walk.startNode] <= 1 ? 1 : 0) + (prefs.usableDegree[walk.endNode] <= 1 ? 1 : 0);

  // Légère préférence pour le milieu de la fourchette de longueur demandée
  const half = (maxKm - minKm) / 2;
  const lengthFit = half > 0 ? 1 - clamp(Math.abs(L - (minKm + half)) / half, 0, 1) : 1;

  // Bonus revêtement : le plus de terre possible en mode terre, un vrai mélange en mode mixte
  const unpavedShare = unpavedKm / L;
  let surfaceBonus = 0;
  if (prefs.mode === "gravel") surfaceBonus = 0.3 * unpavedShare;
  else if (prefs.mode === "mixed") surfaceBonus = 0.2 * (1 - Math.abs(unpavedShare - 0.5) * 2);

  const score =
    surfaceBonus +
    0.45 * clamp(twistDegPerKm / TWIST_REF_DEG_PER_KM, 0, 1.3) +
    0.15 * lengthFit +
    0.35 * (prefKm / L) -
    0.45 * (straightKm / L) -
    0.6 * (urbanKm / L) -
    0.08 * deadEnds;

  return { score, twistDegPerKm, straightShare: straightKm / L, urbanShare: urbanKm / L, unpavedShare, overlap: 0 };
}

/**
 * Pénalité de chevauchement, appliquée seulement aux FINALISTS meilleurs candidats (calcul plus coûteux).
 * Les autres sont écartés : ils partaient déjà derrière avant pénalité.
 */
function applyOverlapPenalty(network, candidates) {
  candidates.sort((a, b) => b.eval.score - a.eval.score);
  const finalists = candidates.slice(0, FINALISTS);
  for (const c of finalists) {
    c.eval.overlap = selfProximity(network, c.walk.steps);
    c.eval.score -= 1.2 * c.eval.overlap;
  }
  return finalists.sort((a, b) => b.eval.score - a.eval.score);
}

function overlapShare(a, b, edges) {
  let shared = 0;
  let total = 0;
  for (const id of a.edgeSet) {
    total += edges[id].lengthKm;
    if (b.edgeSet.has(id)) shared += edges[id].lengthKm;
  }
  return total ? shared / total : 0;
}

/** Identifiant court et stable d'un tracé (hash FNV-1a des tronçons parcourus) */
function stageId(steps) {
  let h = 0x811c9dc5;
  for (const { edge, forward } of steps) {
    h ^= edge * 2 + (forward ? 1 : 0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function turnLabel(angle) {
  const side = angle > 0 ? "droite" : "gauche";
  const abs = Math.abs(angle);
  if (abs < 20) return "Tout droit";
  if (abs < 55) return `Légèrement à ${side}`;
  if (abs < 120) return `À ${side}`;
  return `Épingle ${side}`;
}

/**
 * Altitudes : min, max, dénivelés (avec hystérésis anti-bruit), pente max sur 200 m, profil allégé
 */
function elevationStats(cumKm, z) {
  const valid = z.filter((v) => v !== null);
  if (valid.length < 2) return null;

  let gain = 0;
  let loss = 0;
  let ref = valid[0];
  for (const v of valid) {
    if (v - ref >= 3) {
      gain += v - ref;
      ref = v;
    } else if (ref - v >= 3) {
      loss += ref - v;
      ref = v;
    }
  }

  // Profil rééchantillonné tous les 50 m
  const total = cumKm.at(-1);
  const step = 0.05;
  const profile = [];
  let j = 0;
  for (let d = 0; d <= total + 1e-9; d += step) {
    while (j < cumKm.length - 2 && cumKm[j + 1] < d) j++;
    const span = cumKm[j + 1] - cumKm[j];
    const t = span > 0 ? clamp((d - cumKm[j]) / span, 0, 1) : 0;
    const za = z[j] ?? z[j + 1];
    const zb = z[j + 1] ?? z[j];
    if (za === null || zb === null) continue;
    profile.push([d, za + (zb - za) * t]);
  }

  let maxSlope = 0;
  const window = 4; // 4 × 50 m = 200 m
  for (let i = window; i < profile.length; i++) {
    const slope = Math.abs(profile[i][1] - profile[i - window][1]) / ((profile[i][0] - profile[i - window][0]) * 1000);
    if (slope > maxSlope) maxSlope = slope;
  }

  // Profil réduit à ~200 points pour le front
  const every = Math.max(1, Math.ceil(profile.length / 200));
  const light = profile.filter((_, i) => i % every === 0 || i === profile.length - 1);

  return {
    min: Math.round(Math.min(...valid)),
    max: Math.round(Math.max(...valid)),
    gain: Math.round(gain),
    loss: Math.round(loss),
    maxSlopePct: Math.round(maxSlope * 1000) / 10,
    profile: light.map(([d, v]) => [Math.round(d * 1000) / 1000, Math.round(v)]),
  };
}

const SURFACE_LABELS = { paved: "asphalte", gravel: "route empierrée", dirt: "chemin de terre" };
const round2 = (x) => Math.round(x * 100) / 100;
const round6 = (x) => Math.round(x * 1e6) / 1e6;

// Tulipes : chaque route est une courbe continue reconstruite à partir des points IGN (utils/curve), jamais une
// suite de segments droits. Portée dessinée : assez pour montrer l'arrondi du carrefour, pas les virages suivants.
const TULIP_REACH_M = 40;
const TULIP_MIN_M = 30; // une branche plus courte (tronçon IGN de quelques mètres) est prolongée jusque-là
const BRANCH_CONTEXT_M = 60; // points IGN lus au-delà de la portée, pour connaître la courbure à son extrémité
const DRAW_STEP_M = 2.5; // pas des formes envoyées au front (courbes déjà lisses)
const HAIRPIN_GAP_DEG = 25; // écart minimal dessiné entre arrivée et sortie d'une épingle
const HAIRPIN_V_DEG = 150; // au-delà, l'épingle est dessinée en V droit
const ANGLE_AT_M = 40; // direction d'une route = vers le point de sa courbe situé 40 m plus loin
const ENTRY_FREE_M = 12; // la route d'arrivée n'est jamais coupée sur ses 12 premiers mètres

/**
 * Note de changement de revêtement, comme dans un roadbook d'organisation
 */
function surfaceChangeNote(from, to) {
  if (from === "paved") return `Début terre (${SURFACE_LABELS[to]})`;
  if (to === "paved") return "Retour asphalte";
  return `Passage sur ${SURFACE_LABELS[to]}`;
}

/**
 * Points IGN d'un tracé [lon, lat] à partir de l'indice `start`, dans le sens `dir` (+1 / -1), en mètres
 * (est, nord) par rapport au point de départ (exclu), jusqu'au premier point situé au-delà de `maxM` mètres
 */
function walkMetres(projection, coords, start, dir, maxM) {
  const [x0, y0] = projection.toXY(coords[start]);
  const pts = [];
  let travelled = 0;
  let prev = [0, 0];
  for (let i = start + dir; i >= 0 && i < coords.length && travelled < maxM; i += dir) {
    const [x, y] = projection.toXY(coords[i]);
    const p = [(x - x0) * 1000, (y - y0) * 1000];
    const step = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    if (step === 0) continue;
    travelled += step;
    pts.push(p);
    prev = p;
  }
  return pts;
}

/** Forme stockée d'une branche (décimètres, Int16) → points IGN en mètres */
const shapeMetres = (shape) => {
  const pts = [];
  for (let i = 0; i < shape.length; i += 2) pts.push([shape[i] / 10, shape[i + 1] / 10]);
  return pts;
};

/** Route partant du carrefour (0, 0) vue comme une courbe : { curve (carrefour inclus), tangent } */
const branchCurve = (pts) => roadCurve([[0, 0], ...pts], TULIP_REACH_M);

/**
 * Courbe d'une branche dans le repère de la tulipe : sens de marche vers le haut, rayon 1 = 40 m.
 * Une branche trop courte est prolongée dans sa direction finale pour rester lisible.
 * `fromBelow` (route d'arrivée) : on arrive toujours par le bas. La courbe est coupée dès qu'elle remonte
 * (plus de 3 m au-dessus de son point le plus bas, ou au niveau du carrefour) ou, passé ses 12 premiers mètres,
 * dès qu'elle sort du secteur bas (±75°) : c'est une épingle d'approche, qu'on retrouve dans la case précédente.
 */
function tulipPath(curve, arrivalHeading, { fromBelow = false } = {}) {
  const h = (arrivalHeading * Math.PI) / 180;
  const cos = Math.cos(h);
  const sin = Math.sin(h);
  let path = curve.slice(1).map(([dx, dy]) => [
    (dx * cos - dy * sin) / TULIP_REACH_M,
    (dx * sin + dy * cos) / TULIP_REACH_M,
  ]);
  if (!path.length) path = [[0, 0]];

  let cut = -1;
  if (fromBelow) {
    let lowest = 0;
    cut = path.findIndex(([x, y]) => {
      lowest = Math.min(lowest, y);
      if (Math.hypot(x, y) < ENTRY_FREE_M / TULIP_REACH_M) return false;
      const rising = y > -0.05 || y > lowest + 3 / TULIP_REACH_M;
      const offSector = Math.abs(Math.atan2(x, -y)) > (75 * Math.PI) / 180;
      return rising || offSector;
    });
    if (cut !== -1) path = path.slice(0, cut);
  }

  const len = curveLength([[0, 0], ...path]);
  const minLen = TULIP_MIN_M / TULIP_REACH_M;
  if (cut !== -1) {
    // Arrivée coupée : on prolonge droit vers le bas, dans le sens d'arrivée, jusqu'au niveau habituel
    const last = path.at(-1);
    if (last[1] > -minLen) path = [...path, [last[0], -minLen]];
  } else if (len > 0 && len < minLen) {
    const last = path.at(-1);
    const before = path.length > 1 ? path.at(-2) : [0, 0];
    const d = Math.hypot(last[0] - before[0], last[1] - before[1]) || 1;
    const extra = minLen - len;
    path = [...path, [last[0] + ((last[0] - before[0]) / d) * extra, last[1] + ((last[1] - before[1]) / d) * extra]];
  }

  // Allègement : la courbe est déjà lisse, un point tous les ~2,5 m suffit au dessin
  const every = Math.max(1, Math.round(DRAW_STEP_M));
  const light = path.filter((_, i) => i % every === every - 1 || i === path.length - 1);
  return light.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
}

/**
 * Épingles : un demi-tour (≥ HAIRPIN_V_DEG) est dessiné en V droit ; une sortie dont le tracé revient à moins de
 * HAIRPIN_GAP_DEG de la route d'arrivée (bas de la tulipe) est pivotée — sinon les deux traits épais se confondent.
 * Seul le dessin change : l'angle et le libellé (« Épingle … ») restent ceux du terrain.
 */
function openHairpin(path, exitAngle) {
  // Demi-tour (≥ 150°) : convention des roadbooks dessinés, un V net quelle que soit la forme du lacet
  if (Math.abs(exitAngle) >= HAIRPIN_V_DEG) {
    const v = (Math.sign(exitAngle) * (180 - HAIRPIN_GAP_DEG) * Math.PI) / 180;
    return [[Math.round(Math.sin(v) * 85) / 100, Math.round(Math.cos(v) * 85) / 100]];
  }
  const [x, y] = path.at(-1);
  const angle = (Math.atan2(x, y) * 180) / Math.PI; // 0 = haut, ±180 = bas (route d'arrivée)
  const limit = 180 - HAIRPIN_GAP_DEG;
  if (Math.abs(angle) <= limit) return path;
  const side = angle >= 0 ? 1 : -1;
  const rot = -(((side * limit - angle) * Math.PI) / 180);
  const [cos, sin] = [Math.cos(rot), Math.sin(rot)];
  return path.map(([px, py]) => [
    Math.round((px * cos - py * sin) * 100) / 100,
    Math.round((px * sin + py * cos) * 100) / 100,
  ]);
}

/**
 * Tulipe d'un carrefour, dans le repère du pilote (on arrive par le bas, tout droit = haut).
 *
 * Chaque route est une courbe continue reconstruite à partir de ses points IGN :
 *  - sens d'arrivée = tangente exacte de la route d'arrivée au carrefour (cercle osculateur), ce qui reste juste
 *    quand on arrive en virage, même si les points IGN sont espacés de 30 m ;
 *  - direction de chaque route = vers le point de sa courbe situé 40 m plus loin (là où elle mène) ;
 *  - dessin = la courbe elle-même sur 40 m.
 * La route d'arrivée et celle de sortie sont identifiées par leur tronçon, pas par leur angle.
 *
 * @param {object} params
 * @param {Array} params.branches - Branches du carrefour { seg, kind, shape } (ou { seg, kind, pts } en mètres)
 * @param {Array|null} params.entryPts - Points IGN de la route d'arrivée en mètres depuis le carrefour (null au départ)
 * @param {Array} params.exitPts - Points IGN de la route de sortie en mètres depuis le carrefour
 * @param {number|null} params.entrySeg - Tronçon d'arrivée
 * @param {number|null} params.exitSeg - Tronçon de sortie
 * @param {Set|null} [params.stageSegs] - Tronçons de la spéciale dans le carrefour (exclus des autres routes)
 */
function buildTulip({ branches, entryPts, exitPts, entrySeg = null, exitSeg = null, stageSegs = null }) {
  const exit = branchCurve(exitPts);
  const exitHeading = headingDeg(pointAtLength(exit.curve, ANGLE_AT_M));
  const entry = entryPts ? branchCurve(entryPts) : null;
  const arrivalHeading = entry ? (headingDeg(entry.tangent) + 180) % 360 : exitHeading;
  const kindOf = (seg) => branches.find((b) => b.seg === seg)?.kind ?? "road";

  const excluded = stageSegs ?? new Set([entrySeg, exitSeg]);
  const others = branches
    .filter((b) => !excluded.has(b.seg))
    .map((b) => {
      const { curve } = branchCurve(b.pts ?? shapeMetres(b.shape));
      return {
        angle: Math.round(signedAngle(arrivalHeading, headingDeg(pointAtLength(curve, ANGLE_AT_M)))),
        kind: b.kind,
        path: tulipPath(curve, arrivalHeading),
      };
    });

  const exitAngle = signedAngle(arrivalHeading, exitHeading);
  return {
    entry: entry ? kindOf(entrySeg) : null,
    entryPath: entry ? tulipPath(entry.curve, arrivalHeading, { fromBelow: true }) : null,
    exit: Math.round(exitAngle),
    exitKind: kindOf(exitSeg),
    exitPath: openHairpin(tulipPath(exit.curve, arrivalHeading), exitAngle),
    others,
  };
}

/**
 * Dangers et observations d'un carrefour
 */
function junctionNotes(tulip) {
  const notes = [];
  let danger = 0;
  const abs = Math.abs(tulip.exit);
  if (abs >= 150) {
    notes.push("Épingle très serrée");
    danger = 2;
  } else if (abs >= 115) {
    notes.push("Épingle");
    danger = 1;
  }
  const crossesMajor = tulip.others.some((b) => b.kind === "major");
  if (tulip.exitKind === "major" && tulip.entry !== "major") {
    notes.push("Prendre la route principale");
    danger = Math.max(danger, 1);
  } else if (tulip.entry === "major" && tulip.exitKind !== "major") {
    notes.push("Quitter la route principale");
  } else if (crossesMajor) {
    notes.push("Croisement route principale");
    danger = Math.max(danger, 1);
  }
  return { notes, danger };
}

/**
 * Tracé d'une route de liaison parcourue depuis le nœud `fromNode` (liste de [lon, lat])
 */
function linkCoords(network, link, fromNode) {
  const flat = network.linkGeometries[link];
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([round6(flat[i]), round6(flat[i + 1])]);
  return network.linkFrom[link] === fromNode ? pts : pts.reverse();
}

/**
 * Point stop : on prolonge après l'arrivée lancée en suivant la route de sortie, sur 300 m environ.
 * Si le chemin vers le reste du réseau est plus court, on continue sur les routes suivantes
 * (jamais sur la spéciale) jusqu'à la distance voulue.
 */
function findStopPoint(network, finishNode, stageNodes) {
  const { nodes } = network;
  const path = exitPath(network, finishNode, stageNodes);
  if (!path || path.length < 2) return null;

  const coords = [nodes[finishNode].coord];
  const used = new Set([finishNode]);
  let km = 0;
  let node = finishNode;
  const done = () => ({ coord: coords.at(-1), path: coords, distanceKm: round2(km), firstSeg: network.linkSeg[path[1].link] });

  // Avance le long d'une route, coupée dès que la distance voulue est atteinte ; true = point stop trouvé
  const follow = (link, next) => {
    for (const p of linkCoords(network, link, node).slice(1)) {
      km += haversineKm(coords.at(-1), p);
      coords.push(p);
      if (km >= STOP_MIN_KM) return true;
    }
    used.add(next);
    node = next;
    return false;
  };

  for (const step of path.slice(1)) {
    if (follow(step.link, step.node)) return done();
  }
  while (km < STOP_MIN_KM) {
    const { links, linkIds } = nodes[node];
    const k = links.findIndex((n) => !used.has(n) && !stageNodes.has(n));
    if (k === -1) break;
    if (follow(linkIds[k], links[k])) break;
  }
  return done();
}

/**
 * Transforme un tracé candidat en spéciale détaillée (géométrie, roadbook d'organisation, statistiques)
 *
 * Roadbook : une case par point utile, comme les roadbooks d'organisateur — CH/départ, chaque carrefour
 * (tulipe), changement de revêtement, arrivée lancée, point stop — avec kilométrages total et partiel.
 */
function describeStage(network, prefs, candidate) {
  const { nodes, edges, projection } = network;
  const { usableDegree } = prefs;
  const { steps } = candidate.walk;
  const coords = [];
  const z = [];
  const cumKm = [];
  const stepStart = []; // indice dans coords du carrefour où commence chaque tronçon
  const surfaceKm = { paved: 0, gravel: 0, dirt: 0 };
  const surfaces = []; // portions de revêtement homogène : indices dans coordinates
  const roads = [];
  let km = 0;
  let longestStraightKm = 0;

  // 1. Géométrie complète (les tulipes ont besoin de ce qui précède ET de ce qui suit chaque carrefour)
  steps.forEach(({ edge, forward }, i) => {
    const e = edges[edge];
    const pts = forward ? e.coords : [...e.coords].reverse();
    const zs = forward ? e.z : [...e.z].reverse();
    const from = Math.max(0, coords.length - 1);
    stepStart.push(from);

    pts.forEach((p, k) => {
      if (i > 0 && k === 0) return; // le carrefour est déjà présent
      if (coords.length) km += haversineKm(coords.at(-1), p);
      coords.push(p);
      z.push(zs[k]);
      cumKm.push(km);
    });

    surfaceKm[e.surface] += e.lengthKm;
    const lastSection = surfaces.at(-1);
    if (lastSection?.surface === e.surface) lastSection.to = coords.length - 1;
    else surfaces.push({ surface: e.surface, from, to: coords.length - 1, km: round2(cumKm[from]) });
    longestStraightKm = Math.max(longestStraightKm, e.longestStraightKm);
    const label = e.ref || e.name;
    if (label && roads.at(-1) !== label && !roads.includes(label)) roads.push(label);
  });

  // 2. Cases du roadbook
  const cases = [];
  const addCase = (c) => {
    const last = cases.at(-1);
    const close = last && c.km - last.km < PK_MERGE_KM;
    // Changement de revêtement juste après un carrefour : noté dans la case du carrefour
    if (close && c.type === "surface" && last.type !== "stop") {
      last.notes.push(c.direction);
      last.danger = Math.max(last.danger, c.danger);
      return;
    }
    cases.push(c);
  };
  const ahead = (index) => walkMetres(projection, coords, index, +1, BRANCH_CONTEXT_M);
  const behind = (index) => walkMetres(projection, coords, index, -1, BRANCH_CONTEXT_M);

  const first = edges[steps[0].edge];
  const startNode = steps[0].forward ? first.a : first.b;
  addCase({
    type: "start",
    km: 0,
    coord: nodes[startNode].coord,
    direction: "CH — Départ ES",
    angle: 0,
    road: first.ref || first.name || null,
    notes: [`Départ sur ${SURFACE_LABELS[first.surface]}`],
    danger: 0,
    tulip: buildTulip({ branches: nodes[startNode].branches, entryPts: null, exitPts: ahead(0), exitSeg: first.seg }),
  });

  // Carrefours rencontrés le long du tracé, regroupés : l'IGN modélise souvent un seul carrefour physique
  // (décalé, en patte d'oie, triangulaire) par deux nœuds reliés par un tronçon de quelques mètres. Une seule
  // case, une seule tulipe : arrivée avant le premier nœud, sortie après le dernier, toutes les autres routes.
  const isJunctionNode = (node) => Math.max(nodes[node].roadDegree, usableDegree[node]) >= 3;
  const nodeAtStep = (i) => (steps[i].forward ? edges[steps[i].edge].a : edges[steps[i].edge].b);
  let group = null;

  steps.forEach(({ edge }, i) => {
    if (i === 0) return;
    const e = edges[edge];
    const prevEdge = edges[steps[i - 1].edge];
    const node = nodeAtStep(i);
    const at = stepStart[i];
    const surfaceNote = prevEdge.surface === e.surface ? null : surfaceChangeNote(prevEdge.surface, e.surface);

    if (isJunctionNode(node)) {
      if (group && cumKm[at] - cumKm[group.at] < JUNCTION_CLUSTER_KM) {
        group.nodes.push(node);
        group.lastStep = i;
      } else {
        if (group) addCase(junctionCase(group));
        group = { at, firstStep: i, lastStep: i, nodes: [node], surfaceNotes: [] };
      }
      if (surfaceNote) group.surfaceNotes.push(surfaceNote);
    } else if (surfaceNote) {
      if (group) {
        addCase(junctionCase(group));
        group = null;
      }
      addCase({
        type: "surface",
        km: round2(cumKm[at]),
        coord: nodes[node].coord,
        direction: surfaceNote,
        angle: 0,
        road: e.ref || e.name || null,
        notes: [],
        danger: e.surface === "paved" ? 0 : 1,
        tulip: null,
      });
    }
  });
  if (group) addCase(junctionCase(group));

  function junctionCase(g) {
    const centerNode = g.nodes[0];
    const [cx, cy] = projection.toXY(nodes[centerNode].coord);
    // Tronçons de la spéciale dans le carrefour : arrivée, liaisons entre nœuds, sortie
    const stageSegs = new Set();
    for (let k = g.firstStep - 1; k <= g.lastStep; k++) stageSegs.add(edges[steps[k].edge].seg);
    // Routes des nœuds secondaires, replacées par rapport au premier nœud : le décalage est dessiné
    const branches = g.nodes.flatMap((n, idx) => {
      if (idx === 0) return nodes[n].branches;
      const [nx, ny] = projection.toXY(nodes[n].coord);
      const off = [(nx - cx) * 1000, (ny - cy) * 1000];
      return nodes[n].branches.map((b) => ({
        seg: b.seg,
        kind: b.kind,
        pts: [off, ...shapeMetres(b.shape).map(([x, y]) => [x + off[0], y + off[1]])],
      }));
    });
    const exitEdge = edges[steps[g.lastStep].edge];
    const tulip = buildTulip({
      branches,
      entryPts: behind(g.at),
      exitPts: ahead(g.at),
      entrySeg: edges[steps[g.firstStep - 1].edge].seg,
      exitSeg: exitEdge.seg,
      stageSegs,
    });
    const { notes, danger } = junctionNotes(tulip);
    notes.push(...g.surfaceNotes);
    return {
      type: "junction",
      km: round2(cumKm[g.at]),
      coord: nodes[centerNode].coord,
      direction: turnLabel(tulip.exit),
      angle: tulip.exit,
      road: exitEdge.ref || exitEdge.name || null,
      notes,
      danger,
      tulip,
    };
  }

  // Arrivée lancée puis point stop sur la route de sortie
  const lastStep = steps.at(-1);
  const lastEdge = edges[lastStep.edge];
  const finishNode = lastStep.forward ? lastEdge.b : lastEdge.a;
  const stop = findStopPoint(network, finishNode, candidate.walk.visited);
  const finishTulip = stop
    ? buildTulip({
        branches: nodes[finishNode].branches,
        entryPts: behind(coords.length - 1),
        exitPts: walkMetres(projection, stop.path, 0, +1, BRANCH_CONTEXT_M),
        entrySeg: lastEdge.seg,
        exitSeg: stop.firstSeg,
      })
    : null;
  cases.push({
    type: "finish",
    km: round2(km),
    coord: nodes[finishNode].coord,
    direction: "Arrivée lancée",
    angle: finishTulip?.exit ?? 0,
    road: null,
    notes: ["Fin du chronométrage"],
    danger: 0,
    tulip: finishTulip,
  });
  if (stop) {
    cases.push({
      type: "stop",
      km: round2(km + stop.distanceKm),
      coord: stop.coord,
      direction: "Point stop",
      angle: 0,
      road: null,
      notes: ["Pointage du temps — arrêt obligatoire"],
      danger: 0,
      tulip: null,
    });
  }

  cases.forEach((c, i) => {
    c.n = i + 1;
    c.partial = i === 0 ? 0 : round2(c.km - cases[i - 1].km);
  });

  const lengthKm = round2(km);
  const share = (v) => Math.round((v / candidate.walk.lengthKm) * 100);

  return {
    id: candidate.id,
    score: Math.round(candidate.eval.score * 1000) / 1000,
    geometry: {
      type: "LineString",
      coordinates: coords.map((c, i) => (z[i] === null ? c : [c[0], c[1], Math.round(z[i] * 10) / 10])),
    },
    start: coords[0],
    finish: coords.at(-1),
    stop: stop && { coord: stop.coord, path: stop.path, distanceKm: stop.distanceKm },
    roadbook: cases,
    roads,
    surfaces,
    stats: {
      lengthKm,
      twistDegPerKm: Math.round(candidate.eval.twistDegPerKm),
      straightSharePct: Math.round(candidate.eval.straightShare * 100),
      longestStraightKm: round2(longestStraightKm),
      junctions: cases.filter((c) => c.type === "junction").length,
      urbanPct: Math.round(candidate.eval.urbanShare * 100),
      surfacePct: { paved: share(surfaceKm.paved), gravel: share(surfaceKm.gravel), dirt: share(surfaceKm.dirt) },
      elevation: elevationStats(cumKm, z),
    },
  };
}

/**
 * Génère une spéciale et des alternatives
 * @param {object} network - Graphe (voir roadNetwork.buildNetwork)
 * @param {object} options
 * @param {"asphalt"|"gravel"|"mixed"} options.surface
 * @param {"short"|"medium"|"long"} options.length
 * @param {number} options.seed
 * @param {string[]} [options.avoid] - Identifiants des tracés déjà proposés, à ne pas reproposer
 */
function generateStages(network, { surface = "asphalt", length = "medium", seed = 1, avoid = [] } = {}) {
  if (!SURFACE_MODES[surface]) throw new Error(`Revêtement inconnu: ${surface}`);
  if (!LENGTH_PRESETS[length]) throw new Error(`Longueur inconnue: ${length}`);

  const prefs = preferencesFor(network, surface);
  const sampleStart = createStartSampler(network, prefs.pref);
  const rng = createRng(seed);
  const deadline = Date.now() + TIME_BUDGET_MS;

  const run = ([minKm, maxKm], [unpavedMin, unpavedMax]) => {
    const candidates = [];
    for (let i = 0; i < WALKS && Date.now() < deadline; i++) {
      const startEdge = sampleStart(rng);
      let forward = rng() < 0.5;
      if (prefs.reach[dirIndex(startEdge, forward)] < minKm) forward = !forward;
      if (prefs.reach[dirIndex(startEdge, forward)] < minKm) continue;
      const targetKm = minKm + rng() * (maxKm - minKm);
      const walk = randomWalk(network, prefs, startEdge, forward, targetKm, minKm, maxKm, rng);
      if (walk.lengthKm < minKm || !walk.finishOk) continue;
      if (!hasExit(network, walk.startNode, walk.visited)) continue;
      const evaluation = evaluate(network, prefs, walk, [minKm, maxKm]);
      if (evaluation.urbanShare > URBAN_SHARE_MAX) continue;
      if (evaluation.unpavedShare < unpavedMin || evaluation.unpavedShare > unpavedMax) continue;
      candidates.push({ walk, eval: evaluation });
    }
    return candidates;
  };

  // Essais successifs : la demande exacte, puis moins de terre si la zone en manque (une spéciale de bonne
  // longueur vaut mieux qu'un bout de piste de 2 km), puis plus courte en dernier recours
  const [minKm, maxKm] = LENGTH_PRESETS[length];
  const { unpaved, relaxedMin } = SURFACE_MODES[surface];
  const shorter = [Math.max(2, minKm * 0.5), maxKm];
  const lessUnpaved = [relaxedMin, unpaved[1]];
  const attempts = [
    { lengths: [minKm, maxKm], unpaved, relaxed: false, surfaceRelaxed: false },
    { lengths: [minKm, maxKm], unpaved: lessUnpaved, relaxed: false, surfaceRelaxed: true },
    { lengths: shorter, unpaved, relaxed: true, surfaceRelaxed: false },
    { lengths: shorter, unpaved: lessUnpaved, relaxed: true, surfaceRelaxed: true },
  ];
  let candidates = [];
  let relaxed = false;
  let surfaceRelaxed = false;
  for (const attempt of attempts) {
    candidates = run(attempt.lengths, attempt.unpaved);
    ({ relaxed, surfaceRelaxed } = attempt);
    if (candidates.length) break;
  }
  if (candidates.length === 0) {
    return { stages: [], relaxed, surfaceRelaxed, exhausted: false, candidatesCount: 0 };
  }
  const candidatesCount = candidates.length;

  candidates = applyOverlapPenalty(network, candidates);
  for (const c of candidates) {
    c.id = stageId(c.walk.steps);
    c.edgeSet = new Set(c.walk.steps.map((s) => s.edge));
  }

  const { chosen, exhausted } = selectStages(candidates, resolveAvoided(network, candidates, avoid), network.edges, rng);
  rememberShown(network, chosen);

  return {
    stages: chosen.map((c) => describeStage(network, prefs, c)),
    relaxed,
    surfaceRelaxed,
    exhausted,
    candidatesCount,
  };
}

/**
 * Tracés déjà montrés à l'utilisateur : registre du réseau, complété par les candidats du lot
 * qui portent le même identifiant (utile si le serveur a redémarré)
 */
function resolveAvoided(network, candidates, avoid) {
  const ids = new Set(avoid);
  const sets = [];
  for (const id of ids) {
    const known = network.shownStages?.get(id);
    if (known) sets.push({ edgeSet: known });
  }
  for (const c of candidates) {
    if (ids.has(c.id) && !network.shownStages?.has(c.id)) sets.push(c);
  }
  return { ids, sets };
}

function rememberShown(network, chosen) {
  network.shownStages ??= new Map();
  for (const c of chosen) {
    network.shownStages.delete(c.id);
    network.shownStages.set(c.id, c.edgeSet);
  }
  while (network.shownStages.size > SHOWN_MEMORY) {
    network.shownStages.delete(network.shownStages.keys().next().value);
  }
}

/** Sélection gloutonne (candidats triés par note) de tracés se recouvrant à moins de maxOverlap */
function greedyDistinct(candidates, maxOverlap, edges) {
  const distinct = [];
  for (const c of candidates) {
    if (distinct.every((d) => overlapShare(c, d, edges) < maxOverlap)) distinct.push(c);
    if (distinct.length >= SHORTLIST) break;
  }
  return distinct;
}

const sharesEdge = (a, b) => {
  for (const id of a.edgeSet) if (b.edgeSet.has(id)) return true;
  return false;
};

/**
 * Choisit la spéciale principale et ses alternatives.
 *
 * - Nouveauté : on écarte les tracés qui recouvrent ceux déjà proposés. Sur une petite zone, la tolérance
 *   est relâchée par paliers pour proposer des variantes plutôt que toujours le même tracé.
 * - Lisibilité : les alternatives ne partagent aucun tronçon avec la principale ni entre elles. S'il n'y en a
 *   pas assez de totalement séparées, on en propose moins.
 */
function selectStages(candidates, avoided, edges, rng) {
  let pool = null;
  let tier = OVERLAP_TIERS[0];
  for (const maxOverlap of OVERLAP_TIERS) {
    const fresh = candidates.filter(
      (c) => !avoided.ids.has(c.id) && avoided.sets.every((a) => overlapShare(c, a, edges) < maxOverlap)
    );
    if (fresh.length) {
      pool = fresh;
      tier = maxOverlap;
      break;
    }
  }

  // Tout a déjà été proposé : on fait tourner les variantes, la plus anciennement vue d'abord
  const exhausted = pool === null;
  if (exhausted) {
    const order = [...avoided.ids];
    const seenRank = (c) => order.indexOf(c.id);
    pool = [...candidates].sort((a, b) => seenRank(a) - seenRank(b));
  }

  // La spéciale principale est tirée parmi les meilleures (pondéré par le rang) : qualité + variété
  const shortlist = greedyDistinct(pool, tier, edges).slice(0, SHORTLIST);
  const main = pickWeighted(shortlist, shortlist.map((_, i) => 1 / (i + 1)), rng);

  const chosen = [main];
  for (const c of pool) {
    if (chosen.length > ALTERNATIVES) break;
    if (chosen.every((o) => o !== c && !sharesEdge(c, o))) chosen.push(c);
  }
  return { chosen, exhausted };
}

module.exports = {
  generateStages,
  hasExit,
  exitPath,
  buildTulip,
  junctionNotes,
  describeStage,
  walkMetres,
  computeReach,
  randomWalk,
  evaluate,
  selfProximity,
  turnLabel,
  elevationStats,
  preferencesFor,
  SURFACE_MODES,
  LENGTH_PRESETS,
};

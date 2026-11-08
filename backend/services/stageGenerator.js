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

// Boucle dans la spéciale : longueur de la boucle selon la longueur de la spéciale
const LOOP_PRESETS = {
  short: [1.5, 4],
  medium: [2, 6],
  long: [3, 8],
};
// Boucle avec portion commune : longueur du tronçon parcouru deux fois (dans le même sens)
const SHARED_PRESETS = {
  short: [0.3, 1.5],
  medium: [0.4, 2.5],
  long: [0.5, 3],
};
const LOOP_KINDS = ["junction", "shared"];
const LOOP_SMOOTH_KM = 0.2;
const LOOP_MIN_COMPACTNESS = 0.2; // en dessous : boucle trop allongée (deux routes parallèles) ou qui se croise
const LOOP_ARM_MIN_KM = 1; // au moins 1 km avant et après la boucle

const LENGTH_PRESETS = {
  short: [5, 9],
  medium: [9, 16],
  long: [16, 25],
};

const WALKS = 6000;
const LOOP_WALKS = 18000; // une spéciale avec boucle échoue plus souvent : plus d'essais (même budget de temps)
const LOOP_ENOUGH = 600; // candidats suffisants pour choisir
const LOOP_KEEP_PER_LOOP = 3; // variantes (bras différents) gardées par boucle : la variété vient des boucles
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
function randomWalk(network, prefs, startEdgeId, forward, targetKm, minKm, maxKm, rng, blocked = null) {
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
  // `blocked` : carrefours déjà pris par le reste de la spéciale (boucle) — interdits, et comptés pour la sortie
  const stageNodes = blocked ? { has: (n) => visited.has(n) || blocked.has(n) } : visited;

  let finishOk = false;
  for (;;) {
    if (lengthKm >= targetKm && hasExit(network, node, stageNodes)) {
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
      if (visited.has(next) || blocked?.has(next)) continue;
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
 * Spéciale avec boucle : on arrive à un carrefour pivot, on fait le tour d'une boucle qui y ramène, puis on
 * repart par une autre route. Le pivot est le seul endroit où l'on passe deux fois ; aucune route n'est
 * empruntée deux fois. Pivot = carrefour d'au moins 4 routes (arrivée, départ et retour de boucle, sortie),
 * ou carrefour décalé (deux nœuds de 3 routes à quelques mètres l'un de l'autre, comme l'IGN les découpe) :
 * 1er passage par l'un, 2e passage par l'autre.
 */
/**
 * Pivots possibles, mis en cache par revêtement : { first, second, link } — first = second pour un carrefour
 * de 4 routes et plus ; sinon deux nœuds de 3 routes reliés par le tronçon `link` (jamais emprunté)
 */
function loopHubs(network, prefs) {
  if (prefs.loopHubs) return prefs.loopHubs;
  const { nodes, edges } = network;
  const { pref, usableDegree } = prefs;
  const hubs = [];
  nodes.forEach((_, n) => {
    if (usableDegree[n] >= 4) hubs.push({ first: n, second: n, link: null });
  });
  for (const e of edges) {
    if (pref[e.id] <= 0 || e.lengthKm > JUNCTION_CLUSTER_KM || e.a === e.b) continue;
    if (usableDegree[e.a] !== 3 || usableDegree[e.b] !== 3) continue;
    hubs.push({ first: e.a, second: e.b, link: e.id }, { first: e.b, second: e.a, link: e.id });
  }
  prefs.loopHubs = hubs;
  return hubs;
}

/**
 * Compacité d'une boucle (4π·surface / périmètre²) : 1 pour un cercle, ~0,8 pour un carré, proche de 0 pour
 * un aller-retour sur deux routes parallèles ou une boucle qui se croise elle-même
 */
const loopPolygon = (network, steps) =>
  steps.flatMap(({ edge, forward }) => {
    const coords = network.edges[edge].coords;
    return (forward ? coords : [...coords].reverse()).map((p) => network.projection.toXY(p));
  });

function loopCompactness(network, steps) {
  // Mesurée sur le tracé lissé (un point tous les ~200 m) : c'est la forme d'ensemble qui compte, pas les virages
  const raw = loopPolygon(network, steps);
  const pts = [raw[0]];
  let run = 0;
  for (let i = 1; i < raw.length; i++) {
    run += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
    if (run >= LOOP_SMOOTH_KM) {
      pts.push(raw[i]);
      run = 0;
    }
  }
  let area = 0;
  let perimeter = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    area += x1 * y2 - x2 * y1;
    perimeter += Math.hypot(x2 - x1, y2 - y1);
  }
  return perimeter ? (4 * Math.PI * Math.abs(area / 2)) / perimeter ** 2 : 0;
}

/** File de priorité minimale (tas binaire) pour Dijkstra */
class MinHeap {
  constructor() {
    this.items = [];
  }
  push(key, value) {
    const a = this.items;
    a.push([key, value]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.items.length;
  }
}

/**
 * Une boucle depuis un pivot : aller au hasard (petites routes sinueuses favorisées) depuis `first` par
 * `openEdge`, puis retour le plus court vers `second` sans recroiser l'aller. Le retour peut rejoindre l'aller
 * en n'importe quel carrefour : on garde celui qui donne la longueur visée et une boucle bien ronde.
 * @returns {{steps, lengthKm, nodes, closingEdge}|null}
 */
function loopWalk(network, prefs, hub, openEdge, [minKm, maxKm], rng) {
  const { nodes, edges } = network;
  const { pref } = prefs;
  const { first, second, link } = hub;
  const e0 = edges[openEdge];
  const fwd0 = e0.a === first;
  let node = fwd0 ? e0.b : e0.a;
  if (node === first || node === second) return null;

  // 1. Aller : marche pondérée, sans revenir sur ses pas, jusqu'à ~65 % de la longueur max
  const out = [{ node: first, km: 0, step: null }, { node, km: e0.lengthKm, step: { edge: openEdge, forward: fwd0 } }];
  const outIndex = new Map([[first, 0], [node, 1]]);
  let lengthKm = e0.lengthKm;
  let heading = exitHeading(e0, fwd0);
  const outMax = maxKm * 0.65;
  while (lengthKm < outMax) {
    const options = [];
    const weights = [];
    for (const eid of nodes[node].edges) {
      if (pref[eid] <= 0) continue;
      const e = edges[eid];
      const fwd = e.a === node;
      const next = fwd ? e.b : e.a;
      if (outIndex.has(next) || next === second) continue;
      const turn = Math.abs(signedAngle(heading, entryHeading(e, fwd)));
      let w = pref[eid] ** 2 * (0.4 + clamp(twistPerKm(e) / TWIST_REF_DEG_PER_KM, 0, 1.6));
      if (turn > 150) w *= 0.03;
      else if (turn > 110) w *= 0.35;
      if (e.urban) w *= 0.3;
      options.push({ eid, fwd, next });
      weights.push(w);
    }
    if (options.length === 0) break;
    const c = pickWeighted(options, weights, rng);
    lengthKm += edges[c.eid].lengthKm;
    outIndex.set(c.next, out.length);
    out.push({ node: c.next, km: lengthKm, step: { edge: c.eid, forward: c.fwd } });
    heading = exitHeading(edges[c.eid], c.fwd);
    node = c.next;
  }
  if (out.length < 3) return null;

  // 2. Retour : Dijkstra depuis `second`, les carrefours de l'aller sont des arrivées possibles (jamais traversés).
  // Coût un peu bruité pour varier les retours ; les traversées habitées coûtent plus cher.
  const budget = maxKm - out[1].km;
  const best = new Map([[second, { cost: 0, km: 0, edge: null, prev: null }]]);
  const heap = new MinHeap();
  heap.push(0, second);
  const joins = [];
  while (heap.size) {
    const [cost, n] = heap.pop();
    const here = best.get(n);
    if (cost > here.cost) continue;
    if (outIndex.has(n) && n !== second) {
      joins.push(n);
      continue;
    }
    for (const eid of nodes[n].edges) {
      if (pref[eid] <= 0 || eid === link || eid === openEdge) continue;
      const e = edges[eid];
      const next = e.a === n ? e.b : e.a;
      if (next === second || (next === first && first !== second)) continue;
      const km = here.km + e.lengthKm;
      if (km > budget) continue;
      const c = cost + (e.lengthKm * (0.85 + rng() * 0.3) * (e.urban ? 3 : 1)) / pref[eid];
      const known = best.get(next);
      if (known && known.cost <= c) continue;
      best.set(next, { cost: c, km, edge: eid, prev: n });
      heap.push(c, next);
    }
  }

  // 3. Jonction : longueur dans la fourchette, la plus proche de la longueur visée parmi les boucles rondes
  const targetKm = minKm + rng() * (maxKm - minKm);
  const options = joins
    .map((j) => ({ j, km: out[outIndex.get(j)].km + best.get(j).km }))
    .filter(({ km }) => km >= minKm && km <= maxKm)
    .sort((a, b) => Math.abs(a.km - targetKm) - Math.abs(b.km - targetKm));
  for (const { j, km } of options.slice(0, 4)) {
    const steps = out.slice(1, outIndex.get(j) + 1).map((o) => o.step);
    const loopNodes = new Set(out.slice(0, outIndex.get(j) + 1).map((o) => o.node));
    for (let n = j; n !== second; n = best.get(n).prev) {
      const { edge, prev } = best.get(n);
      const e = edges[edge];
      steps.push({ edge, forward: e.a === n });
      loopNodes.add(prev);
    }
    if (loopCompactness(network, steps) < LOOP_MIN_COMPACTNESS) continue;
    return { steps, lengthKm: km, nodes: loopNodes, closingEdge: steps.at(-1).edge };
  }
  return null;
}

/** Point (x, y) à l'intérieur d'un polygone (parité des croisements) */
function insidePolygon([x, y], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Point d'une route à ~30 m du carrefour `from` (ou son autre bout si elle est plus courte) */
function pointNear(network, edgeId, from, km = 0.03) {
  const e = network.edges[edgeId];
  const coords = (e.a === from ? e.coords : [...e.coords].reverse()).map((p) => network.projection.toXY(p));
  let d = 0;
  for (let i = 1; i < coords.length; i++) {
    d += Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
    if (d >= km) return coords[i];
  }
  return coords.at(-1);
}

/**
 * Bras coincé (impasse avant la longueur visée) : on le coupe au dernier carrefour d'où l'on peut encore sortir,
 * s'il reste au moins LOOP_ARM_MIN_KM
 */
function truncateArm(network, prefs, walk, blocked) {
  const { edges } = network;
  const ends = [walk.startNode];
  let km = 0;
  const kms = [0];
  for (const { edge, forward } of walk.steps) {
    km += edges[edge].lengthKm;
    ends.push(forward ? edges[edge].b : edges[edge].a);
    kms.push(km);
  }
  let tried = 0;
  for (let i = ends.length - 2; i > 0 && kms[i] >= LOOP_ARM_MIN_KM && tried < 6; i--) {
    if (prefs.usableDegree[ends[i]] < 3) continue;
    tried++;
    const visited = new Set(ends.slice(0, i + 1));
    if (hasExit(network, ends[i], { has: (n) => visited.has(n) || blocked.has(n) })) {
      return { ...walk, steps: walk.steps.slice(0, i), lengthKm: kms[i], endNode: ends[i], visited, finishOk: true };
    }
  }
  return null;
}

const reverseSteps = (steps) => [...steps].reverse().map(({ edge, forward }) => ({ edge, forward: !forward }));

const shuffled = (items, rng) => {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * Bras d'entrée (arrivant en `first`) et de sortie (partant de `second`) autour d'une boucle déjà tracée :
 * ils partent vers l'extérieur, évitent la boucle et l'un l'autre, et totalisent `restKm` environ.
 * @returns {{armIn, armOut, visited}|null}
 */
function buildArms(network, prefs, { first, second, inRoads, outRoads, coreNodes, coreKm, minKm, maxKm, rng }) {
  const { edges } = network;
  const restKm = minKm + rng() * (maxKm - minKm) - coreKm;
  if (restKm < 2 * LOOP_ARM_MIN_KM) return null;

  // Un bras part du pivot vers l'extérieur, en évitant tout ce qui est déjà tracé ; quelques essais
  const arm = (from, roads, targetKm, maxArmKm, blocked) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const edgeId of roads) {
        const e = edges[edgeId];
        const fwd = e.a === from;
        if (blocked.has(fwd ? e.b : e.a)) continue;
        const walk = randomWalk(network, prefs, edgeId, fwd, targetKm, LOOP_ARM_MIN_KM, maxArmKm, rng, blocked);
        if (walk.finishOk && walk.lengthKm >= LOOP_ARM_MIN_KM) return walk;
        const cut = truncateArm(network, prefs, walk, blocked);
        if (cut) return cut;
      }
    }
    return null;
  };

  const share = 0.3 + rng() * 0.4;
  const armIn = arm(first, inRoads, restKm * share, maxKm - coreKm - LOOP_ARM_MIN_KM, coreNodes);
  if (!armIn) return null;
  const blockedOut = new Set([...coreNodes, ...armIn.visited]);
  const armOut = arm(
    second,
    outRoads.filter((id) => id !== armIn.steps[0].edge),
    Math.max(LOOP_ARM_MIN_KM, restKm - armIn.lengthKm),
    maxKm - coreKm - armIn.lengthKm,
    blockedOut
  );
  if (!armOut) return null;

  const lengthKm = armIn.lengthKm + coreKm + armOut.lengthKm;
  if (lengthKm < minKm || lengthKm > maxKm) return null;
  const visited = new Set([...blockedOut, ...armOut.visited]);
  // Le bout du bras d'entrée devient le départ : il doit rester accessible une fois toute la spéciale tracée
  if (!hasExit(network, armIn.endNode, visited)) return null;
  return { armIn, armOut, visited, lengthKm };
}

/** Routes d'un carrefour qui partent vers l'extérieur d'une boucle (une route vers l'intérieur y est enfermée) */
const outwardRoads = (network, node, roads, polygon, rng) =>
  shuffled(
    roads.filter((id) => !insidePolygon(pointNear(network, id, node), polygon)),
    rng
  );

const edgeKey = (steps) => steps.map((st) => st.edge).sort((a, b) => a - b).join(",");

/**
 * Boucle par un carrefour : bras d'entrée → pivot → boucle → pivot → bras de sortie
 * @returns {object|null} marche au même format que randomWalk (+ loopSteps : étapes qui partent du pivot)
 */
function loopStageWalk(network, prefs, [minKm, maxKm], loopRange, rng) {
  const { nodes } = network;
  const hubs = loopHubs(network, prefs);
  if (hubs.length === 0) return null;
  const hub = hubs[Math.floor(rng() * hubs.length)];
  const { first, second, link } = hub;
  const roadsAt = (n) => nodes[n].edges.filter((id) => prefs.pref[id] > 0 && id !== link);

  const openEdge = shuffled(roadsAt(first), rng)[0];
  const loop = loopWalk(network, prefs, hub, openEdge, loopRange, rng);
  if (!loop) return null;
  const polygon = loopPolygon(network, loop.steps);
  const free = (n) => roadsAt(n).filter((id) => id !== openEdge && id !== loop.closingEdge);

  const arms = buildArms(network, prefs, {
    first,
    second,
    inRoads: outwardRoads(network, first, free(first), polygon, rng),
    outRoads: outwardRoads(network, second, free(second), polygon, rng),
    coreNodes: loop.nodes,
    coreKm: loop.lengthKm,
    minKm,
    maxKm,
    rng,
  });
  if (!arms) return null;
  const { armIn, armOut } = arms;
  const nIn = armIn.steps.length;

  return {
    steps: [...reverseSteps(armIn.steps), ...loop.steps, ...armOut.steps],
    lengthKm: arms.lengthKm,
    startNode: armIn.endNode,
    endNode: armOut.endNode,
    visited: arms.visited,
    finishOk: true,
    loopKey: edgeKey(loop.steps),
    // Étapes qui partent du pivot : 1er passage (début de la boucle), 2e passage (début du bras de sortie)
    loopSteps: { kind: "junction", passes: [nIn, nIn + loop.steps.length] },
  };
}

/** Carrefours d'au moins 3 routes : points d'entrée possibles d'une portion commune */
function sharedHubs(prefs) {
  prefs.sharedHubs ??= [...prefs.usableDegree.keys()].filter((n) => prefs.usableDegree[n] >= 3);
  return prefs.sharedHubs;
}

/**
 * Boucle avec portion commune : bras d'entrée → A → portion A→B → boucle de B à A → portion A→B à nouveau
 * (même sens) → bras de sortie depuis B. Deux carrefours en T suffisent. La portion est le seul tronçon
 * parcouru deux fois, toujours dans le même sens (jamais de face-à-face).
 * @returns {object|null} marche au même format que randomWalk (+ loopSteps : passages en A, B, A, B)
 */
function sharedStageWalk(network, prefs, [minKm, maxKm], [loopMin, loopMax], [sharedMin, sharedMax], rng) {
  const { nodes, edges } = network;
  const { pref, usableDegree } = prefs;
  const hubs = sharedHubs(prefs);
  if (hubs.length === 0) return null;
  const A = hubs[Math.floor(rng() * hubs.length)];
  const roadsAt = (n) => nodes[n].edges.filter((id) => pref[id] > 0);

  // Un circuit fermé passant par A : portion commune (son début) + boucle (le reste)
  const openEdge = shuffled(roadsAt(A), rng)[0];
  const circuit = loopWalk(network, prefs, { first: A, second: A, link: null }, openEdge, [loopMin + sharedMin, loopMax + sharedMax], rng);
  if (!circuit) return null;

  // Fin de la portion : un carrefour B d'au moins 3 routes, portion et boucle de bonnes longueurs
  const cuts = [];
  let km = 0;
  for (let i = 0; i < circuit.steps.length - 1; i++) {
    const { edge, forward } = circuit.steps[i];
    km += edges[edge].lengthKm;
    if (km > sharedMax) break;
    const B = forward ? edges[edge].b : edges[edge].a;
    const loopKm = circuit.lengthKm - km;
    if (km >= sharedMin && usableDegree[B] >= 3 && loopKm >= loopMin && loopKm <= loopMax) cuts.push({ i, B, km });
  }
  if (cuts.length === 0) return null;
  const { i: cut, B, km: sharedKm } = cuts[Math.floor(rng() * cuts.length)];
  const shared = circuit.steps.slice(0, cut + 1);
  const loop = circuit.steps.slice(cut + 1);

  const polygon = loopPolygon(network, circuit.steps);
  const inFree = roadsAt(A).filter((id) => id !== shared[0].edge && id !== circuit.closingEdge);
  const outFree = roadsAt(B).filter((id) => id !== shared.at(-1).edge && id !== loop[0].edge);
  const arms = buildArms(network, prefs, {
    first: A,
    second: B,
    inRoads: outwardRoads(network, A, inFree, polygon, rng),
    outRoads: outwardRoads(network, B, outFree, polygon, rng),
    coreNodes: circuit.nodes,
    coreKm: circuit.lengthKm + sharedKm,
    minKm,
    maxKm,
    rng,
  });
  if (!arms) return null;
  const { armIn, armOut } = arms;
  const nIn = armIn.steps.length;
  const nS = shared.length;
  const nL = loop.length;

  return {
    steps: [...reverseSteps(armIn.steps), ...shared, ...loop, ...shared, ...armOut.steps],
    lengthKm: arms.lengthKm,
    startNode: armIn.endNode,
    endNode: armOut.endNode,
    visited: arms.visited,
    finishOk: true,
    loopKey: `${edgeKey(circuit.steps)}|${nS}`,
    // Étapes qui partent de A (1er passage), B (début de la boucle), A (2e passage), B (sortie)
    loopSteps: { kind: "shared", passes: [nIn, nIn + nS, nIn + nS + nL, nIn + 2 * nS + nL] },
  };
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
    // Portion commune : son 2e passage est voulu, il ne compte pas comme un repassage
    const { steps, loopSteps } = c.walk;
    const own = loopSteps?.kind === "shared" ? [...steps.slice(0, loopSteps.passes[2]), ...steps.slice(loopSteps.passes[3])] : steps;
    c.eval.overlap = selfProximity(network, own);
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

/**
 * Même tracé parcouru dans l'autre sens. Les contraintes restent vraies sans nouvelle vérification : l'arrivée
 * d'origine, qui a une sortie, devient un départ accessible ; le départ d'origine, accessible, devient une
 * arrivée ouverte (les routes à sens unique sont déjà exclues des spéciales).
 */
function reverseCandidate(candidate) {
  const steps = [...candidate.walk.steps].reverse().map(({ edge, forward }) => ({ edge, forward: !forward }));
  return {
    ...candidate,
    id: stageId(steps),
    walk: {
      ...candidate.walk,
      steps,
      startNode: candidate.walk.endNode,
      endNode: candidate.walk.startNode,
      // Le nœud de départ de l'étape i devient celui de l'étape n − i : les deux passages au pivot s'échangent
      loopSteps: candidate.walk.loopSteps && {
        kind: candidate.walk.loopSteps.kind,
        passes: candidate.walk.loopSteps.passes.map((p) => steps.length - p).reverse(),
      },
    },
  };
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

  // Dénivelés avec un seuil anti-bruit de 3 m. Ce filtre dépend du sens de lecture : on le calcule dans les deux
  // sens et on fait la moyenne, pour que le D+ d'une spéciale soit exactement le D- de son sens inverse.
  const hysteresis = (values) => {
    let up = 0;
    let down = 0;
    let ref = values[0];
    for (const v of values) {
      if (v - ref >= 3) {
        up += v - ref;
        ref = v;
      } else if (ref - v >= 3) {
        down += ref - v;
        ref = v;
      }
    }
    return [up, down];
  };
  const [upForward, downForward] = hysteresis(valid);
  const [upBackward, downBackward] = hysteresis([...valid].reverse());
  const gain = (upForward + downBackward) / 2;
  const loss = (downForward + upBackward) / 2;

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
const LOOP_NOTES = {
  junction: ["Boucle : 1er passage — entrée dans la boucle", "Boucle : 2e passage — sortie de la boucle"],
  shared: [
    "Boucle : entrée sur la portion commune (1er passage)",
    "Boucle : fin de la portion commune — départ de la boucle",
    "Boucle : retour sur la portion commune (2e passage)",
    "Boucle : fin de la portion commune — sortie de la boucle",
  ],
};

/**
 * Statistiques de la boucle. Carrefour : km du 1er passage au pivot et longueur de la boucle.
 * Portion commune : en plus, début et longueur de la portion parcourue deux fois (la boucle part de sa fin).
 */
function loopStats(loopSteps, kmAt, coordAt) {
  if (!loopSteps) return null;
  const [p0, p1, p2] = loopSteps.passes;
  if (loopSteps.kind === "shared") {
    return {
      kind: "shared",
      sharedFromKm: round2(kmAt(p0)),
      sharedKm: round2(kmAt(p1) - kmAt(p0)),
      fromKm: round2(kmAt(p1)),
      lengthKm: round2(kmAt(p2) - kmAt(p1)),
      coord: coordAt(p1),
    };
  }
  return { kind: "junction", fromKm: round2(kmAt(p0)), lengthKm: round2(kmAt(p1) - kmAt(p0)), coord: coordAt(p0) };
}

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
      if (i > 0 && k === 0) {
        // Le carrefour est déjà présent ; les deux tronçons IGN peuvent lui donner une altitude un peu différente :
        // on garde leur moyenne (même valeur dans les deux sens de parcours)
        if (z.at(-1) !== null && zs[0] !== null) z[z.length - 1] = (z.at(-1) + zs[0]) / 2;
        return;
      }
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

  // Spéciale avec boucle : le générateur indique les étapes qui partent des carrefours de la boucle
  const { loopSteps } = candidate.walk;

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
    let loopDanger = 0;
    const pass = loopSteps ? loopSteps.passes.findIndex((st) => st >= g.firstStep && st <= g.lastStep) : -1;
    if (pass >= 0) {
      notes.push(LOOP_NOTES[loopSteps.kind][pass]);
      loopDanger = 1; // attention à prendre la bonne route : on est déjà passé ici, ou on y repassera
    } else if (loopSteps?.kind === "shared" && g.firstStep > loopSteps.passes[2] && g.lastStep < loopSteps.passes[3]) {
      notes.push("Portion commune : 2e passage");
    }
    notes.push(...g.surfaceNotes);
    return {
      type: "junction",
      km: round2(cumKm[g.at]),
      coord: nodes[centerNode].coord,
      direction: turnLabel(tulip.exit),
      angle: tulip.exit,
      road: exitEdge.ref || exitEdge.name || null,
      notes,
      danger: Math.max(danger, loopDanger),
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
      loop: loopStats(loopSteps, (st) => cumKm[stepStart[st]], (st) => nodes[nodeAtStep(st)].coord),
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
 * @param {false|"junction"|"shared"} [options.loop] - Spéciale avec une boucle : on repasse par un même carrefour
 *   ("junction") ou on parcourt deux fois une même portion dans le même sens ("shared")
 */
function generateStages(network, { surface = "asphalt", length = "medium", seed = 1, avoid = [], loop: loopOption = false } = {}) {
  // Boucle : "junction" (on repasse par un carrefour) ou "shared" (portion commune) ; true = "junction"
  const loop = loopOption === true ? "junction" : LOOP_KINDS.includes(loopOption) ? loopOption : false;
  if (!SURFACE_MODES[surface]) throw new Error(`Revêtement inconnu: ${surface}`);
  if (!LENGTH_PRESETS[length]) throw new Error(`Longueur inconnue: ${length}`);

  const prefs = preferencesFor(network, surface);
  const sampleStart = createStartSampler(network, prefs.pref);
  const rng = createRng(seed);
  const deadline = Date.now() + TIME_BUDGET_MS;

  const run = ([minKm, maxKm], [unpavedMin, unpavedMax]) => {
    const candidates = [];
    for (let i = 0; i < (loop ? LOOP_WALKS : WALKS) && Date.now() < deadline; i++) {
      if (loop && (candidates.length >= LOOP_ENOUGH || (i >= LOOP_WALKS / 3 && candidates.length === 0))) break;
      let walk;
      if (loop) {
        walk =
          loop === "shared"
            ? sharedStageWalk(network, prefs, [minKm, maxKm], LOOP_PRESETS[length], SHARED_PRESETS[length], rng)
            : loopStageWalk(network, prefs, [minKm, maxKm], LOOP_PRESETS[length], rng);
        if (!walk) continue;
      } else {
        const startEdge = sampleStart(rng);
        let forward = rng() < 0.5;
        if (prefs.reach[dirIndex(startEdge, forward)] < minKm) forward = !forward;
        if (prefs.reach[dirIndex(startEdge, forward)] < minKm) continue;
        const targetKm = minKm + rng() * (maxKm - minKm);
        walk = randomWalk(network, prefs, startEdge, forward, targetKm, minKm, maxKm, rng);
        if (walk.lengthKm < minKm || !walk.finishOk) continue;
        if (!hasExit(network, walk.startNode, walk.visited)) continue;
      }
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

  if (loop) {
    // Chaque boucle est retrouvée de nombreuses fois avec des bras différents : on n'en garde que les meilleures
    // variantes, sinon les finalistes tournent tous autour de la même boucle
    const perLoop = new Map();
    candidates = candidates
      .sort((a, b) => b.eval.score - a.eval.score)
      .filter(({ walk }) => {
        const n = (perLoop.get(walk.loopKey) ?? 0) + 1;
        perLoop.set(walk.loopKey, n);
        return n <= LOOP_KEEP_PER_LOOP;
      });
  }
  candidates = applyOverlapPenalty(network, candidates);
  for (const c of candidates) {
    c.id = stageId(c.walk.steps);
    c.edgeSet = new Set(c.walk.steps.map((s) => s.edge));
  }

  const { chosen, exhausted } = selectStages(candidates, resolveAvoided(network, candidates, avoid), network.edges, rng);
  rememberShown(network, chosen);

  return {
    // Chaque spéciale est livrée avec son sens inverse : même tracé, roadbook et statistiques recalculés
    stages: chosen.map((c) => ({
      ...describeStage(network, prefs, c),
      reverse: describeStage(network, prefs, reverseCandidate(c)),
    })),
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
  loopStageWalk,
  sharedStageWalk,
  SHARED_PRESETS,
  loopWalk,
  loopHubs,
  truncateArm,
  insidePolygon,
  pointNear,
  loopPolygon,
  loopCompactness,
  LOOP_PRESETS,
  hasExit,
  exitPath,
  buildTulip,
  junctionNotes,
  describeStage,
  reverseCandidate,
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

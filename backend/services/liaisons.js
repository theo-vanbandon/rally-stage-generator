/**
 * Liaisons entre les spéciales d'un rallye, dans l'ordre choisi par l'organisateur : du point stop d'une spéciale
 * jusqu'au départ de la suivante, par le trajet le plus rapide sur les routes publiques (sens interdits respectés).
 *
 * Une liaison est TOUJOURS proposée : dans la réalité il existe toujours un chemin, quitte à faire un détour ou à
 * organiser une traversée. On cherche par niveaux, du plus propre au moins bon, et on signale le compromis :
 *   1. aucune spéciale empruntée ni traversée, pas de demi-tour au point stop
 *   2. seules l'ES qu'on quitte (des concurrents y roulent encore) et celle qu'on rejoint sont évitées : la liaison
 *      peut passer par une autre ES (fermée à un autre moment de la journée)
 *   — la route API réessaie 1 et 2 sur une zone élargie avant de descendre plus bas —
 *   3. demi-tour autorisé après le point stop
 *   4. traversée de l'ES quittée ou rejointe à un carrefour, sans jamais rouler dessus (point de traversée gardé)
 *   5. dernier recours : une portion de spéciale est empruntée
 */
const { haversineKm } = require("../utils/geometry");

const coordKey = (c) => `${c[0]},${c[1]}`;
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const AHEAD_SPEED_KMH = 50; // bout de route entre le point stop et le premier carrefour
const AVOID_FACTOR = 30; // dernier recours : une route de spéciale « coûte » 30 fois son temps, on en prend le moins possible

/** Index coordonnées → nœud, mis en cache sur le réseau */
function nodeIndex(network) {
  network.nodeByCoord ??= new Map(network.nodes.map((n, i) => [coordKey(n.coord), i]));
  return network.nodeByCoord;
}

/** Carrefours (nœuds du réseau) par lesquels passe un tracé, dans l'ordre */
function stageNodeList(network, coordinates) {
  const index = nodeIndex(network);
  const list = [];
  for (const c of coordinates) {
    const n = index.get(coordKey(c));
    if (n !== undefined && list.at(-1) !== n) list.push(n);
  }
  return list;
}

/** Carrefours par lesquels passe un tracé */
const stageNodes = (network, coordinates) => new Set(stageNodeList(network, coordinates));

/** Routes parcourues par un tracé : paires de carrefours consécutifs */
function stageRoads(network, coordinates) {
  const list = stageNodeList(network, coordinates);
  return new Set(list.slice(1).map((n, i) => pairKey(list[i], n)));
}

/** Tracé d'une route de liaison parcourue depuis le nœud `from` */
function linkCoords(network, link, from) {
  const flat = network.linkGeometries[link];
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([Math.round(flat[i] * 1e6) / 1e6, Math.round(flat[i + 1] * 1e6) / 1e6]);
  return network.linkFrom[link] === from ? pts : pts.reverse();
}

/** La route de liaison `link` peut-elle être prise depuis le nœud `from` ? (sens interdits) */
function canDrive(network, link, from) {
  const oneWay = network.linkOneWay[link];
  if (oneWay === 0) return true;
  const forward = network.linkFrom[link] === from;
  return oneWay === 1 ? forward : !forward;
}

/** File de priorité minimale */
class MinHeap {
  constructor() {
    this.items = [];
  }
  push(key, value) {
    const a = this.items;
    a.push([key, value]);
    for (let i = a.length - 1; i > 0; ) {
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
      for (let i = 0; ; ) {
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
 * Trajet le plus rapide (Dijkstra sur le temps) de `source` à `target`
 * @param {Set<number>} closed - Carrefours interdits ; `target` reste atteignable
 * @param {number|null} noUturnTo - Nœud vers lequel on ne peut pas repartir au premier pas (demi-tour)
 * @param {{crossable?: Set<number>, roads?: Set<string>, avoid?: Set<string>}} [options] - crossable : carrefours
 *   fermés que l'on peut traverser (on y arrive et on en repart par d'autres routes) ; roads : routes interdites ;
 *   avoid : routes très pénalisées, prises seulement s'il n'y a pas d'autre moyen (paires de nœuds)
 * @returns {{coords: number[][], nodes: number[], links: number[], km: number, hours: number}|null}
 */
function fastestPath(network, source, target, closed, noUturnTo = null, { crossable = null, roads = null, avoid = null } = {}) {
  const { nodes, linkKm, linkSpeed } = network;
  // hours : coût (temps, pénalités comprises) ; drive : vrai temps de conduite
  const best = new Map([[source, { hours: 0, km: 0, drive: 0, prev: null, link: null }]]);
  const heap = new MinHeap();
  heap.push(0, source);
  while (heap.size) {
    const [hours, n] = heap.pop();
    const here = best.get(n);
    if (hours > here.hours) continue;
    if (n === target) break;
    const { links, linkIds } = nodes[n];
    for (let k = 0; k < links.length; k++) {
      const next = links[k];
      const link = linkIds[k];
      if (next !== target && closed.has(next) && !crossable?.has(next)) continue;
      if (roads?.has(pairKey(n, next))) continue;
      if (n === source && next === noUturnTo) continue;
      if (!canDrive(network, link, n)) continue;
      const h = hours + ((linkKm[link] / linkSpeed[link]) * (avoid?.has(pairKey(n, next)) ? AVOID_FACTOR : 1));
      const known = best.get(next);
      if (known && known.hours <= h) continue;
      best.set(next, { hours: h, km: here.km + linkKm[link], drive: here.drive + linkKm[link] / linkSpeed[link], prev: n, link });
      heap.push(h, next);
    }
  }
  const end = best.get(target);
  if (!end) return null;

  const coords = [nodes[target].coord];
  const path = [target];
  const links = [];
  for (let n = target; best.get(n).prev !== null; n = best.get(n).prev) {
    const { prev, link } = best.get(n);
    const pts = linkCoords(network, link, prev).slice(0, -1);
    pts[0] = nodes[prev].coord; // carrefour : coordonnée exacte (le tracé des routes est stocké en Float32)
    coords.unshift(...pts);
    path.unshift(prev);
    links.unshift(link);
  }
  return { coords, nodes: path, links, km: end.km, hours: end.drive };
}

const lengthOf = (coords) => coords.slice(1).reduce((sum, c, i) => sum + haversineKm(coords[i], c), 0);

/** Niveaux de recherche (voir en tête de fichier) */
const TIERS = [
  { tier: 1, closed: "all" },
  { tier: 2, closed: "live" },
  { tier: 3, closed: "live", uturn: true },
  { tier: 4, closed: "live", uturn: true, cross: true },
  { tier: 5, closed: "none", uturn: true, avoidStages: true },
];
const CLEAN_TIERS = 2; // niveaux réessayés sur une zone élargie avant d'accepter un compromis plus fort

/**
 * Liaisons entre spéciales consécutives
 * @param {object} network
 * @param {object[]} stages - Spéciales dans l'ordre du rallye, chacune dans son sens :
 *   { start, finish, stop: { ahead: { coords, node, from } } | null, coordinates }
 * @param {{only?: Set<number>, maxTier?: number}} [options] - only : liaisons à calculer (i = de l'ES i à i + 1) ;
 *   maxTier : compromis maximal accepté (au-delà, la liaison est rendue avec ok: false)
 * @returns {object[]} { from, to, ok, coordinates, km, minutes, tier, warnings: string[] }
 */
function computeLiaisons(network, stages, { only = null, maxTier = TIERS.length } = {}) {
  const index = nodeIndex(network);
  const nodeSets = stages.map((s) => stageNodes(network, s.coordinates));
  const roadSets = stages.map((s) => stageRoads(network, s.coordinates));
  const all = new Set(nodeSets.flatMap((set) => [...set]));
  const allRoads = new Set(roadSets.flatMap((set) => [...set]));

  const liaisons = [];
  for (let i = 0; i + 1 < stages.length; i++) {
    if (only && !only.has(i)) continue;
    const from = stages[i];
    const to = stages[i + 1];
    const ahead = from.stop?.ahead;
    // Départ : la suite de la route du point stop (sinon l'arrivée, si la spéciale n'a pas de point stop)
    const source = index.get(coordKey(ahead?.node ?? from.finish));
    const target = index.get(coordKey(to.start));
    const noUturn = ahead?.from ? index.get(coordKey(ahead.from)) ?? null : null;
    const live = new Set([...nodeSets[i], ...nodeSets[i + 1]]);
    const liveRoads = new Set([...roadSets[i], ...roadSets[i + 1]]);

    let found = null;
    if (source !== undefined && target !== undefined) {
      for (const t of TIERS.filter((tt) => tt.tier <= maxTier)) {
        const closed = t.closed === "all" ? all : t.closed === "live" ? live : new Set();
        const options = t.cross ? { crossable: live, roads: liveRoads } : t.avoidStages ? { avoid: allRoads } : {};
        const path = fastestPath(network, source, target, closed, t.uturn ? null : noUturn, options);
        if (path) {
          found = { tier: t.tier, path };
          break;
        }
      }
    }
    if (!found) {
      liaisons.push({ from: i, to: i + 1, ok: false });
      continue;
    }

    // Compromis à signaler
    const { path, tier } = found;
    const warnings = [];
    if (noUturn !== null && path.nodes[1] === noUturn) warnings.push("demi-tour après le point stop");
    const inner = path.nodes.slice(1, -1);
    nodeSets.forEach((set, k) => {
      if (!inner.some((n) => set.has(n))) return;
      const alongKm = path.links.reduce(
        (sum, link, j) => sum + (roadSets[k].has(pairKey(path.nodes[j], path.nodes[j + 1])) ? network.linkKm[link] : 0),
        0
      );
      if (alongKm > 0) warnings.push(`emprunte ${alongKm.toFixed(1)} km de l'ES${k + 1} (aucun autre chemin dans la zone)`);
      else if (k === i || k === i + 1) warnings.push(`traverse l'ES${k + 1} à un carrefour (point de traversée à organiser)`);
      else warnings.push(`passe par l'ES${k + 1} : à faire en dehors de sa fermeture`);
    });

    const lead = ahead?.coords ?? [];
    const leadKm = lengthOf(lead);
    liaisons.push({
      from: i,
      to: i + 1,
      ok: true,
      tier,
      warnings,
      coordinates: [...lead.slice(0, -1), ...path.coords],
      km: Math.round((leadKm + path.km) * 100) / 100,
      minutes: Math.max(1, Math.round((leadKm / AHEAD_SPEED_KMH + path.hours) * 60)),
    });
  }
  return liaisons;
}

module.exports = { computeLiaisons, fastestPath, stageNodes, stageRoads, canDrive, CLEAN_TIERS };

/**
 * Roadbook d'une liaison, du point stop d'une spéciale au contrôle horaire (CH) de la suivante.
 *
 * Contrairement à une spéciale, on ne fait pas une case par carrefour (illisible dans un bourg) : seulement là où
 * le pilote doit agir ou risque de se tromper.
 *  - il tourne franchement (≥ 30°) ;
 *  - la route change (numéro ou nom) ;
 *  - une autre route part presque dans le même axe (fourche) ;
 *  - il croise une route principale ;
 *  - la liaison traverse une spéciale (point de traversée à organiser) ;
 *  - rond-point : une seule case, avec le numéro de sortie.
 * Les tulipes sont celles des spéciales (même dessin, même repère).
 */
const { haversineKm } = require("../utils/geometry");
const { canDrive, linkLabel, isRoundabout } = require("./roadNetwork");
const { buildTulip, groupBranches, junctionNotes, turnLabel, walkMetres, BRANCH_CONTEXT_M, JUNCTION_CLUSTER_KM } = require("./stageGenerator");

const TURN_DEG = 30; // en deçà on suit la route : pas de case, sauf changement de route ou fourche
const FORK_DEG = 35; // une autre route à moins de 35° de la nôtre : il faut dire laquelle prendre
const MERGE_DEG = 35; // rond-point : branches à moins de 35° l'une de l'autre = une seule route (deux chaussées)
const MIN_GAP_DEG = 30; // tulipe de liaison : écart minimal dessiné entre la flèche et une autre route
const SAME_DIR_DEG = 20; // tulipe de liaison : routes à moins de 20° l'une de l'autre = une seule
const NEAR_CASE_KM = 0.06; // deux cases à moins de 60 m : la moins utile s'efface
const MINOR_DEG = 55; // en deçà : « tout droit » ou « légèrement » (voir turnLabel)
const APPROACH_KM = 0.08; // îlot séparant les deux sens d'une route avant ou après un rond-point : même case
const RING_REACH_M = 35; // position d'une route autour du rond-point : lue à 35 m au-delà de l'anneau
const round2 = (v) => Math.round(v * 100) / 100;
const angleGap = (a, b) => Math.abs(((a - b + 360 + 180) % 360) - 180);
/** Même route ? « D947 » et « D947/D947 » (tronçon commun à deux numéros), oui ; deux routes sans nom, aussi */
const sameRoad = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const refs = new Set(a.split("/"));
  return b.split("/").some((r) => refs.has(r));
};

/**
 * Tulipe de liaison schématique, comme sur un carnet d'itinéraire : traits droits (la forme exacte du virage compte
 * pour une spéciale, pas pour une liaison), une route par direction, et toujours un écart net entre la flèche et
 * les autres routes, pour qu'on voie au premier coup d'œil quelle branche prendre. L'angle de sortie reste le vrai.
 */
function schematize(tulip) {
  const { exit } = tulip;
  const side = (a) => (((a - exit + 540) % 360) - 180 >= 0 ? 1 : -1); // de quel côté de la flèche
  const clampEntry = (a) => Math.max(-180 + MIN_GAP_DEG, Math.min(180 - MIN_GAP_DEG, a));
  const others = [];
  // Les plus importantes d'abord : en cas de doublon, on garde la route principale
  const sorted = [...tulip.others].sort((a, b) => (a.kind === "major" ? 0 : 1) - (b.kind === "major" ? 0 : 1));
  for (const o of sorted) {
    let angle = o.angle;
    if (angleGap(angle, exit) < MIN_GAP_DEG) angle = exit + side(angle) * MIN_GAP_DEG;
    angle = clampEntry(((angle + 540) % 360) - 180);
    if (angleGap(angle, exit) < MIN_GAP_DEG - 1) continue; // coincée entre la flèche et l'arrivée : déjà représentée
    if (others.some((k) => angleGap(k.angle, angle) < SAME_DIR_DEG)) continue;
    others.push({ angle: Math.round(angle), kind: o.kind, path: null });
  }
  Object.assign(tulip, { others, entryPath: null, exitPath: null });
}

/** Première route de liaison reliant directement deux carrefours */
function linkBetween(network, a, b) {
  const { links, linkIds } = network.nodes[a];
  const k = links.indexOf(b);
  return k === -1 ? null : linkIds[k];
}

/** Numéro de sortie lisible : « 1re », « 2e »… */
const exitOrdinal = (n) => (n === 1 ? "1re" : `${n}e`);

/**
 * @param {object} network
 * @param {object} params
 * @param {number[][]} params.lead - Bout de route du point stop au premier carrefour (vide sans point stop)
 * @param {{coords: number[][], nodes: number[], links: number[]}} params.path - Trajet (voir liaisons.fastestPath)
 * @param {number|null} params.entryLink - Route empruntée pour arriver au premier carrefour (celle du point stop)
 * @param {boolean} params.uturn - La liaison commence par un demi-tour
 * @param {Map<number, string[]>} params.nodeNotes - Observations imposées à certains carrefours (traversée d'ES…)
 * @param {string} params.fromEs - « ES1 »
 * @param {string} params.toEs - « ES2 »
 * @returns {object[]} Cases, au même format que celles des spéciales
 */
function liaisonRoadbook(network, { lead, path, entryLink, uturn, nodeNotes, fromEs, toEs }) {
  const { nodes, projection, linkGeometries, linkSeg } = network;
  const N = path.nodes.length - 1; // dernier carrefour : le départ de l'ES suivante

  // Tracé complet (point stop → CH) et position de chaque carrefour du trajet dans ce tracé
  const leadPart = lead.length > 1 ? lead.slice(0, -1) : [];
  const full = [...leadPart, ...path.coords];
  const pos = [leadPart.length];
  path.links.forEach((link, j) => pos.push(pos[j] + linkGeometries[link].length / 2 - 1));
  const cumKm = [0];
  for (let i = 1; i < full.length; i++) cumKm.push(cumKm[i - 1] + haversineKm(full[i - 1], full[i]));
  const kmAt = (k) => cumKm[Math.min(pos[k], cumKm.length - 1)];

  const entryOf = (k) => (k === 0 ? entryLink : path.links[k - 1]);
  const isJunction = (k) => nodes[path.nodes[k]].links.length >= 3;
  const cases = [];

  cases.push({
    type: "stop",
    km: 0,
    coord: full[0],
    direction: `Point stop ${fromEs} — départ liaison`,
    angle: 0,
    road: linkLabel(network, path.links[0] ?? -1),
    notes: [`Liaison vers le CH de ${toEs}`, ...(uturn ? ["Demi-tour après le point stop"] : [])],
    danger: uturn ? 1 : 0,
    tulip: null,
  });

  // Ronds-points. Une route à deux chaussées se sépare autour d'un îlot avant l'anneau (et s'y rejoint après) : ce
  // carrefour, dont les autres branches ne mènent qu'à l'anneau, fait partie de la case du rond-point.
  const ringNode = (n) => nodes[n].linkIds.some((l) => isRoundabout(network, l));
  const leadsToRing = (from, n) => ringNode(n) || nodes[n].links.some((m) => m !== from && ringNode(m));
  const islandSplit = (m) => {
    const n = path.nodes[m];
    const others = nodes[n].links.filter((o) => o !== path.nodes[m - 1] && o !== path.nodes[m + 1]);
    return others.length > 0 && others.every((o) => leadsToRing(n, o));
  };
  // Indice du carrefour où l'on entre sur un anneau à moins de `km` de k, -1 sinon
  const ringAhead = (k, km) => {
    for (let j = k; j < N && kmAt(j) - kmAt(k) < km; j++) if (isRoundabout(network, path.links[j])) return j;
    return -1;
  };

  let ringExitKm = -Infinity; // kilométrage de la dernière sortie de rond-point
  for (let k = 0; k < N; ) {
    if (entryOf(k) === null) {
      k++;
      continue;
    }
    let ringStart = isRoundabout(network, path.links[k]) ? k : -1;
    if (ringStart < 0 && isJunction(k)) {
      const r = ringAhead(k, APPROACH_KM);
      if (r >= 0 && (islandSplit(k) || kmAt(r) - kmAt(k) < JUNCTION_CLUSTER_KM)) ringStart = r;
    }

    if (ringStart >= 0) {
      let ringEnd = ringStart; // carrefour où l'on quitte l'anneau
      while (ringEnd < N && isRoundabout(network, path.links[ringEnd])) ringEnd++;
      let last = ringEnd;
      // Îlot juste après la sortie : même case
      for (let j = ringEnd + 1; j < N && kmAt(j) - kmAt(ringEnd) < APPROACH_KM; j++) {
        if (!isJunction(j)) continue;
        if (islandSplit(j)) last = j;
        break;
      }
      cases.push(roundaboutCase(k, ringStart, ringEnd));
      ringExitKm = kmAt(last);
      k = last + 1;
      continue;
    }

    if (!isJunction(k)) {
      k++;
      continue;
    }
    // Carrefour ordinaire ; nœuds IGN très proches regroupés (carrefour décalé)
    let last = k;
    while (last + 1 < N && isJunction(last + 1) && kmAt(last + 1) - kmAt(k) < JUNCTION_CLUSTER_KM) last++;
    const c = junctionCase(k, last);
    // Juste avant ou après un rond-point, passer tout droit (la rue change seulement de nom) ne mérite pas de case :
    // la case du rond-point suffit. Un vrai virage, ou une consigne (traversée d'ES), garde la sienne.
    const nearRing = ringAhead(k, APPROACH_KM) >= 0 || kmAt(k) - ringExitKm < APPROACH_KM;
    const plain = c && Math.abs(c.angle) < TURN_DEG && !path.nodes.slice(k, last + 1).some((n) => nodeNotes.has(n));
    if (c && !(nearRing && plain)) cases.push(c);
    k = last + 1;
  }

  function junctionCase(k, last) {
    const groupNodes = path.nodes.slice(k, last + 1);
    const segs = new Set([linkSeg[entryOf(k)], ...path.links.slice(k, last + 1).map((l) => linkSeg[l])]);
    const tulip = buildTulip({
      branches: groupBranches(network, groupNodes),
      entryPts: walkMetres(projection, full, pos[k], -1, BRANCH_CONTEXT_M),
      exitPts: walkMetres(projection, full, pos[k], +1, BRANCH_CONTEXT_M),
      entrySeg: linkSeg[entryOf(k)],
      exitSeg: linkSeg[path.links[last]],
      stageSegs: segs,
      withSeg: true,
    });
    const roadIn = linkLabel(network, entryOf(k));
    const roadOut = linkLabel(network, path.links[last]);
    // Terre-plein central : la route se sépare en deux chaussées à sens unique (ou s'y rejoint). La chaussée d'en face
    // (même route, sens unique, parallèle à l'entrée ou à la sortie) n'est pas une autre route.
    const sideLink = new Map();
    for (const n of groupNodes) nodes[n].linkIds.forEach((l) => sideLink.set(linkSeg[l], l));
    const isTwin = (o) => {
      const l = sideLink.get(o.seg);
      if (l === undefined || network.linkOneWay[l] === 0) return false;
      const parallel = angleGap(o.angle, 180) < FORK_DEG || angleGap(o.angle, tulip.exit) < FORK_DEG;
      const label = linkLabel(network, l);
      return parallel && (sameRoad(label, roadIn) || sameRoad(label, roadOut));
    };
    tulip.others = tulip.others.filter((o) => !isTwin(o)).map(({ seg, ...o }) => o);
    // Même route, une chaussée devenue « 2 chaussées » : ce n'est pas « prendre la route principale »
    if (sameRoad(roadIn, roadOut) && tulip.entry) tulip.exitKind = tulip.entry;
    schematize(tulip);
    const imposed = groupNodes.flatMap((n) => nodeNotes.get(n) ?? []);
    const startUturn = uturn && k === 0;
    const needed =
      startUturn ||
      imposed.length > 0 ||
      Math.abs(tulip.exit) >= TURN_DEG ||
      !sameRoad(roadIn, roadOut) ||
      tulip.others.some((o) => angleGap(o.angle, tulip.exit) < FORK_DEG) ||
      (tulip.others.some((o) => o.kind === "major") && tulip.entry !== "major" && tulip.exitKind !== "major");
    if (!needed) return null;
    const { notes, danger } = junctionNotes(tulip);
    return {
      type: "junction",
      km: round2(kmAt(k)),
      coord: nodes[path.nodes[k]].coord,
      direction: startUturn ? "Demi-tour" : turnLabel(tulip.exit),
      angle: tulip.exit,
      road: roadOut,
      notes: [...notes, ...imposed],
      danger: Math.max(danger, imposed.length ? 1 : 0),
      tulip,
      // « Tout droit » ou « légèrement » sans consigne : s'efface devant une case voisine trop proche (voir plus bas)
      minor: !startUturn && imposed.length === 0 && Math.abs(tulip.exit) < MINOR_DEG,
    };
  }

  // Rond-point : tulipe schématique comme sur les roadbooks. L'entrée est en bas ; chaque route est placée selon
  // sa position autour de l'anneau (vue du ciel), pas selon la direction de la route à l'entrée. Numéro de sortie
  // compté dans le sens de circulation (antihoraire).
  // k : premier carrefour de la case, ringStart / ringEnd : carrefours où l'on entre sur l'anneau et où on le quitte
  function roundaboutCase(k, ringStart, ringEnd) {
    const ring = new Set([path.nodes[ringStart]]);
    const queue = [path.nodes[ringStart]];
    while (queue.length) {
      const n = queue.pop();
      nodes[n].links.forEach((next, idx) => {
        if (!ring.has(next) && isRoundabout(network, nodes[n].linkIds[idx])) {
          ring.add(next);
          queue.push(next);
        }
      });
    }
    const ringXY = [...ring].map((n) => projection.toXY(nodes[n].coord));
    const center = [ringXY.reduce((s, p) => s + p[0], 0) / ringXY.length, ringXY.reduce((s, p) => s + p[1], 0) / ringXY.length];
    const rel = ([x, y]) => [(x - center[0]) * 1000, (y - center[1]) * 1000]; // mètres depuis le centre
    const radius = ringXY.reduce((s, p) => s + Math.hypot(...rel(p)), 0) / ringXY.length;
    const reach = radius + RING_REACH_M;
    // Point d'une route assez loin du centre pour dire où elle part (au-delà des îlots)
    const outer = (pts) => pts.find((q) => Math.hypot(...q) >= reach) ?? pts.at(-1) ?? [0, -1];
    const along = (from, dir) => {
      const pts = [];
      for (let i = from + dir; i >= 0 && i < full.length; i += dir) {
        pts.push(rel(projection.toXY(full[i])));
        if (Math.hypot(...pts.at(-1)) >= reach) break;
      }
      return pts;
    };
    const bearing = ([x, y]) => (Math.atan2(x, y) * 180) / Math.PI;
    const entryBearing = bearing(outer(along(pos[ringStart], -1)));
    // Angle dans la tulipe : 0 = en face de l'entrée, positif = à droite
    const tulipAngle = (pt) => Math.round(((bearing(pt) - entryBearing + 720) % 360) - 180);

    const entryLink = ringStart > k ? path.links[ringStart - 1] : entryOf(k);
    const exitLink = path.links[ringEnd] ?? null;
    const kindOf = (link) => {
      if (link === null || link === undefined) return "road";
      const seg = linkSeg[link];
      for (const n of ring) {
        const b = nodes[n].branches.find((br) => br.seg === seg);
        if (b) return b.kind;
      }
      return "road";
    };
    const exit = tulipAngle(outer(along(pos[ringEnd], +1)));

    // Autres routes : une par direction (les deux chaussées d'une même route, et celles de l'entrée et de la
    // sortie, sont fondues)
    const ownSegs = new Set([linkSeg[entryLink], exitLink === null ? -1 : linkSeg[exitLink]]);
    const others = [];
    for (const n of ring) {
      const [ox, oy] = rel(projection.toXY(nodes[n].coord));
      const ringSegs = new Set(nodes[n].linkIds.filter((l) => isRoundabout(network, l)).map((l) => linkSeg[l]));
      for (const b of nodes[n].branches) {
        if (ringSegs.has(b.seg) || ownSegs.has(b.seg)) continue;
        const pts = [];
        for (let i = 0; i < b.shape.length; i += 2) pts.push([b.shape[i] / 10 + ox, b.shape[i + 1] / 10 + oy]);
        const angle = tulipAngle(outer(pts));
        if (angleGap(angle, 180) < MERGE_DEG || angleGap(angle, exit) < MERGE_DEG) continue;
        if (others.some((o) => angleGap(o.angle, angle) < MERGE_DEG)) continue;
        others.push({ angle, kind: b.kind, path: null });
      }
    }
    const tulip = {
      entry: kindOf(entryLink),
      entryPath: null,
      exit,
      exitKind: kindOf(exitLink),
      exitPath: null,
      others,
      roundabout: true,
    };

    // Sorties rencontrées après l'entrée (routes qu'on peut prendre depuis l'anneau), la nôtre comprise
    let exitNumber = 1;
    for (let m = ringStart + 1; m < ringEnd; m++) {
      const n = path.nodes[m];
      nodes[n].linkIds.forEach((l) => {
        if (!isRoundabout(network, l) && canDrive(network, l, n)) exitNumber++;
      });
    }
    const imposed = path.nodes.slice(k, ringEnd + 1).flatMap((n) => nodeNotes.get(n) ?? []);
    return {
      type: "junction",
      km: round2(kmAt(ringStart)),
      coord: nodes[path.nodes[ringStart]].coord,
      direction: `Rond-point — ${exitOrdinal(exitNumber)} sortie`,
      angle: exit,
      road: exitLink === null ? null : linkLabel(network, exitLink),
      notes: imposed,
      danger: imposed.length ? 1 : 0,
      tulip,
    };
  }

  cases.push({
    type: "start",
    km: round2(cumKm.at(-1)),
    coord: nodes[path.nodes[N]].coord,
    direction: `CH — Départ ${toEs}`,
    angle: 0,
    road: null,
    notes: ["Contrôle horaire, fin de la liaison"],
    danger: 0,
    tulip: null,
  });

  // Deux cases à quelques dizaines de mètres (nœuds d'un même échangeur, carrefour décalé) : la moins utile
  // s'efface. Un « tout droit » ou un « légèrement » sans consigne laisse la place à un vrai virage ; entre deux
  // « légèrement », on garde le plus marqué. Deux vrais virages gardent chacun leur case.
  const dropped = new Set();
  for (let i = 0; i + 1 < cases.length; i++) {
    const [a, b] = [cases[i], cases[i + 1]];
    if (b.km - a.km >= NEAR_CASE_KM) continue;
    if (a.minor && (!b.minor || Math.abs(b.angle) >= Math.abs(a.angle))) dropped.add(a);
    else if (b.minor) dropped.add(b);
  }
  const kept = cases.filter((c) => !dropped.has(c));
  cases.length = 0;
  for (const c of kept) {
    delete c.minor;
    cases.push(c);
  }

  cases.forEach((c, i) => {
    c.n = i + 1;
    c.partial = i === 0 ? 0 : round2(c.km - cases[i - 1].km);
  });
  return cases;
}

module.exports = { liaisonRoadbook, linkBetween };

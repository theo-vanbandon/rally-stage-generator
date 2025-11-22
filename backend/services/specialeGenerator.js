/**
 * Service de génération de spéciale de rallye
 */
const graphlib = require("graphlib");
const turf = require("@turf/turf");
const { areSegmentsAligned } = require("../utils/geometry");

/**
 * Construit un graphe à partir des features GeoJSON
 */
function buildGraph(geojson) {
  const g = new graphlib.Graph({ directed: false });

  for (const f of geojson.features) {
    const coords = f.geometry.coordinates;
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i].join(",");
      const b = coords[i + 1].join(",");

      if (!g.hasNode(a)) g.setNode(a, coords[i]);
      if (!g.hasNode(b)) g.setNode(b, coords[i + 1]);

      const length = turf.distance(
        turf.point(coords[i]),
        turf.point(coords[i + 1]),
        { units: "kilometers" }
      );
      g.setEdge(a, b, { length });
    }
  }

  return g;
}

/**
 * Trouve le meilleur chemin pour une spéciale
 */
function findBestPath(g, minKm, maxKm) {
  const visitedGlobal = new Set();
  let bestPath = [];
  let bestLength = 0;

  for (const start of g.nodes()) {
    if (visitedGlobal.has(start)) continue;

    const path = [];
    const visited = new Set();
    let current = start;
    let prev = null;
    let totalLen = 0;

    while (current) {
      path.push(g.node(current));
      visited.add(current);
      visitedGlobal.add(current);

      const neighbors = g
        .neighbors(current)
        .filter((n) => n !== prev && !visited.has(n));

      if (neighbors.length === 0) break;

      const next = neighbors[0];
      totalLen += g.edge(current, next).length;

      if (totalLen > maxKm) break;

      prev = current;
      current = next;
    }

    if (totalLen >= minKm && totalLen > bestLength && path.length > 2) {
      bestLength = totalLen;
      bestPath = path;
    }
  }

  return bestPath;
}

/**
 * Détecte les intersections sur le chemin
 */
function detectIntersections(path, g) {
  const intersectionIndices = new Set();

  for (const [idx, coord] of path.entries()) {
    if (idx <= 0 || idx >= path.length - 1) continue;

    const nodeKey = coord.join(",");
    if (!g.hasNode(nodeKey)) continue;

    const degree = g.neighbors(nodeKey).length;

    // Noeud avec plus de 2 voisins = intersection
    if (degree > 2) {
      intersectionIndices.add(idx);
      console.log(`Intersection graphe [${idx}]: ${degree} voisins`);
    }
    // Noeud avec 2 voisins non alignés = virage serré / intersection
    else if (degree === 2 && idx > 0 && idx < path.length - 1) {
      const prevCoord = path[idx - 1];
      const currentCoord = path[idx];
      const nextCoord = path[idx + 1];

      if (!areSegmentsAligned(prevCoord, currentCoord, nextCoord)) {
        intersectionIndices.add(idx);
        console.log(`Intersection virage [${idx}]: segments non alignés`);
      }
    }
  }

  return Array.from(intersectionIndices).sort((a, b) => a - b);
}

/**
 * Génère une spéciale avec détection des intersections
 */
function generateSpeciale(geojson, minKm = 3, maxKm = 15) {
  if (!geojson?.features?.length) {
    return { path: [], intersections: [] };
  }

  console.log("=== GÉNÉRATION SPÉCIALE ===");

  const graph = buildGraph(geojson);
  console.log(`Graphe: ${graph.nodeCount()} noeuds, ${graph.edgeCount()} arêtes`);

  const path = findBestPath(graph, minKm, maxKm);
  console.log(`Chemin trouvé: ${path.length} points`);

  const intersections = detectIntersections(path, graph);
  console.log(`Intersections: ${intersections.length}`);
  console.log("===========================");

  return { path, intersections };
}

module.exports = { generateSpeciale };

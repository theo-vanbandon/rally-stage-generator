// backend/index.js
const express = require("express");
const axios = require("axios");
const osmtogeojson = require("osmtogeojson");
const turf = require("@turf/turf");
const cors = require("cors");
const graphlib = require("graphlib");

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 4000;

/**
 * Geocode
 */
async function geocode(place, postal) {
  const q = `${place} France`;
  const url = "https://nominatim.openstreetmap.org/search";

  const res = await axios.get(url, {
    params: {
      q,
      format: "jsonv2",
      addressdetails: 1,
      limit: 10,
    },
    headers: { "User-Agent": "rally-stage-generator/1.0" },
  });

  if (!res.data || res.data.length === 0) {
    throw new Error("Lieu non trouvé");
  }

  let candidates = res.data;

  if (postal) {
    candidates = candidates.filter(
      (item) => item.address && item.address.postcode == postal
    );
  }

  if (candidates.length === 0) {
    throw new Error(
      "La ville et le code postal ne correspondent à aucun lieu connu"
    );
  }

  const { lat, lon } = candidates[0];
  return { lat: parseFloat(lat), lon: parseFloat(lon) };
}

/**
 * Query Overpass
 */
async function queryOverpass(lat, lon, radiusMeters) {
  const query = `
[out:json][timeout:90];
(
  way
    (around:${radiusMeters},${lat},${lon})
    ["highway"~"^(primary|secondary|tertiary|unclassified|track|road)$"]
    ["surface"!~"^(paving_stones|cobblestone)$"];
);
out body;
>;
out body qt;
`;

  console.log("-------- QUERY SENT TO OVERPASS --------");
  console.log(query);
  console.log("----------------------------------------");

  const url = "https://overpass-api.de/api/interpreter";

  const res = await axios.post(url, query, {
    headers: {
      "Content-Type": "text/plain",
      "User-Agent": "rally-stage-generator/1.0",
    },
    timeout: 180000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  console.log("-------- OVERPASS RESPONSE --------");
  console.log("Elements:", res.data?.elements?.length);
  console.log("----------------------------------");

  return res.data;
}

/**
 * Convert OSM JSON to GeoJSON safely
 */
function osmJsonToGeoJsonAndStats(osmJson) {
  if (!osmJson || !osmJson.elements || osmJson.elements.length === 0) {
    return {
      geojson: { type: "FeatureCollection", features: [] },
      stats: { waysCount: 0, totalKm: 0 },
    };
  }
  const geojson = osmtogeojson(osmJson);

  let totalKm = 0,
    waysCount = 0;
  if (geojson.features) {
    geojson.features.forEach((f) => {
      if (f.geometry && f.geometry.type === "LineString") {
        waysCount++;
        try {
          totalKm += turf.length(f, { units: "kilometers" });
        } catch (e) {}
      }
    });
  }

  return { geojson, stats: { waysCount, totalKm } };
}

/**
 * Filtrer les routes pour ne garder que celles plausibles pour un rallye
 */
function filterRallyeWays(geojson) {
  const allowedHighways = [
    "track",
    "unclassified",
    "road",
    "secondary",
    "tertiary",
    "residential",
  ];

  const forbiddenHighways = [
    "primary",
    "motorway",
    "trunk",
    "service",
    "footway",
    "cycleway",
    "path",
    "pedestrian",
  ];

  const allowedSurfaces = [
    "asphalt",
    "paved",
    "compacted",
    "fine_gravel",
    "gravel",
    "dirt",
    "ground",
    "unpaved",
  ];

  const filtered = geojson.features.filter((f) => {
    if (!f.geometry || f.geometry.type !== "LineString") return false;

    const hw = f.properties.highway;
    const surf = f.properties.surface
      ? f.properties.surface.toLowerCase()
      : null;

    if (!hw || forbiddenHighways.includes(hw)) return false;
    if (!allowedHighways.includes(hw)) return false;
    if (surf && !allowedSurfaces.includes(surf)) return false;

    const len = turf.length(f, { units: "kilometers" });
    if (len < 0.08) return false;

    if (f.properties["addr:street"]) return false;
    if (f.properties.parking) return false;

    const landuse = f.properties.landuse;
    if (landuse && ["industrial", "commercial", "retail"].includes(landuse))
      return false;

    return true;
  });

  return { type: "FeatureCollection", features: filtered };
}

/**
 * Generate a single stage from the filtered GeoJSON and detect intersections
 */
function generateSingleSpeciale(geojson, minKm = 3, maxKm = 15) {
  if (!geojson || !geojson.features || geojson.features.length === 0) {
    return { path: [], intersections: [] };
  }

  const g = new graphlib.Graph({ directed: false });

  // Build the graph
  geojson.features.forEach((f) => {
    const coords = f.geometry.coordinates;
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i].join(",");
      const b = coords[i + 1].join(",");
      if (!g.hasNode(a)) g.setNode(a, coords[i]);
      if (!g.hasNode(b)) g.setNode(b, coords[i + 1]);
      const len = turf.distance(
        turf.point(coords[i]),
        turf.point(coords[i + 1]),
        { units: "kilometers" }
      );
      g.setEdge(a, b, { length: len });
    }
  });

  const visitedGlobal = new Set();
  let bestPath = [],
    bestLength = 0;

  // We go through all the nodes as starting points
  g.nodes().forEach((start) => {
    if (visitedGlobal.has(start)) return;

    let path = [];
    let visited = new Set();
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
  });

  // Helper: check if two segments intersect geometrically
  function segmentsIntersect(p1, p2, p3, p4) {
    const [x1, y1] = p1;
    const [x2, y2] = p2;
    const [x3, y3] = p3;
    const [x4, y4] = p4;

    const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if (Math.abs(denom) < 1e-10) return false;

    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
    const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

    return ua > 0.05 && ua < 0.95 && ub > 0.05 && ub < 0.95;
  }

  // Helper: check if point is close to segment
  function isNearSegment(point, seg, tolerance = 0.0001) {
    const [px, py] = point;
    const [x1, y1] = seg[0];
    const [x2, y2] = seg[1];

    const minX = Math.min(x1, x2) - tolerance;
    const maxX = Math.max(x1, x2) + tolerance;
    const minY = Math.min(y1, y2) - tolerance;
    const maxY = Math.max(y1, y2) + tolerance;

    return px >= minX && px <= maxX && py >= minY && py <= maxY;
  }

  // Détecter les intersections (nœuds avec plus de 2 voisins ou nœuds avec 2 voisins non alignés)
  const intersectionIndices = new Set();

  // Fonction pour vérifier si deux segments sont alignés
  function areSegmentsAligned(a, b, c) {
    // Vecteurs
    const vec1 = [b[0] - a[0], b[1] - a[1]];
    const vec2 = [c[0] - b[0], c[1] - b[1]];

    // Produit vectoriel (cross product) pour vérifier l'alignement
    const crossProduct = vec1[0] * vec2[1] - vec1[1] * vec2[0];
    return Math.abs(crossProduct) < 0.000001; // Seuil pour considérer les segments comme alignés
  }

  // Méthode 1 : Détection par graphe
  bestPath.forEach((coord, idx) => {
    if (idx <= 0 || idx >= bestPath.length - 1) return;
    const nodeKey = coord.join(",");
    if (!g.hasNode(nodeKey)) return;
    const degree = g.neighbors(nodeKey).length;

    // Si le nœud a plus de 2 voisins, c'est une intersection
    if (degree > 2) {
      intersectionIndices.add(idx);
      console.log(`Intersection graphe à l'indice ${idx}: ${degree} voisins`);
    }
    // Si le nœud a 2 voisins, vérifier si les segments ne sont pas alignés
    else if (degree === 2) {
      const prevCoord = bestPath[idx - 1];
      const currentCoord = bestPath[idx];
      const nextCoord = bestPath[idx + 1];

      if (!areSegmentsAligned(prevCoord, currentCoord, nextCoord)) {
        intersectionIndices.add(idx);
        console.log(
          `Intersection ajoutée à l'indice ${idx}: segments non alignés`
        );
      }
    }
  });

  // Convertir en tableau trié
  const finalIndices = Array.from(intersectionIndices).sort((a, b) => a - b);
  console.log("Intersections totales détectées:", finalIndices.length);
  console.log("Indices:", finalIndices);

  return { path: bestPath, intersections: finalIndices };
}

/**
 * Convert the stage into GeoJSON
 */
function specialToGeoJSON(special) {
  if (!special || special.length < 2)
    return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: special },
        properties: {},
      },
    ],
  };
}

/**
 * Endpoint /api/generate
 */
app.post("/api/generate", async (req, res) => {
  try {
    const { place, postal, radiusKm = 10 } = req.body;
    if (!place) return res.status(400).json({ error: "place is required" });

    // 1) Geocode
    const { lat, lon } = await geocode(place, postal);

    // 2) Query Overpass
    const radiusMeters = Math.max(1000, Math.min(radiusKm * 1000, 50000));
    const osmJson = await queryOverpass(lat, lon, radiusMeters);

    // 3) Convert + stats
    const { geojson, stats } = osmJsonToGeoJsonAndStats(osmJson);
    if (stats.waysCount === 0)
      return res
        .status(404)
        .json({ ok: false, error: "Aucune route trouvée dans ce rayon." });

    // 4) Filter for rally
    const rallyeGeojson = filterRallyeWays(geojson);

    // 5) Generate one stage with intersections
    const { path: speciale, intersections } = generateSingleSpeciale(
      rallyeGeojson,
      3,
      15
    );
    const specialGeojson = specialToGeoJSON(speciale);

    console.log("FIN");

    return res.json({
      ok: true,
      center: { lat, lon },
      radiusMeters,
      stats,
      geojson: specialGeojson,
      intersections, // Indices des intersections dans le path
      speciales: speciale ? [speciale] : [],
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || String(err) });
  }
});

app.get("/api/ping", (req, res) =>
  res.json({ ok: true, version: "backend v3" })
);

app.listen(PORT, () =>
  console.log(`Backend running on http://localhost:${PORT}`)
);

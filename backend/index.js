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
 * Geocode via Nominatim
 */
async function geocode(place, postal) {
  const q = postal ? `${place} ${postal} France` : `${place} France`;
  const url = "https://nominatim.openstreetmap.org/search";
  const res = await axios.get(url, {
    params: { q, format: "jsonv2", addressdetails: 1, limit: 1 },
    headers: {
      "User-Agent": "rally-stage-generator/1.0 (theo.vanbandon@gmail.com)",
    },
  });
  if (!res.data || res.data.length === 0) throw new Error("Lieu non trouvé");
  const { lat, lon } = res.data[0];
  return { lat: parseFloat(lat), lon: parseFloat(lon) };
}

/**
 * Query Overpass
 */
async function queryOverpass(lat, lon, radiusMeters) {
  const overpassQuery = `
[out:json][timeout:60];
(
  way(around:${radiusMeters},${lat},${lon})["highway"~"track|unclassified|road|secondary|tertiary"];
);
out body;
>;
out skel qt;
`;
  const url = "https://overpass.kumi.systems/api/interpreter";
  const res = await axios.post(url, overpassQuery, {
    headers: {
      "Content-Type": "text/plain",
      "User-Agent": "rally-stage-generator/1.0 (theo.vanbandon@gmail.com)",
    },
    timeout: 120000,
  });
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

  let totalKm = 0;
  let waysCount = 0;
  if (geojson && geojson.features) {
    geojson.features.forEach((f) => {
      if (
        f.geometry &&
        (f.geometry.type === "LineString" ||
          f.geometry.type === "MultiLineString")
      ) {
        waysCount++;
        try {
          totalKm += turf.length(f, { units: "kilometers" });
        } catch (e) {
          // noop
        }
      }
    });
  }

  return { geojson, stats: { waysCount, totalKm } };
}

/**
 * Générer une seule spéciale
 */
function generateSingleSpeciale(geojson, minKm = 3, maxKm = 15) {
  if (!geojson || !geojson.features || geojson.features.length === 0) return [];

  const g = new graphlib.Graph({ directed: false });

  // Construire le graphe
  geojson.features.forEach((f) => {
    if (f.geometry.type === "LineString") {
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
    }
  });

  const endpoints = g.nodes().filter((n) => g.nodeEdges(n).length === 1);
  if (endpoints.length === 0) return []; // pas de chemin possible

  let bestPath = [];
  let bestLength = 0;

  // Parcours depuis chaque extrémité
  endpoints.forEach((start) => {
    let path = [];
    let visited = new Set();
    let current = start;
    let prev = null;
    let totalLen = 0;

    while (current) {
      path.push(g.node(current));
      visited.add(current);

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

    if (totalLen >= minKm && totalLen > bestLength) {
      bestLength = totalLen;
      bestPath = path;
    }
  });

  return bestPath;
}

// transformer la spéciale en GeoJSON
function specialToGeoJSON(special) {
  if (!special || special.length < 2)
    return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: special,
        },
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
    console.log("Geocode:", place, postal, lat, lon);

    // 2) Query Overpass
    const radiusMeters = Math.max(1000, Math.min(radiusKm * 1000, 50000));
    const osmJson = await queryOverpass(lat, lon, radiusMeters);

    // 3) Convert + stats
    const { geojson, stats } = osmJsonToGeoJsonAndStats(osmJson);
    if (stats.waysCount === 0) {
      return res
        .status(404)
        .json({ ok: false, error: "Aucune route trouvée dans ce rayon." });
    }

    // 4) Générer une seule spéciale
    const speciale = generateSingleSpeciale(geojson, 3, 15);
    const specialGeojson = specialToGeoJSON(speciale);

    return res.json({
      ok: true,
      center: { lat, lon },
      radiusMeters,
      stats,
      geojson: specialGeojson,
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
  res.json({ ok: true, version: "backend v2" })
);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});

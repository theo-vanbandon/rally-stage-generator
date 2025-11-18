// backend/index.js
const express = require("express");
const axios = require("axios");
const osmtogeojson = require("osmtogeojson");
const turf = require("@turf/turf");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors()); // ok pour dev

const PORT = process.env.PORT || 4000;

/**
 * Simple geocode via Nominatim (OpenStreetMap)
 * @param {string} place
 * @param {string|undefined} postal
 */
async function geocode(place, postal) {
  const q = postal ? `${place} ${postal} France` : `${place} France`;
  const url = "https://nominatim.openstreetmap.org/search";
  const res = await axios.get(url, {
    params: { q, format: "jsonv2", addressdetails: 1, limit: 1 },
    headers: { "User-Agent": "rally-stage-generator/1.0 (theo.vanbandon@gmail.com)" }
  });
  if (!res.data || res.data.length === 0) throw new Error("Lieu non trouvé");
  const { lat, lon } = res.data[0];
  return { lat: parseFloat(lat), lon: parseFloat(lon) };
}

/**
 * Query Overpass for ways around a point
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusMeters
 */
async function queryOverpass(lat, lon, radiusMeters) {
  // Filter highways: exclude motorways & trunk to favor "speciale" roads
    const overpassQuery = `
[out:json][timeout:60];
(
  way(around:${radiusMeters},${lat},${lon})["highway"]
    ["highway"!~"residential|service|footway|path|cycleway"];
);
out body;
>; 
out skel qt;
`;
  const url = "https://overpass-api.de/api/interpreter";
  const res = await axios.post(url, overpassQuery, {
    headers: {
      "Content-Type": "text/plain",
      "User-Agent": "rally-stage-generator/1.0 (theo.vanbandon@gmail.com)"
    },
    timeout: 60000
  });
  return res.data;
}

/**
 * Convert OSM JSON to GeoJSON (linestrings for ways),
 * compute approximate total length
 */
function osmJsonToGeoJsonAndStats(osmJson) {
  const geojson = osmtogeojson(osmJson);

  // compute total length of LineStrings (in km)
  let totalKm = 0;
  let waysCount = 0;
  if (geojson && geojson.features) {
    geojson.features.forEach((f) => {
      if (f.geometry && (f.geometry.type === "LineString" || f.geometry.type === "MultiLineString")) {
        waysCount++;
        try {
          const len = turf.length(f, { units: "kilometers" });
          totalKm += len;
        } catch (e) {
          // noop
        }
      }
    });
  }

  return { geojson, stats: { waysCount, totalKm } };
}

app.post("/api/generate", async (req, res) => {
  try {
    const { place, postal, radiusKm = 10 } = req.body;
    if (!place) return res.status(400).json({ error: "place is required" });

    // 1) Geocode
    const { lat, lon } = await geocode(place, postal);

    // 2) Query Overpass (radius in meters)
    const radiusMeters = Math.max(1000, Math.min(radiusKm * 1000, 50000)); // clamp 1km-50km
    const osmJson = await queryOverpass(lat, lon, radiusMeters);

    // 3) Convert + compute stats
    const { geojson, stats } = osmJsonToGeoJsonAndStats(osmJson);

    // 4) Return minimal payload
    return res.json({
      ok: true,
      center: { lat, lon },
      radiusMeters,
      stats,
      geojson
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.get("/api/ping", (req, res) => res.json({ ok: true, version: "backend v1" }));

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});

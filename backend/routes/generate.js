/**
 * Routes API pour la génération de spéciales
 */
const express = require("express");
const router = express.Router();

const { geocode } = require("../services/geocoder");
const { queryOverpass } = require("../services/overpass");
const { osmJsonToGeoJson, coordsToGeoJSON } = require("../services/geojsonConverter");
const { filterRallyeWays } = require("../services/rallyFilter");
const { generateSpeciale } = require("../services/specialeGenerator");

/**
 * POST /api/generate
 * Génère une spéciale de rallye autour d'une ville
 */
router.post("/", async (req, res) => {
  try {
    const { place, postal, radiusKm = 10 } = req.body;

    if (!place) {
      return res.status(400).json({ error: "place is required" });
    }

    // 1) Géocodage
    console.log(`\n🏁 Génération pour: ${place} ${postal || ""}`);
    const { lat, lon } = await geocode(place, postal);

    // 2) Requête Overpass
    const radiusMeters = Math.max(1000, Math.min(radiusKm * 1000, 50000));
    const osmJson = await queryOverpass(lat, lon, radiusMeters);

    // 3) Conversion GeoJSON
    const { geojson, stats } = osmJsonToGeoJson(osmJson);
    if (stats.waysCount === 0) {
      return res.status(404).json({
        ok: false,
        error: "Aucune route trouvée dans ce rayon.",
      });
    }

    // 4) Filtrage pour rallye
    const rallyeGeojson = filterRallyeWays(geojson);
    console.log(`Routes filtrées: ${rallyeGeojson.features.length}`);

    // 5) Génération de la spéciale
    const { path, intersections } = generateSpeciale(rallyeGeojson, 3, 15);
    const specialeGeojson = coordsToGeoJSON(path);

    console.log("✅ Génération terminée\n");

    return res.json({
      ok: true,
      center: { lat, lon },
      radiusMeters,
      stats,
      geojson: specialeGeojson,
      intersections,
      speciales: path.length > 0 ? [path] : [],
    });
  } catch (err) {
    console.error("❌ Erreur:", err.message);
    return res.status(500).json({
      ok: false,
      error: err.message || String(err),
    });
  }
});

module.exports = router;

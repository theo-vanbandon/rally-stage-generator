/**
 * Service de conversion OSM vers GeoJSON
 */
const osmtogeojson = require("osmtogeojson");
const turf = require("@turf/turf");

/**
 * Convertit les données OSM en GeoJSON avec statistiques
 * @param {Object} osmJson - Données OSM brutes
 * @returns {{geojson: Object, stats: {waysCount: number, totalKm: number}}}
 */
function osmJsonToGeoJson(osmJson) {
  if (!osmJson || !osmJson.elements || osmJson.elements.length === 0) {
    return {
      geojson: { type: "FeatureCollection", features: [] },
      stats: { waysCount: 0, totalKm: 0 },
    };
  }

  const geojson = osmtogeojson(osmJson);

  let totalKm = 0;
  let waysCount = 0;

  if (geojson.features) {
    geojson.features.forEach((f) => {
      if (f.geometry && f.geometry.type === "LineString") {
        waysCount++;
        try {
          totalKm += turf.length(f, { units: "kilometers" });
        } catch (e) {
          // Ignorer les erreurs de calcul de longueur
        }
      }
    });
  }

  return { geojson, stats: { waysCount, totalKm } };
}

/**
 * Convertit un tableau de coordonnées en GeoJSON LineString
 * @param {Array} coordinates - Tableau de coordonnées [lon, lat]
 * @returns {Object} GeoJSON FeatureCollection
 */
function coordsToGeoJSON(coordinates) {
  if (!coordinates || coordinates.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: {},
      },
    ],
  };
}

module.exports = { osmJsonToGeoJson, coordsToGeoJSON };

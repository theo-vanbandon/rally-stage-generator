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
  if (!osmJson?.elements?.length) {
    return {
      geojson: { type: "FeatureCollection", features: [] },
      stats: { waysCount: 0, totalKm: 0 },
    };
  }

  const geojson = osmtogeojson(osmJson);

  let totalKm = 0;
  let waysCount = 0;

  if (geojson.features) {
    for (const f of geojson.features) {
      if (f.geometry?.type === "LineString") {
        waysCount++;
        const length = turf.length(f, { units: "kilometers" });
        if (!Number.isNaN(length)) {
          totalKm += length;
        }
      }
    }
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

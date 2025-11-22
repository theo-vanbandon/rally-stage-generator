/**
 * Service de filtrage des routes pour rallye
 */
const turf = require("@turf/turf");

const ALLOWED_HIGHWAYS = new Set([
  "track",
  "unclassified",
  "road",
  "secondary",
  "tertiary",
  "residential",
]);

const FORBIDDEN_HIGHWAYS = new Set([
  "primary",
  "motorway",
  "trunk",
  "service",
  "footway",
  "cycleway",
  "path",
  "pedestrian",
]);

const ALLOWED_SURFACES = new Set([
  "asphalt",
  "paved",
  "compacted",
  "fine_gravel",
  "gravel",
  "dirt",
  "ground",
  "unpaved",
]);

const FORBIDDEN_LANDUSE = new Set(["industrial", "commercial", "retail"]);

const MIN_LENGTH_KM = 0.08;

/**
 * Filtre les routes pour ne garder que celles adaptées au rallye
 * @param {Object} geojson - GeoJSON FeatureCollection
 * @returns {Object} GeoJSON filtré
 */
function filterRallyeWays(geojson) {
  const filtered = geojson.features.filter((f) => {
    if (f.geometry?.type !== "LineString") return false;

    const props = f.properties;
    const highway = props.highway;
    const surface = props.surface ? props.surface.toLowerCase() : null;

    if (!highway || FORBIDDEN_HIGHWAYS.has(highway)) return false;
    if (!ALLOWED_HIGHWAYS.has(highway)) return false;
    if (surface && !ALLOWED_SURFACES.has(surface)) return false;

    const length = turf.length(f, { units: "kilometers" });
    if (length < MIN_LENGTH_KM) return false;

    if (props["addr:street"]) return false;
    if (props.parking) return false;

    const landuse = props.landuse;
    if (landuse && FORBIDDEN_LANDUSE.has(landuse)) return false;

    return true;
  });

  return { type: "FeatureCollection", features: filtered };
}

module.exports = { filterRallyeWays };

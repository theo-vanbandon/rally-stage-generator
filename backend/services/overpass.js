/**
 * Service d'interrogation de l'API Overpass
 */
const axios = require("axios");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "rally-stage-generator/1.0";
const MAX_RADIUS_METERS = 15000; // 15km maximum pour protéger les 512MB de RAM du back

/**
 * Récupère les routes autour d'un point via Overpass API
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {number} radiusMeters - Rayon de recherche en mètres
 * @returns {Promise<Object>} Données OSM brutes
 */
async function queryOverpass(lat, lon, radiusMeters) {
  // Limiter le rayon pour éviter les timeouts et problèmes de mémoire
  const limitedRadius = Math.min(radiusMeters, MAX_RADIUS_METERS);
  
  const query = `
[out:json][timeout:90];
(
  way
    (around:${limitedRadius},${lat},${lon})
    ["highway"~"^(secondary|tertiary|unclassified|track|road)$"]
    ["surface"!~"^(paving_stones|cobblestone)$"];
);
out body;
>;
out body qt;
`;

  console.log("-------- QUERY OVERPASS --------");
  console.log(`Centre: ${lat}, ${lon} | Rayon: ${limitedRadius}m (demandé: ${radiusMeters}m)`);

  const res = await axios.post(OVERPASS_URL, query, {
    headers: {
      "Content-Type": "text/plain",
      "User-Agent": USER_AGENT,
    },
    timeout: 180000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  console.log(`Éléments reçus: ${res.data?.elements?.length || 0}`);
  console.log("--------------------------------");

  return res.data;
}

module.exports = { queryOverpass };

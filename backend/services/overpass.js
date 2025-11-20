/**
 * Service d'interrogation de l'API Overpass
 */
const axios = require("axios");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "rally-stage-generator/1.0";

/**
 * Récupère les routes autour d'un point via Overpass API
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {number} radiusMeters - Rayon de recherche en mètres
 * @returns {Promise<Object>} Données OSM brutes
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

  console.log("-------- QUERY OVERPASS --------");
  console.log(`Centre: ${lat}, ${lon} | Rayon: ${radiusMeters}m`);

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

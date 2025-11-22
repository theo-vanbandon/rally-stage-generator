/**
 * Service de géocodage via Nominatim
 */
const axios = require("axios");

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "rally-stage-generator/1.0";

/**
 * Géocode une ville en France
 * @param {string} place - Nom de la ville
 * @param {string} postal - Code postal (optionnel)
 * @returns {Promise<{lat: number, lon: number}>}
 */
async function geocode(place, postal) {
  const q = `${place} France`;

  const res = await axios.get(NOMINATIM_URL, {
    params: {
      q,
      format: "jsonv2",
      addressdetails: 1,
      limit: 10,
    },
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.data?.length) {
    throw new Error("Lieu non trouvé");
  }

  let candidates = res.data;

  if (postal) {
    candidates = candidates.filter(
      (item) => item.address?.postcode === postal
    );
  }

  if (candidates.length === 0) {
    throw new Error(
      "La ville et le code postal ne correspondent à aucun lieu connu"
    );
  }

  const { lat, lon } = candidates[0];
  return { lat: Number.parseFloat(lat), lon: Number.parseFloat(lon) };
}

module.exports = { geocode };

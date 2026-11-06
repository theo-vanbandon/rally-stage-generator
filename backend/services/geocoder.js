/**
 * Service de géocodage des communes françaises
 * Source principale : API Découpage administratif (geo.api.gouv.fr), rapide et sans quota
 * Secours : Nominatim (OpenStreetMap)
 */
const axios = require("axios");

const GEO_API_URL = "https://geo.api.gouv.fr/communes";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "rally-stage-generator/2.0";
const TIMEOUT_MS = 8000;

/**
 * Normalise un nom de commune pour comparaison (accents, tirets, casse)
 */
function normalize(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^(saint|sainte)\b/, (m) => (m === "saint" ? "st" : "ste"))
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Choisit la commune la plus pertinente parmi les candidates
 */
function pickCommune(communes, place) {
  if (!communes.length) return null;
  const target = normalize(place);
  if (!target) return communes[0];

  const exact = communes.find((c) => normalize(c.nom) === target);
  if (exact) return exact;

  const partial = communes.find((c) => normalize(c.nom).includes(target) || target.includes(normalize(c.nom)));
  return partial || null;
}

async function geocodeWithGeoApi(place, postal) {
  const params = { fields: "nom,centre,population,codesPostaux", format: "json" };
  if (postal) params.codePostal = postal;
  else Object.assign(params, { nom: place, boost: "population", limit: 5 });

  const res = await axios.get(GEO_API_URL, { params, timeout: TIMEOUT_MS });
  const commune = postal ? pickCommune(res.data || [], place) : (res.data || [])[0];
  if (!commune?.centre) return null;

  const [lon, lat] = commune.centre.coordinates;
  return { lat, lon, name: commune.nom, population: commune.population ?? null };
}

async function geocodeWithNominatim(place, postal) {
  const res = await axios.get(NOMINATIM_URL, {
    params: {
      city: place,
      postalcode: postal || undefined,
      country: "France",
      format: "jsonv2",
      limit: 1,
    },
    headers: { "User-Agent": USER_AGENT },
    timeout: TIMEOUT_MS,
  });
  const hit = res.data?.[0];
  if (!hit) return null;
  return {
    lat: Number.parseFloat(hit.lat),
    lon: Number.parseFloat(hit.lon),
    name: hit.name || place,
    population: null,
  };
}

/**
 * Géocode une commune en France
 * @param {string} place - Nom de la commune
 * @param {string} [postal] - Code postal
 * @returns {Promise<{lat: number, lon: number, name: string, population: number|null}>}
 */
async function geocode(place, postal) {
  try {
    const result = await geocodeWithGeoApi(place, postal);
    if (result) return result;
  } catch (err) {
    console.warn(`geo.api.gouv.fr indisponible (${err.message}), bascule sur Nominatim`);
  }

  const fallback = await geocodeWithNominatim(place, postal).catch(() => null);
  if (fallback) return fallback;

  throw new Error(
    postal
      ? "La ville et le code postal ne correspondent à aucune commune connue"
      : "Commune introuvable"
  );
}

module.exports = { geocode, normalize, pickCommune };

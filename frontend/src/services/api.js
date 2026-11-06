/**
 * Service d'appels API (backend + API des communes françaises)
 */

const API_BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:4000/api";
const COMMUNES_URL = "https://geo.api.gouv.fr/communes";

/**
 * Génère une spéciale de rallye
 * @param {object} params
 * @param {string} [params.place] - Nom de la commune
 * @param {string} [params.postal] - Code postal
 * @param {number} [params.lat] - Latitude du centre (prioritaire sur place)
 * @param {number} [params.lon] - Longitude du centre
 * @param {number} params.radiusKm - Rayon de recherche
 * @param {"asphalt"|"gravel"|"mixed"} params.surface - Revêtement
 * @param {"short"|"medium"|"long"} params.length - Longueur
 * @param {number} [params.seed] - Graine (même graine = même spéciale)
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<Object>}
 */
export async function generateStage(params, { signal } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error("Impossible de joindre le serveur. S'il était en veille, réessaie dans quelques secondes.");
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Erreur serveur (${res.status})`);
  }
  return data;
}

/**
 * Vérifie si le backend est disponible (et le réveille s'il est en veille)
 * @returns {Promise<boolean>}
 */
export async function pingBackend() {
  try {
    const res = await fetch(`${API_BASE_URL}/ping`);
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

/**
 * Recherche de communes par nom ou code postal (autocomplétion)
 * @param {string} query
 * @returns {Promise<Array<{name: string, postal: string, department: string, lat: number, lon: number, population: number}>>}
 */
export async function searchCommunes(query, { signal } = {}) {
  const q = query.trim();
  if (q.length < 2) return [];

  const params = new URLSearchParams({
    fields: "nom,codesPostaux,centre,population,codeDepartement",
    boost: "population",
    limit: "7",
  });
  if (/^\d{5}$/.test(q)) params.set("codePostal", q);
  else params.set("nom", q);

  const res = await fetch(`${COMMUNES_URL}?${params}`, { signal });
  if (!res.ok) return [];
  const communes = await res.json();

  return communes
    .filter((c) => c.centre)
    .map((c) => ({
      name: c.nom,
      postal: /^\d{5}$/.test(q) ? q : c.codesPostaux?.[0] || "",
      department: c.codeDepartement,
      lon: c.centre.coordinates[0],
      lat: c.centre.coordinates[1],
      population: c.population ?? 0,
    }));
}

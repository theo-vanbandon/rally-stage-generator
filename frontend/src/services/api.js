/**
 * Service d'appels API au backend
 */

const API_BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:4000/api";

/**
 * Génère une spéciale de rallye
 * @param {string} place - Nom de la ville
 * @param {string} postal - Code postal
 * @param {number} radiusKm - Rayon en km
 * @returns {Promise<Object>}
 */
export async function generateSpeciale(place, postal, radiusKm) {
  const res = await fetch(`${API_BASE_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ place, postal, radiusKm }),
  });

  const data = await res.json();

  if (!data.ok) {
    throw new Error(data.error || "Erreur inconnue");
  }

  return data;
}

/**
 * Vérifie si le backend est disponible
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

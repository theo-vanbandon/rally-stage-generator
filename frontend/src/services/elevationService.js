/**
 * Service de récupération des altitudes
 */
import axios from "axios";

const ELEVATION_API_URL = "https://api.open-elevation.com/api/v1/lookup";

/**
 * Récupère les altitudes pour une liste de coordonnées
 * @param {Array} coordinates - Tableau de [lon, lat]
 * @returns {Promise<Array|null>}
 */
export async function fetchElevations(coordinates) {
  try {
    const locations = coordinates.map((coord) => ({
      latitude: coord[1],
      longitude: coord[0],
    }));

    const response = await axios.post(ELEVATION_API_URL, { locations });
    return response.data.results;
  } catch (error) {
    console.error("Erreur lors de la récupération des altitudes:", error);
    return null;
  }
}

/**
 * Calcule les statistiques d'élévation
 * @param {Array} elevations - Résultats de l'API elevation
 * @returns {Object} { min, max, gain, loss }
 */
export function calculateElevationStats(elevations) {
  if (!elevations || elevations.length === 0) {
    return { min: 0, max: 0, gain: 0, loss: 0 };
  }

  const values = elevations.map((e) => e.elevation);
  const min = Math.min(...values);
  const max = Math.max(...values);

  let gain = 0;
  let loss = 0;

  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) {
      gain += diff;
    } else {
      loss += Math.abs(diff);
    }
  }

  return {
    min,
    max,
    gain: Math.round(gain),
    loss: Math.round(loss),
  };
}

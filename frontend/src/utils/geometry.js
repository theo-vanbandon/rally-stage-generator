/**
 * Fonctions utilitaires de géométrie
 */

/**
 * Calcule la distance entre deux coordonnées [lon, lat] (formule de Haversine)
 * @param {Array} coord1 - [lon, lat]
 * @param {Array} coord2 - [lon, lat]
 * @returns {number} Distance en km
 */
export function haversineDistance(coord1, coord2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const [lon1, lat1] = coord1;
  const [lon2, lat2] = coord2;
  const R = 6371; // Rayon de la Terre en km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Distances cumulées (km) le long d'une polyligne [lon, lat]
 * @param {Array} coords
 * @returns {number[]}
 */
export function cumulativeDistances(coords) {
  const out = [0];
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + haversineDistance(coords[i - 1], coords[i]));
  return out;
}

/**
 * Point [lon, lat] situé à une distance donnée depuis le départ
 * @param {Array} coords - Polyligne [lon, lat]
 * @param {number[]} cumulative - Distances cumulées (voir cumulativeDistances)
 * @param {number} km
 */
export function pointAtKm(coords, cumulative, km) {
  if (!coords.length) return null;
  if (km <= 0) return coords[0];
  let i = 1;
  while (i < cumulative.length && cumulative[i] < km) i++;
  if (i >= cumulative.length) return coords[coords.length - 1];
  const span = cumulative[i] - cumulative[i - 1];
  const t = span > 0 ? (km - cumulative[i - 1]) / span : 0;
  const [a, b] = [coords[i - 1], coords[i]];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Emprise [sud, ouest, nord, est] du carré de recherche (identique au backend)
 */
export function bboxAround(lat, lon, radiusKm) {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
}

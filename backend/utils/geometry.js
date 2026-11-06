/**
 * Fonctions utilitaires de géométrie (coordonnées [lon, lat], distances en km)
 */

const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/**
 * Distance orthodromique entre deux points [lon, lat]
 */
function haversineKm(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Cap (0-360°, 0 = nord) de a vers b
 */
function bearing(a, b) {
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const dLon = toRad(b[0] - a[0]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Différence signée entre deux caps, dans ]-180, 180] (positif = à droite)
 */
function signedAngle(fromHeading, toHeading) {
  let d = (toHeading - fromHeading) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * Longueur d'une polyligne
 */
function lineLengthKm(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversineKm(coords[i - 1], coords[i]);
  return total;
}

/**
 * Rééchantillonne une polyligne à pas constant (km). Le dernier point est toujours conservé.
 */
function resample(coords, stepKm) {
  if (coords.length < 2) return coords.slice();
  const out = [coords[0]];
  let carry = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const seg = haversineKm(a, b);
    if (seg === 0) continue;
    let t = stepKm - carry;
    while (t <= seg) {
      const r = t / seg;
      out.push([a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r]);
      t += stepKm;
    }
    carry = seg - (t - stepKm);
  }
  const last = coords[coords.length - 1];
  const tail = out[out.length - 1];
  if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
  return out;
}

/**
 * Boîte englobante [sud, ouest, nord, est] d'un carré de demi-côté radiusKm
 */
function bboxAround(lat, lon, radiusKm) {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos(toRad(lat)));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
}

/**
 * Projection locale équirectangulaire (km) autour d'une origine — suffisante à l'échelle d'une région
 */
function createProjection(lat0, lon0) {
  const ky = 111.32;
  const kx = 111.32 * Math.cos(toRad(lat0));
  return {
    toXY: ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky],
  };
}

/**
 * Générateur pseudo-aléatoire reproductible (mulberry32)
 */
function createRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = {
  haversineKm,
  bearing,
  signedAngle,
  lineLengthKm,
  resample,
  bboxAround,
  createProjection,
  createRng,
};

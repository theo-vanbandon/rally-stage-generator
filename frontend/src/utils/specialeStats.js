/**
 * Calcul des statistiques de spéciale
 */
import * as turf from "@turf/turf";
import { fetchElevations, calculateElevationStats } from "../services/elevationService";

/**
 * Calcule la pente moyenne entre les intersections
 */
function calculateAverageSlope(coordinates, elevations, intersections) {
  if (!elevations || elevations.length < 2 || !intersections || intersections.length < 2) {
    return 0;
  }

  let totalSlope = 0;
  let segmentCount = 0;

  for (let i = 0; i < intersections.length - 1; i++) {
    const startIdx = intersections[i];
    const endIdx = intersections[i + 1];

    const startElevation = elevations[startIdx]?.elevation;
    const endElevation = elevations[endIdx]?.elevation;

    if (startElevation === undefined || endElevation === undefined) continue;

    const startCoord = coordinates[startIdx];
    const endCoord = coordinates[endIdx];
    const distance = turf.distance(turf.point(startCoord), turf.point(endCoord), {
      units: "kilometers",
    });

    if (distance === 0) continue;

    const elevationDiff = Math.abs(endElevation - startElevation);
    const slope = (elevationDiff / (distance * 1000)) * 100;
    totalSlope += slope;
    segmentCount++;
  }

  return segmentCount > 0 ? (totalSlope / segmentCount).toFixed(2) : 0;
}

/**
 * Calcule la distance moyenne entre les PK
 */
function calculateAvgDistanceBetweenPK(coordinates, intersections) {
  if (!intersections || intersections.length < 2) return 0;

  let totalDistance = 0;

  for (let i = 0; i < intersections.length - 1; i++) {
    const startCoord = coordinates[intersections[i]];
    const endCoord = coordinates[intersections[i + 1]];
    totalDistance += turf.distance(turf.point(startCoord), turf.point(endCoord), {
      units: "kilometers",
    });
  }

  return (totalDistance / (intersections.length - 1)).toFixed(2);
}

/**
 * Calcule toutes les statistiques de la spéciale
 * @param {Object} geojson - GeoJSON de la spéciale
 * @param {Array} intersections - Indices des intersections
 * @returns {Promise<Object>}
 */
export async function calculateSpecialeStats(geojson, intersections) {
  const emptyStats = {
    length: 0,
    intersections: 0,
    avgDistanceBetweenPK: 0,
    elevation: { min: 0, max: 0, gain: 0, loss: 0 },
    avgSlope: 0,
  };

  if (!geojson?.features?.length) return emptyStats;

  const line = geojson.features[0];
  const coordinates = line.geometry.coordinates;

  // Longueur totale
  const length = turf.length(line, { units: "kilometers" }).toFixed(2);

  // Nombre d'intersections
  const numIntersections = intersections?.length || 0;

  // Distance moyenne entre PK
  const avgDistanceBetweenPK = calculateAvgDistanceBetweenPK(coordinates, intersections);

  // Altitudes
  const elevations = await fetchElevations(coordinates);
  const elevation = calculateElevationStats(elevations);

  // Pente moyenne
  const avgSlope = calculateAverageSlope(coordinates, elevations, intersections);

  return {
    length,
    intersections: numIntersections,
    avgDistanceBetweenPK,
    elevation,
    avgSlope,
  };
}

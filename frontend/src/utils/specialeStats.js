import * as turf from '@turf/turf';
import axios from 'axios';

async function fetchElevations(coordinates) {
  try {
    const locations = coordinates.map(coord => ({
      latitude: coord[1],
      longitude: coord[0]
    }));

    const response = await axios.post('https://api.open-elevation.com/api/v1/lookup', {
      locations: locations
    });

    return response.data.results;
  } catch (error) {
    console.error("Erreur lors de la récupération des altitudes:", error);
    return null;
  }
}

function calculateAverageSlope(coordinates, elevations, intersections) {
  if (!elevations || elevations.length < 2 || !intersections || intersections.length < 2) {
    return 0;
  }

  let totalSlope = 0;
  let segmentCount = 0;

  // Calculer la pente moyenne entre chaque PK
  for (let i = 0; i < intersections.length - 1; i++) {
    const startIdx = intersections[i];
    const endIdx = intersections[i + 1];

    const startElevation = elevations[startIdx].elevation;
    const endElevation = elevations[endIdx].elevation;

    const startCoord = coordinates[startIdx];
    const endCoord = coordinates[endIdx];
    const distance = turf.distance(turf.point(startCoord), turf.point(endCoord), { units: 'kilometers' });

    // Éviter les divisions par zéro
    if (distance === 0) continue;

    // Pente en pourcentage
    const elevationDiff = Math.abs(endElevation - startElevation);
    const slope = (elevationDiff / (distance * 1000)) * 100;
    totalSlope += slope;
    segmentCount++;
  }

  return segmentCount > 0 ? (totalSlope / segmentCount).toFixed(2) : 0;
}

export async function calculateSpecialeStats(geojson, intersections) {
  if (!geojson || !geojson.features || geojson.features.length === 0) {
    return {
      length: 0,
      intersections: 0,
      avgDistanceBetweenPK: 0,
      elevation: { min: 0, max: 0, gain: 0, loss: 0 },
      avgSlope: 0,
    };
  }

  const line = geojson.features[0];
  const length = turf.length(line, { units: 'kilometers' });
  const numIntersections = intersections ? intersections.length : 0;

  // Calculer la distance moyenne entre les PK
  let avgDistanceBetweenPK = 0;
  if (intersections && intersections.length > 1) {
    let totalDistance = 0;
    for (let i = 0; i < intersections.length - 1; i++) {
      const startIdx = intersections[i];
      const endIdx = intersections[i + 1];
      const startCoord = line.geometry.coordinates[startIdx];
      const endCoord = line.geometry.coordinates[endIdx];
      const segmentLength = turf.distance(turf.point(startCoord), turf.point(endCoord), { units: 'kilometers' });
      totalDistance += segmentLength;
    }
    avgDistanceBetweenPK = totalDistance / (intersections.length - 1);
  }

  // Récupérer les altitudes réelles
  const coordinates = line.geometry.coordinates;
  const elevations = await fetchElevations(coordinates);

  let elevation = { min: 0, max: 0, gain: 0, loss: 0 };
  let avgSlope = 0;

  if (elevations) {
    const elevationValues = elevations.map(e => e.elevation);
    elevation.min = Math.min(...elevationValues);
    elevation.max = Math.max(...elevationValues);

    // Calculer le dénivelé positif et négatif
    let totalGain = 0;
    let totalLoss = 0;
    for (let i = 1; i < elevationValues.length; i++) {
      const diff = elevationValues[i] - elevationValues[i - 1];
      if (diff > 0) {
        totalGain += diff;
      } else {
        totalLoss += Math.abs(diff);
      }
    }
    elevation.gain = totalGain.toFixed(0);
    elevation.loss = totalLoss.toFixed(0);

    // Calculer la pente moyenne
    avgSlope = calculateAverageSlope(coordinates, elevations, intersections);
  }

  return {
    length: length.toFixed(2),
    intersections: numIntersections,
    avgDistanceBetweenPK: avgDistanceBetweenPK.toFixed(2),
    elevation: elevation,
    avgSlope: avgSlope,
  };
}

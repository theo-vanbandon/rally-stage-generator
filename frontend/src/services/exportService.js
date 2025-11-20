/**
 * Service d'export des tracés
 */

/**
 * Télécharge un fichier
 * @param {Blob} blob - Contenu du fichier
 * @param {string} filename - Nom du fichier
 */
function downloadFile(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Extrait les coordonnées d'un GeoJSON
 * @param {Object} geojson - GeoJSON FeatureCollection
 * @returns {Array}
 */
function extractCoordinates(geojson) {
  if (!geojson?.features) return [];

  const coords = [];
  geojson.features.forEach((f) => {
    if (f.geometry?.type === "LineString") {
      coords.push(...f.geometry.coordinates);
    }
  });
  return coords;
}

/**
 * Export en GeoJSON
 * @param {Object} geojson - Données GeoJSON
 * @param {string} filename - Nom du fichier (défaut: stage.geojson)
 */
export function exportGeoJSON(geojson, filename = "stage.geojson") {
  const blob = new Blob([JSON.stringify(geojson, null, 2)], {
    type: "application/geo+json",
  });
  downloadFile(blob, filename);
}

/**
 * Export en KML
 * @param {Object} geojson - Données GeoJSON
 * @param {string} filename - Nom du fichier (défaut: stage.kml)
 */
export function exportKML(geojson, filename = "stage.kml") {
  const coords = extractCoordinates(geojson);
  if (coords.length === 0) return;

  const coordString = coords.map(([lon, lat]) => `${lon},${lat},0`).join(" ");

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Rally Stage</name>
    <Placemark>
      <name>Spéciale</name>
      <LineString>
        <coordinates>${coordString}</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;

  const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
  downloadFile(blob, filename);
}

/**
 * Export en GPX
 * @param {Object} geojson - Données GeoJSON
 * @param {string} filename - Nom du fichier (défaut: stage.gpx)
 */
export function exportGPX(geojson, filename = "stage.gpx") {
  const coords = extractCoordinates(geojson);
  if (coords.length === 0) return;

  const trackpoints = coords
    .map(([lon, lat]) => `      <trkpt lat="${lat}" lon="${lon}"></trkpt>`)
    .join("\n");

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RallyStageGenerator">
  <trk>
    <name>Spéciale</name>
    <trkseg>
${trackpoints}
    </trkseg>
  </trk>
</gpx>`;

  const blob = new Blob([gpx], { type: "application/gpx+xml" });
  downloadFile(blob, filename);
}

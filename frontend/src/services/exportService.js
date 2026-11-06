/**
 * Service d'export des spéciales (tracé + altitudes + roadbook)
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

const escapeXml = (str) =>
  String(str).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);

const pkLabel = (c) => `Case ${c.n} — km ${c.km.toFixed(2)}`;
const pkDescription = (c) => [c.direction, c.road, ...(c.notes || [])].filter(Boolean).join(" — ");

/**
 * Nom de fichier lisible : es-gap-1a2b3c.gpx
 */
export function stageFilename(stage, placeName, extension) {
  const slug = String(placeName || "speciale")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `es-${slug}-${stage.id}.${extension}`;
}

/**
 * Export en GeoJSON : tracé (avec statistiques) + un point par PK
 */
export function exportGeoJSON(stage, filename = "stage.geojson") {
  const geojson = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: stage.geometry, properties: { name: "Spéciale", roads: stage.roads, ...stage.stats, elevation: undefined } },
      ...stage.roadbook.map((pk) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: pk.coord },
        properties: {
          name: pkLabel(pk),
          case: pk.n,
          type: pk.type,
          km: pk.km,
          partial: pk.partial,
          direction: pk.direction,
          road: pk.road,
          notes: pk.notes,
        },
      })),
    ],
  };
  const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/geo+json" });
  downloadFile(blob, filename);
}

/**
 * Export en KML (Google Earth) : tracé en 3D + PK
 */
export function exportKML(stage, filename = "stage.kml") {
  const coords = stage.geometry.coordinates;
  if (coords.length === 0) return;

  const coordString = coords.map(([lon, lat, z]) => `${lon},${lat},${z ?? 0}`).join(" ");
  const placemarks = stage.roadbook
    .map(
      (pk) => `    <Placemark>
      <name>${escapeXml(pkLabel(pk))}</name>
      <description>${escapeXml(pkDescription(pk))}</description>
      <Point><coordinates>${pk.coord[0]},${pk.coord[1]},0</coordinates></Point>
    </Placemark>`
    )
    .join("\n");

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Spéciale ${stage.stats.lengthKm} km</name>
    <Style id="stage"><LineStyle><color>ff3539e5</color><width>4</width></LineStyle></Style>
    <Placemark>
      <name>Spéciale</name>
      <styleUrl>#stage</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${coordString}</coordinates>
      </LineString>
    </Placemark>
${placemarks}
  </Document>
</kml>`;

  const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
  downloadFile(blob, filename);
}

/**
 * Export en GPX (GPS, applis de navigation) : trace avec altitude + waypoints PK
 */
export function exportGPX(stage, filename = "stage.gpx") {
  const coords = stage.geometry.coordinates;
  if (coords.length === 0) return;

  const waypoints = stage.roadbook
    .map(
      (pk) => `  <wpt lat="${pk.coord[1]}" lon="${pk.coord[0]}">
    <name>${escapeXml(pkLabel(pk))}</name>
    <desc>${escapeXml(pkDescription(pk))}</desc>
  </wpt>`
    )
    .join("\n");

  const trackpoints = coords
    .map(([lon, lat, z]) =>
      z === undefined
        ? `      <trkpt lat="${lat}" lon="${lon}"></trkpt>`
        : `      <trkpt lat="${lat}" lon="${lon}"><ele>${z}</ele></trkpt>`
    )
    .join("\n");

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RallyStageGenerator" xmlns="http://www.topografix.com/GPX/1/1">
${waypoints}
  <trk>
    <name>Spéciale ${stage.stats.lengthKm} km</name>
    <trkseg>
${trackpoints}
    </trkseg>
  </trk>
</gpx>`;

  const blob = new Blob([gpx], { type: "application/gpx+xml" });
  downloadFile(blob, filename);
}

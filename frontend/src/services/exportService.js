/**
 * Service d'export des spéciales : une ou plusieurs spéciales par fichier, avec leurs waypoints utiles
 * (départ, arrivée, point stop et carrefours de boucle, un seul waypoint par carrefour décrivant les deux passages).
 *
 * Chaque format fait ce qu'il sait faire :
 *  - GPX : UN FICHIER PAR SPÉCIALE (archive .zip s'il y en a plusieurs), une seule trace par fichier, rien d'autre :
 *    les lecteurs marquent le départ et l'arrivée à leur façon (gpx.studio : point vert, drapeau à damier), souvent
 *    une seule fois par fichier ; avec une spéciale par fichier, ces marques tombent toujours au bon endroit.
 *    Symboles Garmin pour les waypoints (drapeaux), « Crossing » pour les boucles (aussi affiché par gpx.studio).
 *  - KML : un dossier par spéciale, une couleur par tracé, liaison vers le point stop, icônes Google Earth
 *  - GeoJSON : propriétés détaillées et styles « simplestyle » (geojson.io, GitHub, uMap…)
 */
import { haversineDistance } from "../utils/geometry";
import { createZip } from "../utils/zip";

/**
 * Une spéciale à exporter
 * @typedef {object} ExportItem
 * @property {object} stage - Spéciale (format de l'API), dans le sens à exporter
 * @property {string} label - "Tracé 2"
 * @property {string} tag - "T2", préfixe court des waypoints (utile sur un GPS)
 * @property {boolean} [reversed] - Spéciale affichée en sens inverse
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

// Couleur de chaque tracé, comme sur la carte : rouge, bleu, vert
const STAGE_COLORS = ["#e53935", "#1e88e5", "#43a047"];
const LIAISON_COLOR = "#607d8b";

const ROLES = {
  start: { label: "Départ", gpxSym: "Flag, Green", kmlIcon: "paddle/go.png", color: "#2e7d32", symbol: "d" },
  finish: { label: "Arrivée", gpxSym: "Flag, Red", kmlIcon: "shapes/flag.png", color: "#111111", symbol: "a" },
  stop: { label: "Point stop", gpxSym: "Flag, Blue", kmlIcon: "paddle/stop.png", color: "#c62828", symbol: "s" },
  loop: { label: "Boucle", gpxSym: "Crossing", kmlIcon: "paddle/blu-circle.png", color: "#1565c0", symbol: "circle" },
};
const KML_ICON_BASE = "http://maps.google.com/mapfiles/kml/";
const SAME_JUNCTION_KM = 0.03; // pivot décalé : deux nœuds IGN à quelques mètres = un seul carrefour

const lowerFirst = (text) => (text ? text.charAt(0).toLowerCase() + text.slice(1) : text);
const isLoopCase = (c) => c.notes?.some((n) => n.startsWith("Boucle"));

/** « 1er passage, km 2.85 : à gauche vers R DES FRENES (entrée dans la boucle) » */
function passLine(c, index) {
  const note = c.notes.find((n) => n.startsWith("Boucle")).replace(/^Boucle : /, "").replace(/ \(\d+e?r? passage\)$/, "");
  const what = note.replace(/^\d+e?r? passage — /, "");
  return `${index === 0 ? "1er" : `${index + 1}e`} passage, km ${c.km.toFixed(2)} : ${lowerFirst(c.direction)}${
    c.road ? ` vers ${c.road}` : ""
  } (${what})`;
}

/**
 * Waypoints d'une spéciale : départ, arrivée, point stop, et un waypoint par carrefour de boucle qui décrit
 * ses deux passages (direction à prendre et route à chaque fois)
 */
function waypointsOf({ stage, tag }, { prefix = true } = {}) {
  const z = new Map(stage.geometry.coordinates.map(([lon, lat, alt]) => [`${lon},${lat}`, alt]));
  const named = (text) => (prefix ? `${tag} ${text}` : text);
  const points = [];

  for (const c of stage.roadbook) {
    const role = { start: "start", finish: "finish", stop: "stop" }[c.type];
    if (!role) continue;
    const lines = [c.direction, c.road, ...(c.notes || [])].filter(Boolean);
    points.push({
      role,
      km: c.km,
      name: named(`${ROLES[role].label} — km ${c.km.toFixed(2)}`),
      lines,
      coord: c.coord,
      data: [["Km", c.km.toFixed(2)], ["Route", c.road]],
    });
  }

  // Carrefours de boucle : les passages au même endroit (ou à quelques mètres) sont regroupés
  const groups = [];
  for (const c of stage.roadbook.filter(isLoopCase)) {
    const group = groups.find((g) => haversineDistance(g[0].coord, c.coord) < SAME_JUNCTION_KM);
    if (group) group.push(c);
    else groups.push([c]);
  }
  const shared = stage.stats.loop?.kind === "shared";
  for (const passes of groups) {
    const [first] = passes;
    const where = shared
      ? first.notes.some((n) => /entrée sur la portion|retour sur la portion/.test(n))
        ? "début de la portion commune"
        : "fin de la portion commune"
      : "carrefour de la boucle";
    const lines = passes.map(passLine);
    points.push({
      role: "loop",
      km: first.km,
      name: named(`Boucle — ${where} (${passes.length} passages)`),
      lines,
      coord: first.coord,
      data: lines.map((line, i) => [`Passage ${i + 1}`, line]),
      passes: passes.map((c) => ({ km: c.km, direction: c.direction, road: c.road, note: c.notes.find((n) => n.startsWith("Boucle")) })),
    });
  }

  return points
    .sort((a, b) => a.km - b.km)
    .map((w) => ({ ...w, desc: w.lines.join("\n"), ele: z.get(`${w.coord[0]},${w.coord[1]}`) }));
}

const trackName = ({ stage, label, reversed }) =>
  `${label} — ${stage.stats.lengthKm.toFixed(2)} km${reversed ? " (sens inverse)" : ""}`;

const trackDesc = ({ stage }) => {
  const { stats } = stage;
  const parts = [`${stats.lengthKm.toFixed(2)} km`, `${stats.junctions} carrefours`];
  if (stats.elevation) parts.push(`D+ ${stats.elevation.gain} m`);
  if (stats.loop) parts.push(`boucle de ${stats.loop.lengthKm.toFixed(2)} km`);
  if (stage.roads?.length) parts.push(`via ${stage.roads.slice(0, 5).join(", ")}`);
  return parts.join(" · ");
};

const usable = (items) => items.filter(({ stage }) => stage?.geometry?.coordinates?.length > 0);

/**
 * GPX 1.1 : waypoints (symboles Garmin), une trace par spéciale avec altitudes. Pas de trace de liaison vers le
 * point stop : les applis marqueraient l'arrivée au bout de cette liaison.
 */
export function buildGPX(items, { title = "Spéciales" } = {}) {
  const list = usable(items);
  if (list.length === 0) return null;
  const prefix = list.length > 1;

  const wpts = list
    .flatMap((item) => waypointsOf(item, { prefix }))
    .map(
      (w) => `  <wpt lat="${w.coord[1]}" lon="${w.coord[0]}">${w.ele != null ? `
    <ele>${w.ele}</ele>` : ""}
    <name>${escapeXml(w.name)}</name>
    <desc>${escapeXml(w.desc)}</desc>
    <sym>${ROLES[w.role].gpxSym}</sym>
    <type>${ROLES[w.role].label}</type>
  </wpt>`
    )
    .join("\n");

  const trkpt = ([lon, lat, z]) =>
    z === undefined || z === null
      ? `      <trkpt lat="${lat}" lon="${lon}"></trkpt>`
      : `      <trkpt lat="${lat}" lon="${lon}"><ele>${z}</ele></trkpt>`;

  const tracks = list
    .map((item) => {
      return `  <trk>
    <name>${escapeXml(trackName(item))}</name>
    <desc>${escapeXml(trackDesc(item))}</desc>
    <type>Spéciale</type>
    <trkseg>
${item.stage.geometry.coordinates.map(trkpt).join("\n")}
    </trkseg>
  </trk>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RallyStageGenerator" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(title)}</name>
  </metadata>
${wpts}
${tracks}
</gpx>`;
}

/** Couleur KML (aabbggrr) depuis #rrggbb */
const kmlColor = (hex, alpha = "ff") => `${alpha}${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`;

/**
 * KML (Google Earth, Google My Maps) : un dossier par spéciale (tracé en 3D, liaison vers le stop, waypoints)
 */
export function buildKML(items, { title = "Spéciales" } = {}) {
  const list = usable(items);
  if (list.length === 0) return null;
  const prefix = list.length > 1;

  const styles = [
    ...list.map(
      (_, i) => `    <Style id="stage${i}"><LineStyle><color>${kmlColor(STAGE_COLORS[i % STAGE_COLORS.length])}</color><width>4</width></LineStyle></Style>`
    ),
    `    <Style id="liaison"><LineStyle><color>${kmlColor(LIAISON_COLOR, "cc")}</color><width>2</width></LineStyle></Style>`,
    ...Object.entries(ROLES).map(
      ([role, { kmlIcon }]) => `    <Style id="${role}"><IconStyle><Icon><href>${KML_ICON_BASE}${kmlIcon}</href></Icon></IconStyle></Style>`
    ),
  ].join("\n");

  const data = (w) =>
    w.data
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `<Data name="${k}"><value>${escapeXml(v)}</value></Data>`)
      .join("");

  const folders = list
    .map((item, i) => {
      const coords = item.stage.geometry.coordinates.map(([lon, lat, z]) => `${lon},${lat},${z ?? 0}`).join(" ");
      const liaison = item.stage.stop?.path?.length > 1
        ? `
      <Placemark>
        <name>${escapeXml(`${item.label} — vers le point stop`)}</name>
        <styleUrl>#liaison</styleUrl>
        <LineString><tessellate>1</tessellate><coordinates>${item.stage.stop.path.map(([lon, lat]) => `${lon},${lat},0`).join(" ")}</coordinates></LineString>
      </Placemark>`
        : "";
      const points = waypointsOf(item, { prefix })
        .map(
          (w) => `
      <Placemark>
        <name>${escapeXml(w.name)}</name>
        <description>${escapeXml(w.lines.map(escapeXml).join("<br>"))}</description>
        <styleUrl>#${w.role}</styleUrl>
        <ExtendedData>${data(w)}</ExtendedData>
        <Point><coordinates>${w.coord[0]},${w.coord[1]},0</coordinates></Point>
      </Placemark>`
        )
        .join("");
      return `    <Folder>
      <name>${escapeXml(trackName(item))}</name>
      <description>${escapeXml(trackDesc(item))}</description>
      <Placemark>
        <name>${escapeXml(trackName(item))}</name>
        <styleUrl>#stage${i}</styleUrl>
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>${coords}</coordinates>
        </LineString>
      </Placemark>${liaison}${points}
    </Folder>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(title)}</name>
${styles}
${folders}
  </Document>
</kml>`;
}

/**
 * GeoJSON : une ligne par spéciale (statistiques en propriétés), une ligne par liaison, un point par waypoint.
 * Styles « simplestyle » (stroke, marker-color…) reconnus par geojson.io, GitHub, uMap.
 */
export function buildGeoJSON(items) {
  const list = usable(items);
  if (list.length === 0) return null;
  const prefix = list.length > 1;

  const features = list.flatMap((item, i) => {
    const { stage, label, reversed = false } = item;
    const color = STAGE_COLORS[i % STAGE_COLORS.length];
    const line = {
      type: "Feature",
      geometry: stage.geometry,
      properties: {
        name: trackName(item),
        kind: "stage",
        stage: label,
        reversed,
        roads: stage.roads,
        ...stage.stats,
        elevation: stage.stats.elevation ? { ...stage.stats.elevation, profile: undefined } : undefined,
        stroke: color,
        "stroke-width": 4,
      },
    };
    const liaison = stage.stop?.path?.length > 1
      ? [{
          type: "Feature",
          geometry: { type: "LineString", coordinates: stage.stop.path },
          properties: { name: `${label} — vers le point stop`, kind: "liaison", stage: label, stroke: LIAISON_COLOR, "stroke-width": 2 },
        }]
      : [];
    const points = waypointsOf(item, { prefix }).map((w) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: w.coord },
      properties: {
        name: w.name,
        kind: "waypoint",
        role: w.role,
        stage: label,
        km: w.km,
        description: w.desc,
        ...(w.passes ? { passes: w.passes } : {}),
        "marker-color": ROLES[w.role].color,
        "marker-symbol": ROLES[w.role].symbol,
        "marker-size": ["start", "finish", "stop"].includes(w.role) ? "large" : "small",
      },
    }));
    return [line, ...liaison, ...points];
  });

  return JSON.stringify({ type: "FeatureCollection", features }, null, 2);
}

const FORMATS = {
  gpx: { build: buildGPX, type: "application/gpx+xml" },
  kml: { build: buildKML, type: "application/vnd.google-earth.kml+xml" },
  geojson: { build: buildGeoJSON, type: "application/geo+json" },
};

/**
 * Exporte les spéciales choisies. KML et GeoJSON : un seul fichier. GPX : un fichier par spéciale, regroupés dans
 * une archive .zip s'il y en a plusieurs (voir en tête de fichier).
 * @param {"gpx"|"kml"|"geojson"} format
 * @param {ExportItem[]} items
 * @param {{title?: string, placeName?: string}} options
 * @param {string} filename - Nom du fichier téléchargé (voir exportFilename)
 * @returns {boolean} false si rien à exporter
 */
export function exportStages(format, items, options, filename) {
  const { build, type } = FORMATS[format];
  const list = usable(items);
  if (list.length === 0) return false;

  if (format === "gpx" && list.length > 1) {
    const files = list.map((item) => ({
      name: `es-${slugify(options?.placeName)}-${item.tag.toLowerCase().replace("t", "trace-")}.gpx`,
      content: build([item], { title: [options?.placeName, item.label].filter(Boolean).join(" — ") }),
    }));
    downloadFile(createZip(files), filename);
    return true;
  }

  downloadFile(new Blob([build(list, options)], { type }), filename);
  return true;
}

const slugify = (name) =>
  String(name || "speciale")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Nom de fichier lisible : es-gap-1a2b3c.gpx
 */
export function stageFilename(stage, placeName, extension) {
  return `es-${slugify(placeName)}-${stage.id}.${extension}`;
}

/**
 * Nom de fichier d'un export : celui de la spéciale si elle est seule, sinon es-gap-traces-1-3.kml
 * (GPX de plusieurs spéciales : une archive es-gap-traces-1-3-gpx.zip, un .gpx par spéciale)
 */
export function exportFilename(items, placeName, extension) {
  if (items.length === 1) return stageFilename(items[0].stage, placeName, extension);
  const numbers = items.map(({ tag }) => tag.replace(/\D/g, "")).join("-");
  const base = `es-${slugify(placeName)}-traces-${numbers}`;
  return extension === "gpx" ? `${base}-gpx.zip` : `${base}.${extension}`;
}

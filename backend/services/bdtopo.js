/**
 * Récupération du réseau routier hors agglomération depuis la BD TOPO de l'IGN (service WFS Géoplateforme)
 *
 * Pourquoi la BD TOPO plutôt qu'OpenStreetMap/Overpass :
 *  - champ officiel "urbain" sur chaque tronçon : on distingue les agglomérations des hameaux
 *  - réseau topologique (tronçons coupés aux intersections)
 *  - altitude (Z) intégrée à la géométrie, précise au mètre
 *  - service rapide et stable, pagination parallélisable
 */
const axios = require("axios");
const { bboxAround } = require("../utils/geometry");

const WFS_URL = "https://data.geopf.fr/wfs/ows";
const LAYER = "BDTOPO_V3:troncon_de_route";
const PAGE_SIZE = 5000;
const MAX_PARALLEL = 3; // pages téléchargées en même temps : plus = plus rapide, mais plus de GeoJSON brut en mémoire
const TIMEOUT_MS = 30000;
const RETRIES = 3;
// Au-delà, la zone ne tient pas dans la mémoire d'un petit serveur (512 Mo) : refusée proprement (« zone trop dense »)
// plutôt que de faire planter le serveur. 110 000 laisse passer Laventie à 20 km (102 000) ou Toulouse à 10 km (89 000).
const MAX_SEGMENTS = Number(process.env.MAX_SEGMENTS) || 110000;

// Natures récupérées : routes exploitables + réseau principal (intersections et liaisons vers l'extérieur)
const NATURES = [
  "Route à 1 chaussée",
  "Route empierrée",
  "Chemin",
  "Route à 2 chaussées",
  "Rond-point",
  "Bretelle",
  "Quasi-autoroute",
  "Type autoroutier",
];

const PROPERTIES = [
  "geometrie",
  "nature",
  "urbain",
  "importance",
  "acces_vehicule_leger",
  "sens_de_circulation",
  "position_par_rapport_au_sol",
  "prive",
  "largeur_de_chaussee",
  "nombre_de_voies",
  "itineraire_vert",
  "cpx_numero",
  "nom_collaboratif_gauche",
];

const NO_ELEVATION = -1000;

function buildFilter(lat, lon, radiusKm) {
  const [s, w, n, e] = bboxAround(lat, lon, radiusKm);
  const natures = NATURES.map((x) => `'${x}'`).join(",");
  // Les tronçons urbains sont aussi récupérés : les hameaux relient les routes rurales entre elles.
  // Le tri hameau / ville se fait ensuite (voir roadNetwork.dropDenseUrbanAreas)
  return `nature IN (${natures}) AND BBOX(geometrie,${s},${w},${n},${e})`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(filter, startIndex) {
  let lastError;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await axios.get(WFS_URL, {
        params: {
          SERVICE: "WFS",
          VERSION: "2.0.0",
          REQUEST: "GetFeature",
          TYPENAMES: LAYER,
          OUTPUTFORMAT: "application/json",
          COUNT: PAGE_SIZE,
          STARTINDEX: startIndex,
          SORTBY: "cleabs",
          PROPERTYNAME: PROPERTIES.join(","),
          CQL_FILTER: filter,
        },
        timeout: TIMEOUT_MS,
      });
      if (!Array.isArray(res.data?.features)) throw new Error("Réponse WFS invalide");
      return res.data;
    } catch (err) {
      lastError = err;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw new Error(`Service IGN indisponible (${lastError?.message || "erreur inconnue"})`);
}

const round = (x, decimals) => Math.round(x * 10 ** decimals) / 10 ** decimals;

/**
 * Convertit un tronçon WFS en objet compact (moins de mémoire, cache disque léger)
 */
function compactSegment(feature) {
  const p = feature.properties;
  const coords = feature.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;

  return {
    nature: p.nature,
    importance: Number(p.importance) || 6,
    urban: p.urbain === true,
    access: p.acces_vehicule_leger,
    direction: p.sens_de_circulation,
    level: p.position_par_rapport_au_sol,
    private: p.prive === true,
    width: p.largeur_de_chaussee ?? null,
    lanes: p.nombre_de_voies ?? null,
    greenway: p.itineraire_vert === true,
    ref: p.cpx_numero || null,
    name: p.nom_collaboratif_gauche || null,
    coords: coords.map(([lon, lat, z]) => [
      round(lon, 6),
      round(lat, 6),
      z === undefined || z <= NO_ELEVATION ? null : round(z, 1),
    ]),
  };
}

/**
 * Récupère les tronçons routiers dans un carré autour d'un point
 * @returns {Promise<Array>} Tronçons compacts
 */
async function fetchRoads(lat, lon, radiusKm) {
  const filter = buildFilter(lat, lon, radiusKm);
  let first = await fetchPage(filter, 0);
  const total = first.numberMatched ?? first.features.length;
  if (total > MAX_SEGMENTS) {
    // Au-delà, la mémoire du serveur ne suffit plus (et c'est forcément une zone très urbanisée)
    const err = new Error(
      "Zone trop dense pour être analysée : réduis le rayon ou choisis une commune plus rurale."
    );
    err.code = "ZONE_TOO_LARGE";
    throw err;
  }

  // Chaque page est compactée dès son arrivée et son GeoJSON brut libéré : garder les ~20 pages brutes d'une grande
  // zone jusqu'à la fin faisait dépasser la mémoire de l'hébergeur (512 Mo). L'ordre des tronçons est conservé.
  const segments = [];
  const keep = (page) => {
    for (const f of page.features) {
      const seg = compactSegment(f);
      if (seg) segments.push(seg);
    }
  };
  keep(first);
  first = null;

  const offsets = [];
  for (let start = PAGE_SIZE; start < total; start += PAGE_SIZE) offsets.push(start);
  for (let i = 0; i < offsets.length; i += MAX_PARALLEL) {
    const batch = await Promise.all(offsets.slice(i, i + MAX_PARALLEL).map((start) => fetchPage(filter, start)));
    batch.forEach(keep);
  }
  return segments;
}

module.exports = { fetchRoads, buildFilter, compactSegment };

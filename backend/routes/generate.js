/**
 * Routes API pour la génération de spéciales
 */
const express = require("express");
const router = express.Router();

const { geocode } = require("../services/geocoder");
const { fetchRoads } = require("../services/bdtopo");
const { buildNetwork } = require("../services/roadNetwork");
const { generateStages, SURFACE_MODES, LENGTH_PRESETS } = require("../services/stageGenerator");
const { TtlCache, DEFAULT_DISK_DIR } = require("../services/cache");

const MIN_RADIUS_KM = 3;
const MAX_RADIUS_KM = 20;
const HOUR = 3600 * 1000;
const MAX_AVOID = 60; // tracés déjà vus pris en compte (les plus récents)

const geocodeCache = new TtlCache({ maxEntries: 500, ttlMs: 24 * HOUR });
// Tronçons bruts : persistés sur disque (survivent à un redémarrage), rien en mémoire (le graphe suffit).
// Le dossier se nettoie seul : au démarrage, après chaque écriture et toutes les 6 h.
const CACHE_VERSION = "bdtopo-v2";
const roadsCache = new TtlCache({
  maxEntries: 0,
  ttlMs: 7 * 24 * HOUR,
  diskDir: DEFAULT_DISK_DIR,
  diskPrefix: `${CACHE_VERSION}_`,
  maxDiskBytes: (Number(process.env.CACHE_MAX_MB) || 300) * 1024 * 1024,
});
const pruneCache = () => {
  const { removed, totalBytes } = roadsCache.pruneDisk();
  if (removed) console.log(`🧹 Cache : ${removed} fichier(s) supprimé(s), ${(totalBytes / 1e6).toFixed(1)} Mo conservés`);
};
pruneCache();
setInterval(pruneCache, 6 * HOUR).unref();
// Graphes construits : mémoire seule
const networkCache = new TtlCache({ maxEntries: 4, ttlMs: 2 * HOUR });

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseRequest(body = {}) {
  const radiusKm = Number(body.radiusKm ?? 10);
  if (!Number.isFinite(radiusKm) || radiusKm < MIN_RADIUS_KM || radiusKm > MAX_RADIUS_KM) {
    throw new HttpError(400, `Le rayon doit être compris entre ${MIN_RADIUS_KM} et ${MAX_RADIUS_KM} km`);
  }

  const surface = body.surface ?? "asphalt";
  if (!SURFACE_MODES[surface]) throw new HttpError(400, "surface doit valoir asphalt, gravel ou mixed");

  const length = body.length ?? "medium";
  if (!LENGTH_PRESETS[length]) throw new HttpError(400, "length doit valoir short, medium ou long");

  const hasCoords = Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lon)) && body.lat !== null && body.lon !== null;
  if (!hasCoords && !body.place?.trim()) throw new HttpError(400, "place is required");

  const seed = Number.isInteger(body.seed) ? body.seed >>> 0 : Math.floor(Math.random() * 2 ** 31);
  const avoid = Array.isArray(body.avoid)
    ? body.avoid.filter((id) => typeof id === "string" && id.length <= 16).slice(-MAX_AVOID)
    : [];

  return {
    place: body.place?.trim(),
    postal: body.postal?.trim() || null,
    lat: hasCoords ? Number(body.lat) : null,
    lon: hasCoords ? Number(body.lon) : null,
    radiusKm: Math.round(radiusKm),
    surface,
    length,
    seed,
    avoid,
    // true (anciens liens) = boucle par un carrefour
    loop: body.loop === true || body.loop === "junction" ? "junction" : body.loop === "shared" ? "shared" : false,
  };
}

async function resolveCenter(req) {
  if (req.lat !== null) return { lat: req.lat, lon: req.lon, name: req.place || null };
  const key = `${req.place.toLowerCase()}|${req.postal || ""}`;
  try {
    const { value } = await geocodeCache.getOrCompute(key, () => geocode(req.place, req.postal));
    return value;
  } catch (err) {
    throw new HttpError(404, err.message);
  }
}

/**
 * Récupère (ou réutilise) le graphe de la zone. Le centre est arrondi à ~1 km
 * pour que des demandes voisines partagent le même cache.
 */
async function loadNetwork(center, radiusKm, timings) {
  const lat = Math.round(center.lat * 100) / 100;
  const lon = Math.round(center.lon * 100) / 100;
  const key = `${CACHE_VERSION}_${lat}_${lon}_${radiusKm}`;

  let t = Date.now();
  let dataSource = "memory";
  const { value: network } = await networkCache.getOrCompute(key, async () => {
    // Les échecs ne sont jamais mis en cache : un résultat vide lève une erreur plutôt que d'être stocké
    const { value: segments, source } = await roadsCache.getOrCompute(
      key,
      async () => {
        const roads = await fetchRoads(lat, lon, radiusKm);
        if (roads.length === 0) throw new HttpError(404, "Aucune route trouvée dans ce rayon.");
        return roads;
      },
      { persist: true }
    );
    dataSource = source;
    timings.dataMs = Date.now() - t;
    t = Date.now();
    const built = buildNetwork(segments, { lat, lon });
    if (built.edges.length === 0) {
      throw new HttpError(404, "Aucune route hors ville trouvée dans ce rayon.");
    }
    built.segmentsCount = segments.length;
    timings.buildMs = Date.now() - t;
    return built;
  });
  return { network, dataSource };
}

/** Rayons essayés : celui demandé, puis +5 km et +10 km (plafonnés au maximum) */
function searchRadii(requested) {
  return [...new Set([requested, requested + 5, requested + 10].map((r) => Math.min(r, MAX_RADIUS_KM)))];
}

/**
 * POST /api/generate
 * Génère une spéciale de rallye (et 2 alternatives) autour d'une commune ou d'un point
 */
router.post("/", async (req, res) => {
  const started = Date.now();
  const timings = {};

  try {
    const params = parseRequest(req.body);

    let t = Date.now();
    const center = await resolveCenter(params);
    timings.geocodeMs = Date.now() - t;

    // Zone sans spéciale possible (vallée urbanisée, massif fermé à la circulation…) : on élargit
    // automatiquement la recherche plutôt que de répondre "rien ici"
    let network;
    let dataSource;
    let result = { stages: [] };
    let radiusKm = params.radiusKm;
    let analysedKm = params.radiusKm;
    for (radiusKm of searchRadii(params.radiusKm)) {
      try {
        ({ network, dataSource } = await loadNetwork(center, radiusKm, timings));
      } catch (err) {
        if (err.status === 404) continue;
        if (err.code === "ZONE_TOO_LARGE") {
          if (radiusKm === params.radiusKm) throw new HttpError(422, err.message);
          break;
        }
        throw err;
      }
      analysedKm = radiusKm;
      t = Date.now();
      result = generateStages(network, params);
      timings.generateMs = Date.now() - t;
      if (result.stages.length) break;
    }
    timings.totalMs = Date.now() - started;

    if (result.stages.length === 0 && params.loop) {
      throw new HttpError(
        404,
        `Aucune spéciale avec boucle possible dans ${analysedKm} km : il faut un carrefour où se croisent quatre ` +
          "routes et un tour de quelques kilomètres hors des bourgs. Essaie sans boucle, une autre longueur ou " +
          "une autre commune."
      );
    }
    if (result.stages.length === 0) {
      throw new HttpError(
        404,
        `Aucune spéciale possible dans ${analysedKm} km : trop peu de petites routes rurales ouvertes à la circulation. ` +
          "Choisis une commune plus rurale ou un autre revêtement."
      );
    }

    const [stage, ...alternatives] = result.stages;
    console.log(
      `🏁 ${center.name || `${center.lat},${center.lon}`} r=${radiusKm}km ${params.surface}/${params.length} ` +
        `seed=${params.seed} → ${stage.stats.lengthKm} km (${dataSource}, ${timings.totalMs} ms)`
    );

    return res.json({
      ok: true,
      center,
      radiusKm,
      expandedFrom: radiusKm === params.radiusKm ? null : params.radiusKm,
      surface: params.surface,
      length: params.length,
      loop: params.loop,
      seed: params.seed,
      relaxed: result.relaxed,
      surfaceRelaxed: result.surfaceRelaxed,
      exhausted: result.exhausted,
      stage,
      alternatives,
      meta: {
        segments: network.segmentsCount,
        drivableSegments: network.edges.length,
        candidates: result.candidatesCount,
        dataSource,
        timings,
      },
    });
  } catch (err) {
    const status = err.status || (err.message?.startsWith("Service IGN") ? 502 : 500);
    console.error(`❌ ${status} ${err.message}`);
    return res.status(status).json({ ok: false, error: err.message || String(err) });
  }
});

module.exports = router;
module.exports.parseRequest = parseRequest;
module.exports.searchRadii = searchRadii;

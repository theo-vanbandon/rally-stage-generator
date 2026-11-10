/**
 * POST /api/liaisons
 * Liaisons entre les spéciales proposées, dans l'ordre choisi par l'utilisateur (chacune dans son sens)
 *
 * Corps : { lat, lon, radiusKm, stages: [{ start, finish, stop, coordinates }] } — lat/lon/radiusKm de la
 * génération (même réseau, déjà en cache), spéciales telles qu'affichées, dans l'ordre du rallye
 */
const express = require("express");
const router = express.Router();

const { loadNetwork, HttpError, RADIUS_KM, searchRadii } = require("./generate");
const { computeLiaisons, CLEAN_TIERS } = require("../services/liaisons");

const MAX_STAGES = 6;
const isCoord = (c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]);

function parseLiaisonRequest(body = {}) {
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  const radiusKm = Number(body.radiusKm);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new HttpError(400, "lat et lon sont requis");
  if (!Number.isFinite(radiusKm) || radiusKm < RADIUS_KM[0] || radiusKm > RADIUS_KM[1]) {
    throw new HttpError(400, "radiusKm invalide");
  }
  const { stages } = body;
  if (!Array.isArray(stages) || stages.length < 2 || stages.length > MAX_STAGES) {
    throw new HttpError(400, `Il faut entre 2 et ${MAX_STAGES} spéciales`);
  }
  for (const s of stages) {
    if (!isCoord(s?.start) || !isCoord(s?.finish) || !Array.isArray(s.coordinates) || !s.coordinates.every(isCoord)) {
      throw new HttpError(400, "Spéciale invalide : start, finish et coordinates sont requis");
    }
  }
  return { lat, lon, radiusKm, stages };
}

router.post("/", async (req, res) => {
  try {
    const { lat, lon, radiusKm, stages } = parseLiaisonRequest(req.body);
    const { network } = await loadNetwork({ lat, lon }, radiusKm, {});
    const t = Date.now();
    // 1. Liaisons propres (aucune spéciale empruntée, au pire une ES fermée à un autre moment) dans la zone
    const liaisons = computeLiaisons(network, stages, { maxTier: CLEAN_TIERS });
    const failed = () => new Set(liaisons.filter((l) => !l.ok).map((l) => l.from));

    // 2. Sinon, le bon trajet passe souvent juste au-delà de la zone : même recherche sur une zone élargie
    for (const r of searchRadii(radiusKm).slice(1)) {
      if (failed().size === 0) break;
      let wider;
      try {
        ({ network: wider } = await loadNetwork({ lat, lon }, r, {}));
      } catch (err) {
        if (err.status === 404 || err.code === "ZONE_TOO_LARGE") break;
        throw err;
      }
      for (const l of computeLiaisons(wider, stages, { only: failed(), maxTier: CLEAN_TIERS })) {
        if (l.ok) liaisons[l.from] = { ...l, expandedKm: r };
      }
    }

    // 3. Enfin, une liaison est toujours proposée, avec le compromis signalé (demi-tour, traversée…)
    if (failed().size) {
      for (const l of computeLiaisons(network, stages, { only: failed() })) liaisons[l.from] = l;
    }
    return res.json({ ok: true, liaisons, meta: { computeMs: Date.now() - t } });
  } catch (err) {
    const status = err.status || (err.message?.startsWith("Service IGN") ? 502 : 500);
    console.error(`❌ liaisons ${status} ${err.message}`);
    return res.status(status).json({ ok: false, error: err.message || String(err) });
  }
});

module.exports = router;
module.exports.parseLiaisonRequest = parseLiaisonRequest;

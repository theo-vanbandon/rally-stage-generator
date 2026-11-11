/**
 * POST /api/water
 * Points de vigilance eau (plongeurs) le long des spéciales affichées, chacune dans son sens
 *
 * Corps : { stages: [{ coordinates: [[lon, lat], …] }] } — réponse : { points: [[…], […]] } (un tableau par spéciale)
 */
const express = require("express");
const router = express.Router();

const { HttpError } = require("./generate");
const { fetchWater, waterPoints, trackBox } = require("../services/water");
const { memoryLabel } = require("../utils/memory");

const MAX_STAGES = 6;
const isCoord = (c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]);

function parseWaterRequest(body = {}) {
  const { stages } = body;
  if (!Array.isArray(stages) || stages.length < 1 || stages.length > MAX_STAGES) {
    throw new HttpError(400, `Il faut entre 1 et ${MAX_STAGES} spéciales`);
  }
  for (const s of stages) {
    if (!Array.isArray(s?.coordinates) || s.coordinates.length < 2 || !s.coordinates.every(isCoord)) {
      throw new HttpError(400, "Spéciale invalide : coordinates est requis");
    }
  }
  return stages;
}

router.post("/", async (req, res) => {
  try {
    const stages = parseWaterRequest(req.body);
    const t = Date.now();
    const points = await Promise.all(
      stages.map(async (s) => waterPoints(s.coordinates, await fetchWater(trackBox(s.coordinates))))
    );
    const divers = points.flat().filter((p) => p.level === "divers").length;
    const watch = points.flat().filter((p) => p.level === "watch").length;
    console.log(`🌊 Eau ${stages.length} ES → ${divers} plongeurs, ${watch} à surveiller (${Date.now() - t} ms) | ${memoryLabel()}`);
    return res.json({ ok: true, points, meta: { computeMs: Date.now() - t } });
  } catch (err) {
    const status = err.status || (err.message?.startsWith("Service IGN") ? 502 : 500);
    console.error(`❌ eau ${status} ${err.message} | ${memoryLabel()}`);
    return res.status(status).json({ ok: false, error: err.message || String(err) });
  }
});

module.exports = router;
module.exports.parseWaterRequest = parseWaterRequest;

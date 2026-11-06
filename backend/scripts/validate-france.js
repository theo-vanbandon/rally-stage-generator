/**
 * Banc de validation sur données réelles (IGN BD TOPO) : génère des spéciales autour de communes
 * aux profils variés et vérifie les règles du générateur sur chaque tracé.
 *
 * Usage :
 *   npm run validate                 # toutes les communes
 *   npm run validate -- Gap Mende    # seulement certaines communes
 *
 * Nécessite internet (IGN + geo.api.gouv.fr). Les réseaux téléchargés sont mis en cache disque,
 * partagé avec le serveur.
 */
const { geocode } = require("../services/geocoder");
const { fetchRoads } = require("../services/bdtopo");
const { buildNetwork } = require("../services/roadNetwork");
const { generateStages, hasExit, LENGTH_PRESETS } = require("../services/stageGenerator");
const { TtlCache, DEFAULT_DISK_DIR } = require("../services/cache");
const { haversineKm } = require("../utils/geometry");
const { searchRadii } = require("../routes/generate");

// [commune, code postal, rayon (km), profil]
const COMMUNES = [
  ["Gap", "05000", 12, "Alpes"],
  ["Briançon", "05100", 12, "Haute montagne"],
  ["Barcelonnette", "04400", 15, "Haute montagne"],
  ["Chamonix-Mont-Blanc", "74400", 10, "Haute montagne, vallée étroite"],
  ["Morzine", "74110", 12, "Alpes (Rallye Mont-Blanc)"],
  ["Sospel", "06380", 12, "Arrière-pays niçois (Monte-Carlo)"],
  ["Corte", "20250", 15, "Corse (Tour de Corse)"],
  ["Ajaccio", "20000", 12, "Corse, littoral"],
  ["Bagnères-de-Bigorre", "65200", 12, "Pyrénées"],
  ["Saint-Girons", "09200", 12, "Pyrénées ariégeoises"],
  ["Saint-Flour", "15100", 12, "Massif central"],
  ["Mende", "48000", 15, "Lozère (Terre de Lozère)"],
  ["Millau", "12100", 15, "Causses (Terre des Cardabelles)"],
  ["Rodez", "12000", 12, "Rouergue"],
  ["Le Vigan", "30120", 12, "Cévennes"],
  ["Alès", "30100", 10, "Cévennes, ville moyenne"],
  ["Apt", "84400", 12, "Vaucluse (Terre de Vaucluse)"],
  ["Figeac", "46100", 12, "Quercy"],
  ["Aubusson", "23200", 12, "Creuse, très rural"],
  ["Gérardmer", "88400", 12, "Vosges"],
  ["Sélestat", "67600", 12, "Alsace, plaine et vignoble"],
  ["Langres", "52200", 12, "Plateau de Langres"],
  ["Chartres", "28000", 12, "Beauce, openfield"],
  ["Châlons-en-Champagne", "51000", 12, "Champagne crayeuse"],
  ["Mont-de-Marsan", "40000", 12, "Landes, forêt de pins"],
  ["Pontivy", "56300", 12, "Bocage breton"],
  ["Lisieux", "14100", 12, "Normandie"],
  ["Brest", "29200", 12, "Littoral, moitié en mer"],
  ["Le Palais", "56360", 8, "Île (Belle-Île)"],
  ["Saint-Pierre", "97410", 12, "La Réunion"],
  ["Paris", "75001", 10, "Métropole dense"],
  ["Lyon", "69001", 10, "Métropole dense"],
  ["Marseille", "13001", 12, "Métropole dense et littoral"],
];

const SURFACES = ["asphalt", "gravel", "mixed"];
const LENGTHS = ["short", "medium", "long"];
const MAX_GENERATE_MS = 2000;

const roadsCache = new TtlCache({
  maxEntries: 0,
  ttlMs: 7 * 24 * 3600 * 1000,
  diskDir: DEFAULT_DISK_DIR,
  diskPrefix: "bdtopo-v2_",
  maxDiskBytes: 300 * 1024 * 1024,
});

const key = (c) => `${c[0]},${c[1]}`;
const segmentKeys = (stage) => {
  const c = stage.geometry.coordinates.map(key);
  return new Set(c.slice(1).map((k, i) => [c[i], k].sort().join("|")));
};

/**
 * Vérifie toutes les règles sur une spéciale ; retourne la liste des écarts
 */
function checkStage(stage, { network, nodeByCoord, surface, length, result }) {
  const problems = [];
  const fail = (msg) => problems.push(msg);
  const { stats, roadbook } = stage;
  const [minKm, maxKm] = LENGTH_PRESETS[length];

  // Longueur
  const floor = result.relaxed ? Math.max(2, minKm * 0.5) : minKm;
  if (stats.lengthKm < floor - 0.05 || stats.lengthKm > maxKm + 0.05) {
    fail(`longueur ${stats.lengthKm} km hors [${floor}, ${maxKm}]`);
  }

  // Jamais deux fois le même carrefour
  const junctionCoords = stage.geometry.coordinates.map(key).filter((k) => nodeByCoord.has(k));
  if (new Set(junctionCoords).size !== junctionCoords.length) fail("repasse par un même carrefour");

  // Accès au départ et sortie de l'arrivée sans emprunter la spéciale
  const stageNodes = new Set(junctionCoords.map((k) => nodeByCoord.get(k)));
  if (!hasExit(network, nodeByCoord.get(key(stage.start)), stageNodes)) fail("départ inaccessible");
  if (!hasExit(network, nodeByCoord.get(key(stage.finish)), stageNodes)) fail("arrivée enfermée");

  // Zones habitées
  if (stats.urbanPct > 40) fail(`${stats.urbanPct} % en zone habitée`);

  // Revêtement
  const unpaved = 100 - stats.surfacePct.paved;
  if (surface === "asphalt" && unpaved > 0) fail(`${unpaved} % de terre en mode asphalte`);
  if (surface === "gravel" && unpaved < (result.surfaceRelaxed ? 34 : 59)) fail(`seulement ${unpaved} % de terre en mode terre`);
  if (surface === "mixed" && (unpaved < (result.surfaceRelaxed ? 9 : 24) || unpaved > 76)) {
    fail(`${unpaved} % de terre en mode mixte`);
  }

  // Portions de revêtement contiguës
  const { surfaces } = stage;
  if (surfaces[0].from !== 0 || surfaces.at(-1).to !== stage.geometry.coordinates.length - 1) {
    fail("portions de revêtement incomplètes");
  }

  // Roadbook
  if (roadbook[0].type !== "start") fail("roadbook : pas de case départ en premier");
  const finishIndex = roadbook.findIndex((c) => c.type === "finish");
  if (finishIndex === -1) fail("roadbook : pas d'arrivée lancée");
  else if (Math.abs(roadbook[finishIndex].km - stats.lengthKm) > 0.02) fail("roadbook : km d'arrivée ≠ longueur");
  if (!stage.stop || roadbook.at(-1).type !== "stop") fail("roadbook : pas de point stop");
  roadbook.forEach((c, i) => {
    if (c.n !== i + 1) fail(`roadbook : case ${i + 1} mal numérotée`);
    if (i > 0 && c.km < roadbook[i - 1].km) fail(`roadbook : km décroissant case ${c.n}`);
    if (i > 0 && Math.abs(c.partial - (c.km - roadbook[i - 1].km)) > 0.011) fail(`roadbook : partiel faux case ${c.n}`);
    if (c.type === "junction" && (!c.tulip?.entry || c.tulip.exit !== c.angle)) fail(`roadbook : tulipe incohérente case ${c.n}`);
    if (c.tulip) problems.push(...checkTulip(c));
  });

  if (!stats.elevation) fail("pas d'altitudes");
  return problems;
}

/** Point situé à la longueur `at` (repère tulipe) le long d'une forme partant du centre */
function pointAlongPath(path, at) {
  let travelled = 0;
  let prev = [0, 0];
  for (const p of path) {
    const step = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    if (travelled + step >= at && step > 0) {
      const t = (at - travelled) / step;
      return [prev[0] + (p[0] - prev[0]) * t, prev[1] + (p[1] - prev[1]) * t];
    }
    travelled += step;
    prev = p;
  }
  return prev;
}

/**
 * Tulipe : formes dans le cadre, arrivée par le bas, flèche cohérente avec le libellé gauche / droite
 */
function checkTulip(c) {
  const problems = [];
  const { tulip } = c;
  const paths = [tulip.exitPath, tulip.entryPath, ...tulip.others.map((b) => b.path)].filter(Boolean);
  if (!tulip.exitPath?.length) problems.push(`tulipe case ${c.n} : pas de tracé de sortie`);
  if (paths.flat().some(([x, y]) => Math.abs(x) > 1.01 || Math.abs(y) > 1.01)) problems.push(`tulipe case ${c.n} : forme hors cadre`);

  if (tulip.entryPath?.length) {
    // Le sens d'arrivée est juste : les premiers mètres avant le carrefour descendent vers le bas de la tulipe.
    // (Plus loin, la route peut s'enrouler autour du carrefour — sommet d'un lacet — c'est fidèle au terrain.)
    const near = tulip.entryPath.find(([x, y]) => Math.hypot(x, y) >= 0.1) ?? tulip.entryPath.at(-1);
    if (near[1] >= 0) problems.push(`tulipe case ${c.n} : l'arrivée ne vient pas du bas`);
    const [ex, ey] = tulip.entryPath.at(-1);
    if (Math.abs(Math.atan2(ex, -ey)) > (76 * Math.PI) / 180) problems.push(`tulipe case ${c.n} : point d'arrivée sur le côté`);
  }
  // Au-delà de 165°, c'est un demi-tour : gauche / droite n'a plus de sens
  if (Math.abs(tulip.exit) >= 25 && Math.abs(tulip.exit) <= 165 && tulip.exitPath?.length) {
    // La flèche part du bon côté : 40 m le long de la route (comme le générateur), la route est du côté annoncé.
    // Mesuré le long du tracé et non à vol d'oiseau : un lacet peut s'enrouler sans jamais s'éloigner.
    const far = pointAlongPath(tulip.exitPath, 1); // rayon 1 de la tulipe = 40 m
    if (Math.sign(far[0]) !== Math.sign(tulip.exit)) problems.push(`tulipe case ${c.n} : flèche (${far[0]}) et direction (${tulip.exit}°) opposées`);
  }
  return problems;
}

function checkAlternatives(stages) {
  const keys = stages.map(segmentKeys);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if ([...keys[i]].some((k) => keys[j].has(k))) return [`tracés ${i + 1} et ${j + 1} se chevauchent`];
    }
  }
  return [];
}

async function validateCommune([name, postal, radiusKm, profile], index) {
  const report = { name, profile, radiusKm, runs: 0, ok: 0, empty: 0, problems: [], lengths: [], twists: [], genMs: [], unpaved: { gravel: [], mixed: [] }, minCenterKm: Infinity };

  let center;
  try {
    center = await geocode(name, postal);
  } catch (err) {
    report.fatal = `géocodage : ${err.message}`;
    return report;
  }
  const lat = Math.round(center.lat * 100) / 100;
  const lon = Math.round(center.lon * 100) / 100;

  // Réseaux par rayon, chargés à la demande : le serveur élargit la zone quand rien n'est possible
  const networks = new Map();
  const networkFor = async (r) => {
    if (networks.has(r)) return networks.get(r);
    let entry;
    try {
      const t0 = Date.now();
      const { value: segments } = await roadsCache.getOrCompute(
        `bdtopo-v2_${lat}_${lon}_${r}`,
        () => fetchRoads(lat, lon, r),
        { persist: true }
      );
      const fetchMs = Date.now() - t0;
      const network = buildNetwork(segments, { lat, lon });
      entry = {
        network,
        fetchMs,
        segments: segments.length,
        drivableKm: Math.round(network.edges.reduce((sum, e) => sum + e.lengthKm, 0)),
        nodeByCoord: new Map(network.nodes.map((n, i) => [key(n.coord), i])),
      };
    } catch (err) {
      entry = { error: err.code === "ZONE_TOO_LARGE" ? "zone trop dense" : err.message };
    }
    networks.set(r, entry);
    return entry;
  };

  const base = await networkFor(radiusKm);
  if (base.error && base.error !== "zone trop dense") {
    report.fatal = `téléchargement : ${base.error}`;
    return report;
  }
  Object.assign(report, { fetchMs: base.fetchMs, segments: base.segments, drivableKm: base.drivableKm, tooDense: base.error });
  report.expanded = 0;

  for (const surface of SURFACES) {
    for (const length of LENGTHS) {
      for (const run of [0, 1]) {
        const seed = 1000 * (index + 1) + 100 * SURFACES.indexOf(surface) + 10 * LENGTHS.indexOf(length) + run;
        const tag = `${surface}/${length}#${seed}`;
        report.runs++;

        let result = { stages: [] };
        let zone = null;
        let genMs = 0;
        for (const r of searchRadii(radiusKm)) {
          zone = await networkFor(r);
          if (zone.error === "zone trop dense") break;
          if (zone.error) continue;
          const t = Date.now();
          result = generateStages(zone.network, { surface, length, seed });
          genMs = Date.now() - t;
          if (result.stages.length) {
            if (r !== radiusKm) report.expanded++;
            break;
          }
        }
        report.genMs.push(genMs);
        if (result.stages.length === 0) {
          report.empty++;
          continue;
        }

        const { network, nodeByCoord } = zone;
        const problems = [
          ...result.stages.flatMap((stage, i) =>
            checkStage(stage, { network, nodeByCoord, surface, length, result }).map((p) => `tracé ${i + 1} : ${p}`)
          ),
          // Sens inverse : mêmes règles, et même tracé parcouru à l'envers
          ...result.stages.flatMap((stage, i) => [
            ...checkStage(stage.reverse, { network, nodeByCoord, surface, length, result }).map(
              (p) => `tracé ${i + 1} (sens inverse) : ${p}`
            ),
            ...(Math.abs(stage.reverse.stats.lengthKm - stage.stats.lengthKm) > 0.05 ? [`tracé ${i + 1} : longueur différente en sens inverse`] : []),
          ]),
          ...checkAlternatives(result.stages),
        ];
        if (genMs > MAX_GENERATE_MS) problems.push(`génération lente (${genMs} ms)`);

        // Pas de répétition : une nouvelle génération qui évite les tracés vus doit proposer autre chose
        if (run === 1) {
          const seen = result.stages.map((s) => s.id);
          const next = generateStages(network, { surface, length, seed: seed + 7, avoid: seen });
          if (next.stages.length && !next.exhausted && seen.includes(next.stages[0].id)) problems.push("tracé déjà vu reproposé");
        }

        const [main] = result.stages;
        report.lengths.push(main.stats.lengthKm);
        report.twists.push(main.stats.twistDegPerKm);
        if (surface !== "asphalt") report.unpaved[surface].push(100 - main.stats.surfacePct.paved);
        for (const c of main.geometry.coordinates) {
          report.minCenterKm = Math.min(report.minCenterKm, haversineKm(c, [center.lon, center.lat]));
        }
        if (problems.length) report.problems.push(...problems.map((p) => `${tag} ${p}`));
        else report.ok++;
      }
    }
  }
  return report;
}

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const range = (a) => (a.length ? `${Math.min(...a)}–${Math.max(...a)}` : "—");

async function main() {
  const filter = process.argv.slice(2).map((s) => s.toLowerCase());
  const communes = COMMUNES.filter(([name]) => !filter.length || filter.includes(name.toLowerCase()));
  const reports = [];

  for (const [i, commune] of communes.entries()) {
    const report = await validateCommune(commune, COMMUNES.indexOf(commune));
    reports.push(report);
    const status = report.fatal
      ? `ÉCHEC ${report.fatal}`
      : `${report.ok}/${report.runs} OK, ${report.empty} sans résultat, ${report.expanded} avec zone élargie | ` +
        `${report.tooDense ? "zone trop dense | " : `${report.segments} tronçons, ${report.drivableKm} km roulables | `}` +
        `IGN ${report.fetchMs} ms | longueur ${range(report.lengths)} km | sinuosité moy. ${Math.round(avg(report.twists))}°/km | ` +
        `terre ${range(report.unpaved.gravel)} % (terre) ${range(report.unpaved.mixed)} % (mixte) | ` +
        `génération moy. ${Math.round(avg(report.genMs))} ms, max ${Math.max(0, ...report.genMs)} ms | ` +
        `au plus près du centre géographique de la commune ${report.minCenterKm === Infinity ? "—" : report.minCenterKm.toFixed(1) + " km"}`;
    console.log(`[${i + 1}/${communes.length}] ${report.name} (${report.profile}, ${report.radiusKm} km) : ${status}`);
    for (const p of report.problems) console.log(`    ✗ ${p}`);
  }

  const runs = reports.reduce((s, r) => s + r.runs, 0);
  const ok = reports.reduce((s, r) => s + r.ok, 0);
  const empty = reports.reduce((s, r) => s + r.empty, 0);
  const expanded = reports.reduce((s, r) => s + (r.expanded || 0), 0);
  const problems = reports.reduce((s, r) => s + r.problems.length, 0);
  const fatal = reports.filter((r) => r.fatal).length;
  console.log(`\nBilan : ${ok}/${runs} générations conformes, ${empty} sans résultat, ${expanded} avec zone élargie, ${problems} écarts, ${fatal} commune(s) en échec.`);
  process.exitCode = problems || fatal ? 1 : 0;
}

main();

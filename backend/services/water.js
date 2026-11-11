/**
 * Points de vigilance eau le long des spéciales : là où une voiture qui sort de la route peut finir dans une étendue
 * d'eau importante (lac, étang, rivière), donc où des plongeurs peuvent être nécessaires.
 *
 * Objectif : peu de points, mais tous défendables (sinon les organisateurs n'en tiendraient pas compte, et un
 * dispositif de plongeurs coûte cher). « Plongeurs recommandés » : au plus un endroit par spéciale, le plus exposé ;
 * « à surveiller » : simple information (grand plan d'eau ou grande rivière à 10 m au plus). Un pont seul n'est jamais
 * signalé : il a des parapets ; un virage qui jette vers l'eau à ses abords est détecté par les berges.
 *  - Seule l'eau importante est prise en compte, filtrée dès la requête IGN (BD TOPO hydrographie) :
 *    surfaces en eau permanentes (plans d'eau d'au moins 1 ha, rivières et canaux assez larges pour être dessinés
 *    en surface), cours d'eau permanents d'au moins 5 m de large ; jamais les fossés, mares, bassins d'orage,
 *    conduits enterrés ni cours d'eau intermittents.
 *  - L'eau doit être tout près de la route (15 m au plus de l'axe).
 *  - Le niveau dépend de l'exposition : eau à l'extérieur d'un virage, ou arrivée rapide.
 *
 * Mémoire : seule l'eau d'un rectangle serré autour de chaque spéciale est téléchargée (quelques dizaines d'objets),
 * gardée dans un petit cache ; les données routières ne sont pas touchées.
 */
const axios = require("axios");
const { TtlCache } = require("./cache");

const WFS_URL = "https://data.geopf.fr/wfs/ows";
const PAGE_SIZE = 5000;
const TIMEOUT_MS = 30000;
const RETRIES = 3;
const MARGIN_DEG = 0.002; // ~200 m autour du tracé

const STILL = ["Retenue", "Lac", "Réservoir-bassin", "Plan d'eau de gravière", "Retenue-barrage", "Retenue-digue", "Lagune", "Inconnue"];
const FLOWING = ["Ecoulement naturel", "Canal", "Ecoulement canalisé"];
const WIDE_CLASSES = ["Entre 5 et 15 m", "Entre 15 et 50 m", "Plus de 50 m"];
const VERY_WIDE_CLASSES = ["Entre 15 et 50 m", "Plus de 50 m"];
const MIN_STILL_HA = 1; // étangs, lacs, retenues : au moins 1 hectare

const NEAR_KM = 0.015; // eau à 15 m au plus de l'axe de la route
const EXPOSED_KM = 0.01; // extérieur de virage : eau à 10 m au plus
const FAST_KM = 0.006; // arrivée rapide : eau à 6 m au plus
const ON_ROAD_KM = 0.002; // la route passe au-dessus de l'eau : pont
const WATCH_KM = 0.01; // « à surveiller » : grande eau à 10 m au plus
const STEP_KM = 0.01; // échantillonnage du tracé
const BEND_DEG = 35; // virage franc sur ±50 m
const FAST_STRAIGHT_KM = 0.4; // ligne droite d'au moins 400 m avant
const MAX_DIVERS_PER_STAGE = 1; // plongeurs : seulement l'endroit le plus exposé de la spéciale (coût du dispositif)
const MERGE_KM = 0.15; // deux zones à moins de 150 m : un seul point

const waterCache = new TtlCache({ maxEntries: 40, ttlMs: 24 * 3600 * 1000 });
const quote = (xs) => xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(",");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function wfs(layer, filter, properties) {
  const features = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    let page;
    let lastError;
    for (let attempt = 0; attempt < RETRIES && !page; attempt++) {
      try {
        const res = await axios.get(WFS_URL, {
          params: {
            SERVICE: "WFS",
            VERSION: "2.0.0",
            REQUEST: "GetFeature",
            TYPENAMES: `BDTOPO_V3:${layer}`,
            OUTPUTFORMAT: "application/json",
            COUNT: PAGE_SIZE,
            STARTINDEX: start,
            SORTBY: "cleabs",
            PROPERTYNAME: properties,
            CQL_FILTER: filter,
          },
          timeout: TIMEOUT_MS,
        });
        if (!Array.isArray(res.data?.features)) throw new Error("Réponse WFS invalide");
        page = res.data.features;
      } catch (err) {
        lastError = err;
        await sleep(500 * (attempt + 1));
      }
    }
    if (!page) throw new Error(`Service IGN indisponible (hydrographie) : ${lastError?.message}`);
    features.push(...page);
    if (page.length < PAGE_SIZE) return features;
  }
}

/**
 * Eau importante dans un rectangle [sud, ouest, nord, est], filtrée côté IGN
 * @returns {Promise<{surfaces: object[], lines: object[]}>}
 */
async function fetchWater([s, w, n, e]) {
  const key = [s, w, n, e].map((v) => v.toFixed(3)).join("_");
  const { value } = await waterCache.getOrCompute(key, async () => {
    const bbox = `BBOX(geometrie,${s},${w},${n},${e})`;
    const [surfaces, lines] = await Promise.all([
      wfs(
        "surface_hydrographique",
        `${bbox} AND persistance='Permanent' AND nature IN (${quote([...STILL, ...FLOWING])})`,
        "geometrie,nature,cpx_toponyme_de_plan_d_eau,cpx_toponyme_de_cours_d_eau"
      ),
      wfs(
        "troncon_hydrographique",
        `${bbox} AND persistance='Permanent' AND fosse=false AND classe_de_largeur IN (${quote(WIDE_CLASSES)}) ` +
          `AND nature IN (${quote(FLOWING)}) AND position_par_rapport_au_sol='0'`,
        "geometrie,nature,classe_de_largeur,cpx_toponyme_de_cours_d_eau"
      ),
    ]);
    return { surfaces, lines };
  });
  return value;
}

// ---------- géométrie plane locale (km) ----------
const makeProjection = ([lon0, lat0]) => {
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  return {
    toXY: ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * 111.32],
    toLonLat: ([x, y]) => [Math.round((lon0 + x / kx) * 1e6) / 1e6, Math.round((lat0 + y / 111.32) * 1e6) / 1e6],
  };
};

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  const q = [a[0] + t * dx, a[1] + t * dy];
  return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), q };
}

function insideRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const ringArea = (r) => Math.abs(r.reduce((s, p, i) => s + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0) / 2);
const signedTurn = (a, b) => ((b - a + 540) % 360) - 180;

/** Eau en coordonnées planes, avec son type, son nom et sa largeur ; les petits plans d'eau sont écartés */
function prepareWater(water, projection) {
  const items = [];
  for (const f of water.surfaces) {
    const polygons = f.geometry.coordinates.map((poly) => poly.map((ring) => ring.map(projection.toXY)));
    const still = STILL.includes(f.properties.nature);
    if (still) {
      const areaHa = polygons.reduce((s, poly) => s + ringArea(poly[0]) - poly.slice(1).reduce((h, r) => h + ringArea(r), 0), 0) * 100;
      if (areaHa < MIN_STILL_HA) continue;
    }
    items.push({
      kind: still ? "plan d'eau" : f.properties.nature === "Canal" ? "canal" : "rivière",
      name: f.properties.cpx_toponyme_de_plan_d_eau || f.properties.cpx_toponyme_de_cours_d_eau || null,
      wide: true, // dessinée en surface : eau large
      polygons,
      rings: polygons.flat(),
    });
  }
  for (const f of water.lines) {
    items.push({
      kind: f.properties.nature === "Canal" ? "canal" : "rivière",
      name: f.properties.cpx_toponyme_de_cours_d_eau || null,
      wide: VERY_WIDE_CLASSES.includes(f.properties.classe_de_largeur),
      rings: [f.geometry.coordinates.map(projection.toXY)],
    });
  }
  for (const item of items) {
    const pts = item.rings.flat();
    item.box = [
      Math.min(...pts.map((p) => p[0])),
      Math.min(...pts.map((p) => p[1])),
      Math.max(...pts.map((p) => p[0])),
      Math.max(...pts.map((p) => p[1])),
    ];
  }
  return items;
}

/** Eau la plus proche d'un point (distance 0 si le point est sur une surface en eau) */
function nearestWater(p, items) {
  let best = null;
  for (const item of items) {
    const [x0, y0, x1, y1] = item.box;
    if (p[0] < x0 - NEAR_KM || p[0] > x1 + NEAR_KM || p[1] < y0 - NEAR_KM || p[1] > y1 + NEAR_KM) continue;
    if (item.polygons?.some((poly) => insideRing(p, poly[0]) && !poly.slice(1).some((hole) => insideRing(p, hole)))) {
      return { d: 0, q: p, item };
    }
    for (const ring of item.rings) {
      for (let i = 1; i < ring.length; i++) {
        const r = segmentDistance(p, ring[i - 1], ring[i]);
        if (!best || r.d < best.d) best = { ...r, item };
      }
    }
  }
  return best && best.d <= NEAR_KM ? best : null;
}

/** Tracé rééchantillonné tous les 10 m : { p (plan, km), km (cumulé) } */
function resampleTrack(coords, projection) {
  const pts = coords.map(projection.toXY);
  const samples = [];
  let km = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / STEP_KM));
    for (let k = 0; k < n; k++) samples.push({ p: [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], km: km + (len * k) / n });
    km += len;
  }
  samples.push({ p: pts.at(-1), km });
  return samples;
}

/**
 * Points de vigilance eau d'une spéciale (dans son sens de parcours)
 * @param {number[][]} coords - Tracé [lon, lat, (z)]
 * @param {{surfaces, lines}} water - Eau importante autour du tracé (voir fetchWater)
 * @returns {object[]} { level: "divers"|"watch", km, fromKm, toKm, coord, side, kind, name, distanceM, reasons }
 */
function waterPoints(coords, water) {
  if (coords.length < 2) return [];
  const projection = makeProjection(coords[0]);
  const items = prepareWater(water, projection);
  if (items.length === 0) return [];
  const S = resampleTrack(coords, projection);

  // Cap (degrés, 0 = nord) mesuré sur ±30 m
  const heading = (i) => {
    const a = S[Math.max(0, i - 3)].p;
    const b = S[Math.min(S.length - 1, i + 3)].p;
    return (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
  };
  // Virage sur ±50 m : + à droite, − à gauche
  const turnAt = (i) => signedTurn(heading(Math.max(0, i - 5)), heading(Math.min(S.length - 1, i + 5)));
  // Longueur de ligne droite juste avant (cap stable à 20° près)
  const straightBefore = (i) => {
    const end = Math.max(0, i - 6);
    const ref = heading(end);
    let j = end;
    while (j > 3 && Math.abs(signedTurn(ref, heading(j))) < 20) j--;
    return S[end].km - S[j].km;
  };

  // 1. Échantillons proches de l'eau
  const hits = [];
  for (let i = 0; i < S.length; i++) {
    const w = nearestWater(S[i].p, items);
    if (!w) continue;
    const h = (heading(i) * Math.PI) / 180;
    const cross = Math.sin(h) * (w.q[1] - S[i].p[1]) - Math.cos(h) * (w.q[0] - S[i].p[0]);
    const side = w.d <= ON_ROAD_KM ? 0 : cross < 0 ? 1 : -1; // 1 droite, -1 gauche, 0 : la route passe sur l'eau
    const turn = turnAt(i);
    const straight = straightBefore(i);
    hits.push({
      i,
      km: S[i].km,
      d: w.d,
      item: w.item,
      side,
      turn: Math.abs(turn),
      straight,
      outside: side !== 0 && Math.abs(turn) > BEND_DEG && Math.sign(turn) === -side,
      fast: side !== 0 && straight >= FAST_STRAIGHT_KM,
    });
  }

  // 2. Zones continues le long de la même eau
  const zones = [];
  for (const hit of hits) {
    const zone = zones.at(-1);
    if (zone && hit.km - zone.toKm <= 0.05 && zone.item === hit.item) {
      zone.toKm = hit.km;
      zone.hits.push(hit);
    } else zones.push({ fromKm: hit.km, toKm: hit.km, item: hit.item, hits: [hit] });
  }

  // 3. Niveau de chaque zone. Un pont seul ne suffit pas (parapets) : l'exposition vient de l'eau sur le côté.
  const points = [];
  for (const zone of zones) {
    const { hits: hs, item } = zone;
    const exposedHits = hs.filter((h) => (h.outside && h.d <= EXPOSED_KM) || (h.fast && h.d <= FAST_KM));
    // La route touche ou franchit l'eau : sans exposition, rien à signaler (un pont a des parapets)
    const onWater = hs.some((h) => h.side === 0);
    // « Pont » (texte) : la route franchit vraiment une rivière ou un canal (eau des deux côtés, ou au-dessus sur 20 m) ;
    // pour un plan d'eau, un contact avec le bord n'est que la berge
    const overWater = hs.filter((h) => h.side === 0).length;
    const bothSides = hs.some((h) => h.side > 0) && hs.some((h) => h.side < 0);
    const bridge = item.kind !== "plan d'eau" && (overWater >= 2 || (overWater >= 1 && bothSides));
    let level = null;
    if (exposedHits.length) level = "divers";
    // Pont seul (parapets) : jamais signalé ; un virage qui jette vers l'eau près du pont est vu par les berges
    else if (!onWater && hs.some((h) => h.d <= WATCH_KM)) level = item.kind === "plan d'eau" || item.wide ? "watch" : null; // rivière moyenne : rien
    if (!level) continue;

    const key = (exposedHits.length ? exposedHits : hs).reduce((a, b) => (b.d < a.d ? b : a));
    // Gravité : eau proche, virage franc, arrivée rapide (sert à ne garder que le pire endroit en « plongeurs »)
    const risk = exposedHits.length
      ? Math.max(...exposedHits.map((h) => (1 - h.d / EXPOSED_KM) + Math.min(h.turn, 120) / 120 + Math.min(h.straight, 1)))
      : 0;
    const reasons = [];
    if (hs.some((h) => h.outside && h.d <= EXPOSED_KM)) reasons.push("extérieur de virage");
    if (hs.some((h) => h.fast && h.d <= FAST_KM)) reasons.push("arrivée rapide");
    if (bridge) reasons.push("pont");
    points.push({
      level,
      risk,
      km: Math.round(key.km * 100) / 100,
      fromKm: Math.round(zone.fromKm * 100) / 100,
      toKm: Math.round(zone.toKm * 100) / 100,
      coord: projection.toLonLat(S[key.i].p),
      side: key.side === 0 ? "pont" : key.side > 0 ? "droite" : "gauche",
      kind: item.kind,
      name: item.name,
      distanceM: Math.round(key.d * 1000),
      reasons,
    });
  }

  // 4. Points proches (< 150 m) regroupés : on garde le plus grave
  const merged = [];
  for (const p of points) {
    const last = merged.at(-1);
    if (last && p.fromKm - last.toKm <= MERGE_KM) {
      const keep = last.level === p.level ? (last.risk >= p.risk ? last : p) : last.level === "divers" ? last : p;
      merged[merged.length - 1] = { ...keep, fromKm: last.fromKm, toKm: p.toKm, reasons: [...new Set([...last.reasons, ...p.reasons])] };
    } else merged.push(p);
  }
  // 5. Au plus MAX_DIVERS_PER_STAGE endroit(s) « plongeurs » : les plus exposés ; les autres restent « à surveiller »
  const ranked = merged.filter((p) => p.level === "divers").sort((a, b) => b.risk - a.risk);
  for (const p of ranked.slice(MAX_DIVERS_PER_STAGE)) p.level = "watch";
  return merged.map(({ risk, ...p }) => p);
}

/** Rectangle [sud, ouest, nord, est] autour d'un tracé, avec une marge */
function trackBox(coords) {
  const lons = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return [Math.min(...lats) - MARGIN_DEG, Math.min(...lons) - MARGIN_DEG, Math.max(...lats) + MARGIN_DEG, Math.max(...lons) + MARGIN_DEG];
}

module.exports = { fetchWater, waterPoints, trackBox, prepareWater };

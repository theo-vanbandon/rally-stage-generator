import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import MapView, { SURFACE_STYLES } from "../MapView";
import SpecialeStats from "../SpecialeStats";
import CommuneSearch from "../CommuneSearch";
import ElevationProfile from "../ElevationProfile";
import Roadbook from "../Roadbook";
import RoadbookPrint, { PRINT_FORMATS } from "../RoadbookPrint";
import LegalNotice from "../LegalNotice";
import StageTabs from "../StageTabs";
import LiaisonSummary, { LIAISON_COLOR } from "../LiaisonSummary";
import useLiaisons from "../../hooks/useLiaisons";
import { generateStage, pingBackend } from "../../services/api";
import { exportStages, exportFilename } from "../../services/exportService";
import { cumulativeDistances, pointAtKm } from "../../utils/geometry";
import "./RouteGenerator.css";

const SURFACES = [
  { value: "asphalt", label: "Asphalte" },
  { value: "gravel", label: "Terre" },
  { value: "mixed", label: "Mixte" },
];

const LENGTHS = [
  { value: "short", label: "Courte", hint: "5–9 km" },
  { value: "medium", label: "Moyenne", hint: "9–16 km" },
  { value: "long", label: "Longue", hint: "16–25 km" },
];

const LOOPS = [
  { value: "none", label: "Sans" },
  { value: "junction", label: "Carrefour", hint: "on recroise le tracé" },
  { value: "shared", label: "Portion", hint: "un tronçon fait 2 fois" },
];

const SLOW_HINT_MS = 2500;
const LEGAL_HASH = "#mentions-legales";
const MAX_SEEN = 60; // tracés déjà vus envoyés au serveur pour ne pas les reproposer

/** Clé des paramètres de génération : les tracés vus ne comptent que pour une même recherche */
const searchKey = ({ commune, radiusKm, surface, length, loop }) =>
  commune ? [commune.lat, commune.lon, radiusKm, surface, length, loop].join("|") : "";

// Boucle dans le lien partagé : b=1 carrefour, b=2 portion commune
const LOOP_URL = { junction: "1", shared: "2" };
const loopFromUrl = (b) => Object.keys(LOOP_URL).find((k) => LOOP_URL[k] === b) ?? "none";

/** Phrase d'explication de la boucle, sous les tracés proposés */
function loopNotice(loop) {
  // Point décimal : une virgule se confondrait avec celles de la phrase
  const fr = (x, digits) => x.toFixed(digits);
  if (loop.kind === "shared") {
    return (
      `Boucle de ${fr(loop.lengthKm, 1)} km avec une portion commune de ${fr(loop.sharedKm, 1)} km (surlignée en bleu), ` +
      `parcourue deux fois dans le même sens : du km ${fr(loop.sharedFromKm, 2)}, puis à nouveau après la boucle. ` +
      "Suivez les flèches pour le sens de parcours."
    );
  }
  return (
    `Boucle de ${fr(loop.lengthKm, 1)} km à partir du km ${fr(loop.fromKm, 2)} : on passe deux fois au carrefour ` +
    "entouré sur la carte. Suivez les flèches pour le sens de parcours."
  );
}

/** Paramètres partagés via l'URL (?lat=…&lon=…&seed=…) pour retrouver exactement une spéciale */
function readUrlParams() {
  const q = new URLSearchParams(window.location.search);
  const lat = Number.parseFloat(q.get("lat"));
  const lon = Number.parseFloat(q.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const seed = Number.parseInt(q.get("seed"), 10);
  return {
    commune: { name: q.get("name") || "Point", postal: q.get("cp") || "", lat, lon },
    radiusKm: Number.parseInt(q.get("r"), 10) || 10,
    surface: SURFACES.some((s) => s.value === q.get("s")) ? q.get("s") : "asphalt",
    length: LENGTHS.some((l) => l.value === q.get("l")) ? q.get("l") : "medium",
    loop: loopFromUrl(q.get("b")),
    seed: Number.isInteger(seed) ? seed : undefined,
    avoid: q.get("vu") ? q.get("vu").split(",").filter(Boolean) : [],
    trace: Math.max(0, (Number.parseInt(q.get("t"), 10) || 1) - 1),
    reversedTraces: readReversed(q.get("sens"), Math.max(0, (Number.parseInt(q.get("t"), 10) || 1) - 1)),
    order: q.get("o") ? q.get("o").split(",").map((n) => Number.parseInt(n, 10) - 1) : null,
  };
}

/** Ordre du rallye valide pour `count` tracés (permutation), sinon l'ordre des tracés */
function validOrder(order, count) {
  const identity = [...Array(count).keys()];
  if (!order || order.length !== count) return identity;
  return [...order].sort((a, b) => a - b).every((v, i) => v === i) ? order : identity;
}

/** Ordre du rallye dans le lien partagé : o=2,1,3 (omis si c'est l'ordre des tracés) */
function writeOrderParam(order) {
  const q = new URLSearchParams(window.location.search);
  if (order.some((v, i) => v !== i)) q.set("o", order.map((i) => i + 1).join(","));
  else q.delete("o");
  window.history.replaceState(null, "", `?${q}`);
}

/**
 * Tracés affichés en sens inverse, dans le lien : sens=1,3 (numéros des tracés). L'ancien « sens=inverse »
 * désignait le tracé affiché.
 */
function readReversed(value, trace) {
  if (!value) return [];
  if (value === "inverse") return [trace];
  return [...new Set(value.split(",").map((n) => Number.parseInt(n, 10) - 1))].filter((i) => i >= 0).sort((a, b) => a - b);
}

/** Tracé affiché et tracés en sens inverse, ajoutés au lien partagé */
function writeViewParams({ trace, reversedTraces }) {
  const q = new URLSearchParams(window.location.search);
  if (trace > 0) q.set("t", String(trace + 1));
  else q.delete("t");
  if (reversedTraces.length) q.set("sens", reversedTraces.map((i) => i + 1).join(","));
  else q.delete("sens");
  window.history.replaceState(null, "", `?${q}`);
}

function writeUrlParams({ commune, radiusKm, surface, length, loop, seed, avoid }) {
  const q = new URLSearchParams({
    name: commune.name,
    cp: commune.postal,
    lat: commune.lat.toFixed(5),
    lon: commune.lon.toFixed(5),
    r: String(radiusKm),
    s: surface,
    l: length,
    seed: String(seed),
  });
  if (LOOP_URL[loop]) q.set("b", LOOP_URL[loop]);
  // Tracés exclus lors de cette génération : nécessaires pour la reproduire à l'identique
  if (avoid.length) q.set("vu", avoid.join(","));
  window.history.replaceState(null, "", `?${q}`);
}

function SegmentedControl({ name, options, value, onChange }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <label key={o.value} className={value === o.value ? "checked" : ""}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <span>{o.label}</span>
          {o.hint && <small>{o.hint}</small>}
        </label>
      ))}
    </div>
  );
}

export default function RouteGenerator() {
  const initial = useMemo(readUrlParams, []);
  const [commune, setCommune] = useState(initial?.commune ?? null);
  const [radiusKm, setRadiusKm] = useState(initial?.radiusKm ?? 10);
  const [surface, setSurface] = useState(initial?.surface ?? "asphalt");
  const [length, setLength] = useState(initial?.length ?? "medium");
  const [loop, setLoop] = useState(initial?.loop ?? "none");

  const [result, setResult] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Sens de chaque tracé : indices des tracés affichés (et exportés, imprimés) en sens inverse
  const [reversedTraces, setReversedTraces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [hoverKm, setHoverKm] = useState(null);
  // Case du roadbook sélectionnée (clic dans le roadbook ou sur la carte) ; fly : la carte s'y rend
  const [focusedCase, setFocusedCase] = useState(null);
  const [copied, setCopied] = useState(false);
  const [esNumber, setEsNumber] = useState("1");
  const [esName, setEsName] = useState("");
  const [printFormat, setPrintFormat] = useState("a5");
  // Spéciales à exporter : null = le tracé affiché ; sinon les indices cochés
  const [exportPick, setExportPick] = useState(null);
  // Mentions légales : aussi accessibles directement par l'adresse …#mentions-legales
  const [legalOpen, setLegalOpen] = useState(() => window.location.hash === LEGAL_HASH);

  const showLegal = (open) => {
    setLegalOpen(open);
    const { pathname, search } = window.location;
    window.history.replaceState(null, "", `${pathname}${search}${open ? LEGAL_HASH : ""}`);
  };

  // Le format doit être appliqué (règle @page) avant d'ouvrir la fenêtre d'impression
  const printRoadbook = (format) => {
    flushSync(() => setPrintFormat(format));
    window.print();
  };
  const abortRef = useRef(null);
  // Lien partagé : tracé et sens à réafficher après la première génération
  const pendingView = useRef(
    initial ? { trace: initial.trace, reversedTraces: initial.reversedTraces, order: initial.order } : null
  );
  // Ordre du rallye : indices des tracés dans l'ordre des ES (ES1 = rallyOrder[0])
  const [rallyOrder, setRallyOrder] = useState([]);
  // Tracés déjà proposés pour la recherche en cours (réinitialisé si un paramètre change)
  const seenRef = useRef(initial ? { key: searchKey(initial), ids: initial.avoid } : { key: "", ids: [] });

  const stages = useMemo(() => (result ? [result.stage, ...result.alternatives] : []), [result]);
  // Chaque tracé garde son sens : à l'envers, il est remplacé par sa version inverse (calculée par le serveur,
  // avec son propre roadbook), pour l'affichage comme pour l'impression et les exports
  const displayedStages = useMemo(
    () => stages.map((s, i) => (reversedTraces.includes(i) && s.reverse ? s.reverse : s)),
    [stages, reversedTraces]
  );
  const stage = displayedStages[selectedIndex];
  const reversed = reversedTraces.includes(selectedIndex);

  // Liaisons : du point stop de chaque ES au départ de la suivante, dans l'ordre du rallye et le sens de chacune
  const orderedStages = useMemo(
    () => (rallyOrder.length === displayedStages.length ? rallyOrder.map((i) => displayedStages[i]) : []),
    [rallyOrder, displayedStages]
  );
  const liaisonState = useLiaisons(result?.center ?? null, result?.radiusKm ?? null, orderedStages);
  const mapLiaisons = useMemo(
    () =>
      liaisonState.liaisons
        .filter((l) => l.ok)
        .map((l) => ({ ...l, label: `Liaison ES${l.from + 1} → ES${l.to + 1}` })),
    [liaisonState]
  );
  const esNumbers = useMemo(() => {
    const numbers = [];
    rallyOrder.forEach((trace, position) => {
      numbers[trace] = position + 1;
    });
    return numbers;
  }, [rallyOrder]);
  const reorderStages = (order) => {
    setRallyOrder(order);
    writeOrderParam(order);
  };

  const showView = useCallback((trace, traces) => {
    setSelectedIndex(trace);
    setReversedTraces(traces);
    setHoverKm(null);
    setFocusedCase(null);
    writeViewParams({ trace, reversedTraces: traces });
  }, []);
  const toggleReversed = () =>
    showView(
      selectedIndex,
      reversed ? reversedTraces.filter((i) => i !== selectedIndex) : [...reversedTraces, selectedIndex].sort((a, b) => a - b)
    );

  const cumulative = useMemo(() => (stage ? cumulativeDistances(stage.geometry.coordinates) : []), [stage]);
  const hoverPoint = stage && hoverKm !== null ? pointAtKm(stage.geometry.coordinates, cumulative, hoverKm) : null;

  // Réveille le backend (hébergement gratuit mis en veille) dès l'ouverture de la page
  useEffect(() => {
    pingBackend();
  }, []);

  const generate = useCallback(
    async (seed) => {
      if (!commune) {
        setErrorMsg("Choisis une commune dans la liste.");
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setErrorMsg("");
      setLoading(true);
      setSlow(false);
      const slowTimer = setTimeout(() => setSlow(true), SLOW_HINT_MS);

      const key = searchKey({ commune, radiusKm, surface, length, loop });
      const avoid = seenRef.current.key === key ? seenRef.current.ids : [];

      try {
        const data = await generateStage(
          { place: commune.name, postal: commune.postal, lat: commune.lat, lon: commune.lon, radiusKm, surface, length, loop: loop === "none" ? false : loop, seed, avoid },
          { signal: controller.signal }
        );
        const shownIds = [data.stage, ...data.alternatives].map((s) => s.id);
        // Zone élargie par le serveur : le curseur suit, et les tracés vus valent pour cette nouvelle zone
        const usedKey = searchKey({ commune, radiusKm: data.radiusKm, surface, length, loop });
        const previous = usedKey === key ? avoid : [];
        seenRef.current = { key: usedKey, ids: [...previous.filter((id) => !shownIds.includes(id)), ...shownIds].slice(-MAX_SEEN) };
        if (data.radiusKm !== radiusKm) setRadiusKm(data.radiusKm);
        setResult(data);
        setExportPick(null);
        writeUrlParams({ commune, radiusKm: data.radiusKm, surface, length, loop, seed: data.seed, avoid: previous });
        // Nouvelle génération : premier tracé, tous dans le sens d'origine (sauf lien partagé)
        const view = pendingView.current ?? { trace: 0, reversedTraces: [], order: null };
        pendingView.current = null;
        const count = data.alternatives.length + 1;
        showView(Math.min(view.trace, count - 1), view.reversedTraces.filter((i) => i < count));
        const order = validOrder(view.order, count);
        setRallyOrder(order);
        writeOrderParam(order);
      } catch (err) {
        if (err.name !== "AbortError") setErrorMsg(err.message || "Erreur inconnue");
      } finally {
        clearTimeout(slowTimer);
        if (abortRef.current === controller) setLoading(false);
      }
    },
    [commune, radiusKm, surface, length, loop, showView]
  );

  // Lien partagé : on régénère la spéciale à l'identique au chargement
  const autoRun = useRef(Boolean(initial));
  useEffect(() => {
    if (autoRun.current) {
      autoRun.current = false;
      generate(initial.seed);
    }
  }, [generate, initial]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErrorMsg("Copie impossible : copie l'adresse de la page manuellement.");
    }
  };

  const picked = (exportPick ?? [selectedIndex]).filter((i) => i < stages.length);
  const togglePick = (i) => {
    const base = exportPick ?? [selectedIndex];
    setExportPick((base.includes(i) ? base.filter((x) => x !== i) : [...base, i]).sort((a, b) => a - b));
  };
  // Chaque spéciale est exportée dans le sens affiché
  const exportItems = picked.map((i) => ({
    stage: displayedStages[i],
    label: `Tracé ${i + 1}`,
    tag: `T${i + 1}`,
    reversed: reversedTraces.includes(i),
  }));
  const runExport = (format) =>
    exportStages(
      format,
      exportItems,
      { title: [commune?.name, ...exportItems.map((it) => it.label)].filter(Boolean).join(" — "), placeName: commune?.name },
      exportFilename(exportItems, commune?.name, format)
    );

  return (
    <>
      <div className="app-layout">
        <aside className="panel">
          <header className="panel-header">
            <h1>
              <span className="brand-mark" aria-hidden="true" />
              Générateur de spéciales
            </h1>
            <p>Des tracés de rallye sur les petites routes hors agglomération.</p>
          </header>

          <form
            className="generator-form"
            onSubmit={(e) => {
              e.preventDefault();
              generate();
            }}
          >
            <div className="field">
              <label htmlFor="commune">Commune</label>
              <CommuneSearch value={commune} onSelect={setCommune} />
            </div>

            <div className="field">
              <label htmlFor="radiusKm">
                Zone de recherche <output>{radiusKm} km</output>
              </label>
              <input
                id="radiusKm"
                type="range"
                min={5}
                max={20}
                step={1}
                value={radiusKm}
                onChange={(e) => setRadiusKm(Number(e.target.value))}
              />
            </div>

            <div className="field">
              <span className="field-label">Revêtement</span>
              <SegmentedControl name="Revêtement" options={SURFACES} value={surface} onChange={setSurface} />
            </div>

            <div className="field">
              <span className="field-label">Longueur</span>
              <SegmentedControl name="Longueur" options={LENGTHS} value={length} onChange={setLength} />
            </div>

            <div className="field">
              <span className="field-label">Boucle</span>
              <SegmentedControl
                name="Boucle"
                options={LOOPS}
                value={loop}
                onChange={setLoop}
              />
            </div>

            <button type="submit" className="primary" disabled={loading || !commune}>
              {loading ? "Génération…" : result ? "Nouvelle spéciale" : "Générer la spéciale"}
            </button>
          </form>

          {errorMsg && (
            <p className="error-message" role="alert">
              {errorMsg}
            </p>
          )}

          {stage && (
            <section className="results" aria-live="polite">
              {stages.length > 1 && rallyOrder.length === stages.length && (
                <StageTabs
                  stages={displayedStages}
                  order={rallyOrder}
                  selectedIndex={selectedIndex}
                  reversedTraces={reversedTraces}
                  onSelect={(i) => showView(i, reversedTraces)}
                  onReorder={reorderStages}
                />
              )}

              <button
                type="button"
                className={`reverse-toggle${reversed ? " active" : ""}`}
                aria-pressed={reversed}
                onClick={toggleReversed}
              >
                <span aria-hidden="true">⇄</span> {reversed ? "Sens inverse affiché — revenir au sens d'origine" : "Inverser le sens"}
              </button>

              {stages.length > 1 && <LiaisonSummary count={stages.length} liaisons={liaisonState} />}

              {result.expandedFrom && (
              <p className="notice">
                Aucune spéciale possible dans {result.expandedFrom} km : zone de recherche élargie à {result.radiusKm} km.
              </p>
            )}

            {result.surfaceRelaxed && (
                <p className="notice">
                  Peu de pistes reliées entre elles ici : la spéciale ne compte que{" "}
                  {100 - stage.stats.surfacePct.paved} % de terre. Agrandis la zone pour en trouver davantage.
                </p>
              )}

              {result.relaxed && (
                <p className="notice">Réseau rural limité ici : la spéciale est plus courte que demandé.</p>
              )}

              {stage.stats.loop && (
                <p className="notice loop-notice">
                  <span aria-hidden="true">↻</span> {loopNotice(stage.stats.loop)}
                </p>
              )}

              {result.exhausted && (
                <p className="notice">
                  Plus de spéciale vraiment différente dans cette zone : les variantes déjà vues sont reproposées.
                  Agrandis la zone de recherche ou choisis une longueur plus courte pour en découvrir d'autres.
                </p>
              )}

              {stage.roads.length > 0 && <p className="roads">Via {stage.roads.slice(0, 5).join(", ")}</p>}

              <SpecialeStats stats={stage.stats} />

              {stage.stats.elevation && (
                <div className="block">
                  <h2>Profil</h2>
                  <ElevationProfile profile={stage.stats.elevation.profile} hoverKm={hoverKm} onHover={setHoverKm} />
                </div>
              )}

              <div className="block">
                <h2>Roadbook</h2>
                <div className="es-fields">
                  <label>
                    ES n°
                    <input type="text" inputMode="numeric" value={esNumber} onChange={(e) => setEsNumber(e.target.value)} />
                  </label>
                  <label>
                    Nom de l'épreuve
                    <input
                      type="text"
                      value={esName}
                      placeholder={commune?.name ?? "Spéciale"}
                      onChange={(e) => setEsName(e.target.value)}
                    />
                  </label>
                </div>
                <Roadbook
                  roadbook={stage.roadbook}
                  selectedN={focusedCase?.n ?? null}
                  onSelect={(c) => setFocusedCase({ ...c, fly: true })}
                />
                <div className="print-actions">
                  <span>Imprimer le roadbook (ou PDF) :</span>
                  {Object.entries(PRINT_FORMATS).map(([format, { label }]) => (
                    <button key={format} type="button" className="print-button" onClick={() => printRoadbook(format)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="block">
                <h2>Exporter</h2>
                {stages.length > 1 && (
                  <fieldset className="export-picks">
                    <legend>Spéciales à exporter</legend>
                    {stages.map((s, i) => (
                      <label key={s.id} className={picked.includes(i) ? "checked" : ""}>
                        <input type="checkbox" checked={picked.includes(i)} onChange={() => togglePick(i)} />
                        <span>Tracé {i + 1}</span>
                        <small>
                          {displayedStages[i].stats.lengthKm.toFixed(1)} km
                          {reversedTraces.includes(i) ? " · inverse" : ""}
                        </small>
                      </label>
                    ))}
                  </fieldset>
                )}
                <p className="export-hint">
                  Waypoints : départ, arrivée, point stop et carrefours de boucle.
                  {picked.length > 1 && " En GPX, un fichier par spéciale (archive .zip), lu correctement par tous les GPS et applis."}
                </p>
                <div className="export-buttons">
                  {[
                    ["gpx", "GPX"],
                    ["kml", "KML"],
                    ["geojson", "GeoJSON"],
                  ].map(([format, label]) => (
                    <button key={format} type="button" disabled={picked.length === 0} onClick={() => runExport(format)}>
                      {label}
                    </button>
                  ))}
                  <button type="button" onClick={copyLink}>{copied ? "Lien copié ✓" : "Copier le lien"}</button>
                </div>
              </div>

              <p className="meta">
                Généré en {(result.meta.timings.totalMs / 1000).toFixed(1)} s
                {result.meta.dataSource === "fresh" ? " (réseau téléchargé)" : " (réseau en cache)"} ·{" "}
                {result.meta.candidates} tracés évalués
              </p>
            </section>
          )}

          <footer className="panel-footer">
            Données routières et altitudes : IGN BD TOPO® (Licence Ouverte). Tracés indicatifs : une spéciale réelle
            nécessite l'accord des communes et de la préfecture.
            <button type="button" className="legal-link" onClick={() => showLegal(true)}>
              Mentions légales
            </button>
          </footer>
        </aside>

        <main className="map-pane">
          <MapView
            stages={displayedStages}
            selectedIndex={selectedIndex}
            onSelect={(i) => showView(i, reversedTraces)}
            liaisons={mapLiaisons}
            esNumbers={esNumbers}
            searchArea={commune ? { lat: commune.lat, lon: commune.lon, radiusKm } : null}
            hoverPoint={hoverPoint}
            focusedCase={focusedCase}
            onSelectCase={(c) => setFocusedCase({ ...c, fly: false })}
          />
          {stage && (stage.stats.surfacePct.paved < 100 || mapLiaisons.length > 0) && (
            <ul className="surface-legend" aria-label="Légende de la carte">
              {stage.stats.surfacePct.paved < 100 &&
                [
                  ["paved", "Asphalte"],
                  ["gravel", "Route empierrée"],
                  ["dirt", "Chemin de terre"],
                ].map(([key, label]) => (
                  <li key={key}>
                    <span className={`legend-${key}`} style={{ color: SURFACE_STYLES[key].color }} aria-hidden="true" />
                    {label}
                  </li>
                ))}
              {mapLiaisons.length > 0 && (
                <li>
                  <span style={{ color: LIAISON_COLOR }} aria-hidden="true" />
                  Liaison
                </li>
              )}
            </ul>
          )}
          {loading && (
            <div className="map-overlay" role="status">
              <div className="loader" />
              <p>{slow ? "Téléchargement du réseau routier IGN de la zone (uniquement la première fois)…" : "Recherche de la meilleure spéciale…"}</p>
            </div>
          )}
        </main>
        {legalOpen && <LegalNotice onClose={() => showLegal(false)} />}
      </div>
      <RoadbookPrint
        stage={stage}
        esNumber={esNumber || "1"}
        esName={esName || commune?.name}
        reversed={reversed}
        format={printFormat}
      />
    </>
  );
}

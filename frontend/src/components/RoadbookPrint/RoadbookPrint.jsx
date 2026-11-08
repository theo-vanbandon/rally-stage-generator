import React from "react";
import PropTypes from "prop-types";
import { CaseSymbol, caseShape, dangerMark } from "../Roadbook";
import "./RoadbookPrint.css";

function surfaceSummary({ paved, gravel, dirt }) {
  const unpaved = gravel + dirt;
  if (!unpaved) return "Asphalte";
  if (!paved) return "Terre";
  return `Mixte (${unpaved} % terre)`;
}

// Format de page : la règle @page ne peut pas dépendre d'une classe, elle est donc injectée selon le format choisi
export const PRINT_FORMATS = {
  a5: { label: "A5", page: "A5 portrait", margin: "8mm", tulip: 72 },
  a4: { label: "A4", page: "A4 portrait", margin: "12mm", tulip: 104 },
};

/**
 * Roadbook imprimable (A5 ou A4), mise en page d'organisateur. Invisible à l'écran, seul visible à l'impression.
 */
export default function RoadbookPrint({ stage, esNumber, esName, reversed = false, format = "a5" }) {
  if (!stage) return null;
  const { stats } = stage;
  const layout = PRINT_FORMATS[format] ?? PRINT_FORMATS.a5;

  return (
    <div className={`roadbook-print format-${format}`}>
      <style>{`@page { size: ${layout.page}; margin: ${layout.margin}; }`}</style>
      <header className="rbp-header">
        <div className="rbp-es">ES {esNumber}</div>
        <div>
          <h1>
            {esName || "Spéciale"}
            {reversed && <span className="rbp-reverse"> — sens inverse</span>}
          </h1>
          <p>
            {stats.lengthKm.toFixed(2)} km · {surfaceSummary(stats.surfacePct)}
            {stats.elevation ? ` · D+ ${stats.elevation.gain} m` : ""} · {stats.junctions} carrefours
            {stats.loop?.kind === "shared"
              ? ` · boucle de ${stats.loop.lengthKm.toFixed(2)} km, portion commune de ${stats.loop.sharedKm.toFixed(2)} km parcourue 2 fois (km ${stats.loop.sharedFromKm.toFixed(2)})`
              : stats.loop
                ? ` · boucle de ${stats.loop.lengthKm.toFixed(2)} km (km ${stats.loop.fromKm.toFixed(2)})`
                : ""}
          </p>
        </div>
      </header>

      <table className="rbp-table">
        <thead>
          <tr>
            <th>Case</th>
            <th>Total</th>
            <th>Partiel</th>
            <th>Tulipe</th>
            <th>Observations</th>
          </tr>
        </thead>
        <tbody>
          {stage.roadbook.map((c) => (
            <tr key={c.n} className={`rbp-${c.type}`}>
              <td className="rbp-n">{c.n}</td>
              <td className="rbp-km">{c.km.toFixed(2)}</td>
              <td className="rbp-partial">{c.n > 1 ? c.partial.toFixed(2) : ""}</td>
              <td className="rbp-tulip">
                <CaseSymbol roadbookCase={c} size={layout.tulip} />
              </td>
              <td className="rbp-info">
                {c.danger > 0 && <span className="rbp-danger">{dangerMark(c.danger)}</span>}
                <strong>{c.type === "junction" ? c.road || "" : c.direction}</strong>
                {c.type !== "junction" && c.road && <span>{c.road}</span>}
                {c.notes.map((note) => (
                  <span key={note}>{note}</span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="rbp-footer">
        Tracé indicatif généré automatiquement (données IGN BD TOPO®). À reconnaître sur place et à valider avec les
        communes et la préfecture.
      </footer>
    </div>
  );
}

RoadbookPrint.propTypes = {
  stage: PropTypes.shape({
    roadbook: PropTypes.arrayOf(caseShape).isRequired,
    stats: PropTypes.object.isRequired,
  }),
  esNumber: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  esName: PropTypes.string,
  reversed: PropTypes.bool,
  format: PropTypes.oneOf(Object.keys(PRINT_FORMATS)),
};

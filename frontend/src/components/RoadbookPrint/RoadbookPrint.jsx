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

/**
 * Roadbook imprimable (A5), mise en page d'organisateur. Invisible à l'écran, seul visible à l'impression.
 */
export default function RoadbookPrint({ stage, esNumber, esName }) {
  if (!stage) return null;
  const { stats } = stage;

  return (
    <div className="roadbook-print">
      <header className="rbp-header">
        <div className="rbp-es">ES {esNumber}</div>
        <div>
          <h1>{esName || "Spéciale"}</h1>
          <p>
            {stats.lengthKm.toFixed(2)} km · {surfaceSummary(stats.surfacePct)}
            {stats.elevation ? ` · D+ ${stats.elevation.gain} m` : ""} · {stats.junctions} carrefours
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
                <CaseSymbol roadbookCase={c} size={72} />
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
};

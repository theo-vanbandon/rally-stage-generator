import React from "react";
import PropTypes from "prop-types";
import CaseSymbol from "./CaseSymbol";
import "./Roadbook.css";

export const caseShape = PropTypes.shape({
  n: PropTypes.number.isRequired,
  type: PropTypes.oneOf(["start", "junction", "surface", "finish", "stop"]).isRequired,
  km: PropTypes.number.isRequired,
  partial: PropTypes.number.isRequired,
  coord: PropTypes.arrayOf(PropTypes.number).isRequired,
  direction: PropTypes.string.isRequired,
  angle: PropTypes.number.isRequired,
  road: PropTypes.string,
  notes: PropTypes.arrayOf(PropTypes.string).isRequired,
  danger: PropTypes.number.isRequired,
  tulip: PropTypes.object,
});

/** "!" ou "!!" selon le niveau de danger */
export const dangerMark = (level) => (level > 0 ? "!".repeat(level) : "");

/**
 * Roadbook d'organisation : une case par point utile (n°, kilométrage total et partiel, tulipe, observations)
 */
export default function Roadbook({ roadbook, onSelect = () => {} }) {
  return (
    <ol className="roadbook" aria-label="Roadbook">
      <li className="roadbook-head" aria-hidden="true">
        <span>Case</span>
        <span>Km</span>
        <span>Tulipe</span>
        <span>Observations</span>
      </li>
      {roadbook.map((c) => (
        <li key={c.n}>
          <button type="button" className={`roadbook-row case-${c.type}`} onClick={() => onSelect(c)}>
            <span className="roadbook-n">{c.n}</span>
            <span className="roadbook-km">
              <strong>{c.km.toFixed(2)}</strong>
              {c.n > 1 && <small>+{c.partial.toFixed(2)}</small>}
            </span>
            <CaseSymbol roadbookCase={c} size={52} />
            <span className="roadbook-info">
              <span className="roadbook-direction">
                {c.danger > 0 && <span className="roadbook-danger">{dangerMark(c.danger)} </span>}
                {c.direction}
              </span>
              {c.road && <span className="roadbook-road">{c.road}</span>}
              {c.notes.map((note) => (
                <span key={note} className="roadbook-note">
                  {note}
                </span>
              ))}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

Roadbook.propTypes = {
  roadbook: PropTypes.arrayOf(caseShape).isRequired,
  onSelect: PropTypes.func,
};

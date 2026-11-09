import React, { useEffect, useRef } from "react";
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
export default function Roadbook({ roadbook, selectedN = null, onSelect = () => {} }) {
  // Case choisie sur la carte : on la fait défiler jusqu'à elle dans la liste
  const listRef = useRef(null);
  useEffect(() => {
    if (selectedN === null) return;
    listRef.current?.querySelector(`[data-case="${selectedN}"]`)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [selectedN]);

  return (
    <ol className="roadbook" aria-label="Roadbook" ref={listRef}>
      <li className="roadbook-head" aria-hidden="true">
        <span>Case</span>
        <span>Km</span>
        <span>Tulipe</span>
        <span>Observations</span>
      </li>
      {roadbook.map((c) => (
        <li key={c.n} data-case={c.n}>
          <button
            type="button"
            className={`roadbook-row case-${c.type}${c.n === selectedN ? " selected" : ""}`}
            aria-current={c.n === selectedN ? "true" : undefined}
            onClick={() => onSelect(c)}
          >
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
  selectedN: PropTypes.number,
  onSelect: PropTypes.func,
};

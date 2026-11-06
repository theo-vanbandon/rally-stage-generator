import React from "react";
import PropTypes from "prop-types";
import Tulip from "../Tulip";

/** Panneau STOP du point stop */
function StopSign({ size }) {
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = ((i * 45 + 22.5) * Math.PI) / 180;
    return `${50 + 40 * Math.cos(a)},${50 + 40 * Math.sin(a)}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-hidden="true" className="case-sign">
      <polygon points={pts} fill="#c62828" stroke="#fff" strokeWidth="4" />
      <text x="50" y="59" textAnchor="middle" fontSize="25" fontWeight="800" fill="#fff" fontFamily="Arial, sans-serif">
        STOP
      </text>
    </svg>
  );
}

StopSign.propTypes = { size: PropTypes.number.isRequired };

/**
 * Colonne "tulipe" d'une case : tulipe du carrefour, ou symbole (stop, changement de revêtement)
 */
export default function CaseSymbol({ roadbookCase, size = 56 }) {
  if (roadbookCase.type === "stop") return <StopSign size={size} />;
  if (roadbookCase.tulip) return <Tulip tulip={roadbookCase.tulip} size={size} />;
  if (roadbookCase.type === "surface") {
    const toPaved = roadbookCase.direction.startsWith("Retour");
    return (
      <span className="case-surface" style={{ width: size }}>
        {toPaved ? "ASPH." : "TERRE"}
      </span>
    );
  }
  return <span className="case-flag" style={{ width: size, height: size * 0.6 }} aria-hidden="true" />;
}

CaseSymbol.propTypes = {
  roadbookCase: PropTypes.shape({
    type: PropTypes.string.isRequired,
    direction: PropTypes.string.isRequired,
    tulip: PropTypes.object,
  }).isRequired,
  size: PropTypes.number,
};

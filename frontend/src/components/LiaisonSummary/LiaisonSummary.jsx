import React from "react";
import PropTypes from "prop-types";
import "./LiaisonSummary.css";

export const LIAISON_COLOR = "#8e24aa";

/**
 * Liaisons entre les ES, dans l'ordre du rallye : du point stop d'une spéciale au départ de la suivante
 */
export default function LiaisonSummary({ count, liaisons }) {
  const { status } = liaisons;
  const rows = [...Array(Math.max(0, count - 1)).keys()].map((from) => liaisons.liaisons.find((l) => l.from === from));
  const done = status === "done" && rows.every((l) => l?.ok);
  const total = done ? rows.reduce((sum, l) => ({ km: sum.km + l.km, minutes: sum.minutes + l.minutes }), { km: 0, minutes: 0 }) : null;

  return (
    <div className="liaison-summary" aria-live="polite">
      <ul>
        {rows.map((l, from) => (
          <li key={from} className={status === "done" && !l?.ok ? "failed" : ""}>
            <span className="liaison-swatch" style={{ background: LIAISON_COLOR }} aria-hidden="true" />
            <strong>
              ES{from + 1} → ES{from + 2}
            </strong>
            {status === "loading" && <span>calcul…</span>}
            {status === "error" && <span>liaison non calculée</span>}
            {status === "done" && l?.ok && (
              <span>
                {l.km.toFixed(1)} km · ≈ {l.minutes} min
                {l.expandedKm ? <small> (passe hors de la zone)</small> : null}
              </span>
            )}
            {status === "done" && l?.ok && l.warnings?.length > 0 && (
              <span className="liaison-warning">
                <span aria-hidden="true">⚠ </span>
                {l.warnings.join(" · ")}
              </span>
            )}
            {status === "done" && !l?.ok && <span>aucune route trouvée entre ces deux spéciales : change l&apos;ordre ou le sens</span>}
          </li>
        ))}
      </ul>
      {total && rows.length > 1 && (
        <p>
          Total des liaisons : {total.km.toFixed(1)} km · ≈ {total.minutes} min
        </p>
      )}
    </div>
  );
}

LiaisonSummary.propTypes = {
  count: PropTypes.number.isRequired,
  liaisons: PropTypes.shape({
    status: PropTypes.string.isRequired,
    liaisons: PropTypes.arrayOf(PropTypes.object).isRequired,
  }).isRequired,
};

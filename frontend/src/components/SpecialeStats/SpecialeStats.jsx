import React from "react";
import PropTypes from "prop-types";
import "./SpecialeStats.css";

/** Qualificatif de la sinuosité (degrés de virage cumulés par km) */
export function twistLabel(degPerKm) {
  if (degPerKm >= 650) return "Très sinueuse";
  if (degPerKm >= 450) return "Sinueuse";
  if (degPerKm >= 280) return "Roulante";
  return "Rapide";
}

// Pictogrammes du revêtement : une route vue en perspective, lisse (asphalte), gravillonnée (terre),
// à deux ornières (chemin), ou moitié asphalte moitié terre (mixte)
const ROAD = "M9.2 3h5.6l5.7 18H3.5z";
const STONES = [
  [10.6, 6.5, 0.9],
  [13.1, 9.2, 1],
  [9.8, 12.2, 1.1],
  [14, 14.6, 1.2],
  [9.2, 17.6, 1.3],
  [13.4, 18.9, 1],
];

function SurfaceIcon({ kind }) {
  return (
    <svg className={`surface-icon surface-icon--${kind}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {kind === "paved" && (
        <>
          <path d={ROAD} fill="var(--surface-paved)" />
          <path d="M12 5v2.6M12 10.4v3M12 16.4v3.4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
      {kind === "gravel" && (
        <>
          <path d={ROAD} fill="var(--surface-gravel)" />
          {STONES.map(([cx, cy, r]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="#fff" opacity="0.85" />
          ))}
        </>
      )}
      {kind === "dirt" && (
        <>
          <path d={ROAD} fill="var(--surface-gravel)" opacity="0.28" />
          <path
            d="M10.4 3 7.3 21M13.6 3l3.1 18"
            stroke="var(--surface-gravel)"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "mixed" && (
        <>
          <path d="M9.2 3H12v18H3.5z" fill="var(--surface-paved)" />
          <path d="M12 3h2.8l5.7 18H12z" fill="var(--surface-gravel)" />
          {STONES.filter(([cx]) => cx > 12).map(([cx, cy, r]) => (
            <circle key={`${cx}-${cy}`} cx={cx + 0.6} cy={cy} r={r} fill="#fff" opacity="0.85" />
          ))}
        </>
      )}
    </svg>
  );
}

SurfaceIcon.propTypes = { kind: PropTypes.oneOf(["paved", "gravel", "dirt", "mixed"]).isRequired };

const SURFACES = [
  { key: "paved", label: "asphalte" },
  { key: "gravel", label: "terre" },
  { key: "dirt", label: "chemin" },
];

/** Répartition du revêtement : « Mixte » si plusieurs types, barre proportionnelle et pourcentages avec leur pictogramme */
function SurfaceBreakdown({ surfacePct }) {
  const parts = SURFACES.filter(({ key }) => surfacePct[key] > 0);
  if (!parts.length) return null;
  const mixed = parts.length > 1;

  return (
    <section className="surface-breakdown" aria-label="Revêtement">
      <header>
        <span className="surface-breakdown-title">Revêtement</span>
        {mixed && (
          <span className="surface-breakdown-kind">
            <SurfaceIcon kind="mixed" />
            Mixte
          </span>
        )}
      </header>
      {mixed && (
        <div className="surface-bar" aria-hidden="true">
          {parts.map(({ key }) => (
            <span key={key} className={`surface-bar--${key}`} style={{ flexGrow: surfacePct[key] }} />
          ))}
        </div>
      )}
      <ul>
        {parts.map(({ key, label }) => (
          <li key={key}>
            <SurfaceIcon kind={key} />
            <span className="surface-share">
              <strong>{surfacePct[key]} %</strong>
              <span>{label}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

SurfaceBreakdown.propTypes = {
  surfacePct: PropTypes.shape({ paved: PropTypes.number, gravel: PropTypes.number, dirt: PropTypes.number }).isRequired,
};

function Stat({ label, value, hint = null }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>
        {value}
        {hint && <small>{hint}</small>}
      </dd>
    </div>
  );
}

Stat.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node.isRequired,
  hint: PropTypes.node,
};

export default function SpecialeStats({ stats }) {
  if (!stats) return null;
  const { elevation } = stats;

  return (
    <div className="speciale-stats-group">
      <dl className="speciale-stats">
        <Stat label="Longueur" value={`${stats.lengthKm.toFixed(2)} km`} />
        <Stat label="Profil" value={twistLabel(stats.twistDegPerKm)} hint={`${stats.twistDegPerKm}°/km`} />
        <Stat
          label="Lignes droites"
          value={`${stats.straightSharePct} %`}
          hint={`max ${Math.round(stats.longestStraightKm * 1000)} m`}
        />
        <Stat label="Carrefours" value={stats.junctions} />
        {stats.loop && (
          <Stat
            label="Boucle"
            value={`${stats.loop.lengthKm.toFixed(1)} km`}
            hint={
              stats.loop.kind === "shared"
                ? `+ portion commune ${stats.loop.sharedKm.toFixed(1)} km × 2`
                : `dès le km ${stats.loop.fromKm.toFixed(1)}`
            }
          />
        )}
        {elevation && (
          <>
            <Stat label="Dénivelé" value={`+${elevation.gain} / −${elevation.loss} m`} />
            <Stat label="Altitude" value={`${elevation.min} → ${elevation.max} m`} />
            <Stat label="Pente max" value={`${elevation.maxSlopePct} %`} hint="sur 200 m" />
          </>
        )}
        {stats.urbanPct > 0 && <Stat label="Traversée de hameau" value={`${stats.urbanPct} %`} />}
      </dl>
      <SurfaceBreakdown surfacePct={stats.surfacePct} />
    </div>
  );
}

SpecialeStats.propTypes = {
  stats: PropTypes.shape({
    lengthKm: PropTypes.number.isRequired,
    twistDegPerKm: PropTypes.number.isRequired,
    straightSharePct: PropTypes.number.isRequired,
    longestStraightKm: PropTypes.number.isRequired,
    junctions: PropTypes.number.isRequired,
    urbanPct: PropTypes.number,
    loop: PropTypes.shape({
      kind: PropTypes.oneOf(["junction", "shared"]),
      sharedFromKm: PropTypes.number,
      sharedKm: PropTypes.number,
      fromKm: PropTypes.number,
      lengthKm: PropTypes.number,
      coord: PropTypes.arrayOf(PropTypes.number),
    }),
    surfacePct: PropTypes.shape({
      paved: PropTypes.number,
      gravel: PropTypes.number,
      dirt: PropTypes.number,
    }).isRequired,
    elevation: PropTypes.shape({
      min: PropTypes.number,
      max: PropTypes.number,
      gain: PropTypes.number,
      loss: PropTypes.number,
      maxSlopePct: PropTypes.number,
    }),
  }),
};

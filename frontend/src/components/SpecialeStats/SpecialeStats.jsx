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

function surfaceLabel({ paved, gravel, dirt }) {
  const parts = [];
  if (paved) parts.push(`${paved} % asphalte`);
  if (gravel) parts.push(`${gravel} % terre`);
  if (dirt) parts.push(`${dirt} % chemin`);
  return parts.join(" · ") || "—";
}

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
    <dl className="speciale-stats">
      <Stat label="Longueur" value={`${stats.lengthKm.toFixed(2)} km`} />
      <Stat label="Profil" value={twistLabel(stats.twistDegPerKm)} hint={`${stats.twistDegPerKm}°/km`} />
      <Stat
        label="Lignes droites"
        value={`${stats.straightSharePct} %`}
        hint={`max ${Math.round(stats.longestStraightKm * 1000)} m`}
      />
      <Stat label="Carrefours" value={stats.junctions} />
      {elevation && (
        <>
          <Stat label="Dénivelé" value={`+${elevation.gain} / −${elevation.loss} m`} />
          <Stat label="Altitude" value={`${elevation.min} → ${elevation.max} m`} />
          <Stat label="Pente max" value={`${elevation.maxSlopePct} %`} hint="sur 200 m" />
        </>
      )}
      <Stat label="Revêtement" value={surfaceLabel(stats.surfacePct)} />
      {stats.urbanPct > 0 && <Stat label="Traversée de hameau" value={`${stats.urbanPct} %`} />}
    </dl>
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

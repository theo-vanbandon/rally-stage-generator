import React from "react";
import PropTypes from "prop-types";
import { WATER_LEVELS, waterWhere, waterReasons } from "../../utils/water";
import "./WaterPoints.css";

/**
 * Vigilance eau de la spéciale affichée : endroits où une sortie de route peut finir dans une étendue d'eau
 * importante. Peu de points, tous justifiés ; un clic centre la carte sur le point.
 * Sans point (ou pendant le calcul, ou si l'IGN ne répond pas), rien n'est affiché : un message « aucune eau »
 * laisserait croire que la spéciale a été déclarée sans danger lié à l'eau.
 */
export default function WaterPoints({ status, points, onSelect = () => {} }) {
  if (status !== "done" || points.length === 0) return null;
  return (
    <div className="block water-points">
      <h2>Vigilance eau (plongeurs)</h2>
      <ul>
        {points.map((p) => (
          <li key={`${p.level}-${p.km}`}>
            <button type="button" className={`water-point ${p.level}`} onClick={() => onSelect(p)}>
              <span className="water-km">km {p.km.toFixed(2)}</span>
              <span className="water-text">
                <strong>{WATER_LEVELS[p.level].label}</strong>
                <span>{waterWhere(p)}</span>
                {waterReasons(p) && <small>{waterReasons(p)}</small>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="water-note">
        Aide à la préparation : seules les étendues d&apos;eau importantes et permanentes (lacs, étangs, grandes
        rivières) tout près de la route sont signalées, d&apos;après l&apos;IGN. Le dispositif de secours reste à
        définir par l&apos;organisateur et à vérifier sur place.
      </p>
    </div>
  );
}

WaterPoints.propTypes = {
  status: PropTypes.string.isRequired,
  points: PropTypes.arrayOf(
    PropTypes.shape({
      level: PropTypes.oneOf(["divers", "watch"]).isRequired,
      km: PropTypes.number.isRequired,
      coord: PropTypes.arrayOf(PropTypes.number).isRequired,
      side: PropTypes.string.isRequired,
      kind: PropTypes.string.isRequired,
      name: PropTypes.string,
      distanceM: PropTypes.number.isRequired,
      reasons: PropTypes.arrayOf(PropTypes.string).isRequired,
    })
  ).isRequired,
  onSelect: PropTypes.func,
};

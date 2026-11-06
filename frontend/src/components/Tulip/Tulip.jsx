import React from "react";
import PropTypes from "prop-types";
import "./Tulip.css";

const C = 50; // centre horizontal
const CY = 56; // centre vertical (un peu bas : la sortie a plus de place)
const R = 38; // rayon 1 de la tulipe = 60 m sur le terrain

/** Point de la tulipe (x à droite, y vers l'avant, rayon 1) → coordonnées SVG */
const toSvg = ([x, y]) => [C + x * R, CY - y * R];

/** Forme d'une branche : géométrie réelle si disponible, sinon trait droit selon l'angle */
function branchPoints(path, angle) {
  if (path?.length) return [[C, CY], ...path.map(toSvg)];
  const a = (angle * Math.PI) / 180;
  return [
    [C, CY],
    [C + R * Math.sin(a), CY - R * Math.cos(a)],
  ];
}

const pointsAttr = (pts) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

function Branch({ angle, kind, path = null }) {
  const pts = pointsAttr(branchPoints(path, angle));
  if (kind === "major") {
    return (
      <g>
        <polyline points={pts} className="tulip-major-outer" />
        <polyline points={pts} className="tulip-major-inner" />
      </g>
    );
  }
  return <polyline points={pts} className={kind === "track" ? "tulip-track" : "tulip-road"} />;
}

Branch.propTypes = {
  angle: PropTypes.number.isRequired,
  kind: PropTypes.string.isRequired,
  path: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.number)),
};

/** Flèche de sortie : tracé réel, tête orientée selon la fin de la route */
function ExitArrow({ points }) {
  const end = points.at(-1);
  const before = points.at(-2);
  const len = Math.hypot(end[0] - before[0], end[1] - before[1]) || 1;
  const [dx, dy] = [(end[0] - before[0]) / len, (end[1] - before[1]) / len];
  const tip = [end[0] + dx * 3, end[1] + dy * 3];
  const base = [end[0] - dx * 8, end[1] - dy * 8];
  const head = [tip, [base[0] - dy * 9, base[1] + dx * 9], [base[0] + dy * 9, base[1] - dx * 9]];
  return (
    <>
      <polyline points={pointsAttr([...points.slice(0, -1), base])} className="tulip-path" />
      <polygon points={pointsAttr(head)} className="tulip-arrow" />
    </>
  );
}

ExitArrow.propTypes = { points: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.number)).isRequired };

/**
 * Tulipe de roadbook : le point en bas indique d'où l'on arrive, la flèche la route à prendre,
 * les traits fins les autres routes du carrefour (double trait = route principale, pointillés = piste).
 * Les routes sont dessinées sur leurs 60 premiers mètres réels : virages arrondis et fourches compris.
 */
export default function Tulip({ tulip, size = 64 }) {
  const entry = tulip.entry ? branchPoints(tulip.entryPath, 180) : null;

  return (
    <svg className="tulip" viewBox="0 0 100 100" width={size} height={size} role="img" aria-hidden="true">
      {tulip.others.map((b, i) => (
        <Branch key={`${i}-${b.angle}-${b.kind}`} angle={b.angle} kind={b.kind} path={b.path} />
      ))}
      {entry && (
        <>
          <polyline points={pointsAttr(entry)} className="tulip-path" />
          <circle cx={entry.at(-1)[0]} cy={entry.at(-1)[1]} r="6" className="tulip-dot" />
        </>
      )}
      {!entry && <circle cx={C} cy={CY} r="5" className="tulip-dot" />}
      <ExitArrow points={branchPoints(tulip.exitPath, tulip.exit)} />
    </svg>
  );
}

Tulip.propTypes = {
  tulip: PropTypes.shape({
    entry: PropTypes.string,
    entryPath: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.number)),
    exit: PropTypes.number.isRequired,
    exitPath: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.number)),
    others: PropTypes.arrayOf(
      PropTypes.shape({
        angle: PropTypes.number,
        kind: PropTypes.string,
        path: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.number)),
      })
    ).isRequired,
  }).isRequired,
  size: PropTypes.number,
};

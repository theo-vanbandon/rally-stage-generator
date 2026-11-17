import React from "react";
import PropTypes from "prop-types";
import { C, CY, RING_R, branchPoints, exitArrow, roundaboutArc } from "../../utils/tulipGeometry";
import "./Tulip.css";

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

/** Flèche de sortie (voir utils/tulipGeometry) */
function ExitArrow({ points }) {
  const { line, head } = exitArrow(points);
  return (
    <>
      <polyline points={pointsAttr(line)} className="tulip-path" />
      <polygon points={pointsAttr(head)} className="tulip-arrow" />
    </>
  );
}

ExitArrow.propTypes = { points: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.number)).isRequired };

/** Rond-point (liaisons) : anneau, et parcours en noir de l'entrée (en bas) jusqu'à la sortie */
function Roundabout({ exit }) {
  const { start, end, sweep } = roundaboutArc(exit);
  return (
    <>
      <circle cx={C} cy={CY} r={RING_R} className="tulip-ring" />
      <path
        d={`M ${start[0].toFixed(1)} ${start[1].toFixed(1)} A ${RING_R} ${RING_R} 0 ${sweep > 180 ? 1 : 0} 0 ${end[0].toFixed(1)} ${end[1].toFixed(1)}`}
        className="tulip-ring-path"
      />
    </>
  );
}

Roundabout.propTypes = { exit: PropTypes.number.isRequired };

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
      {tulip.roundabout && <Roundabout exit={tulip.exit} />}
    </svg>
  );
}

Tulip.propTypes = {
  tulip: PropTypes.shape({
    entry: PropTypes.string,
    entryPath: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.number)),
    exit: PropTypes.number.isRequired,
    roundabout: PropTypes.bool,
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

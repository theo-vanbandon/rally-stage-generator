import React, { useMemo, useRef } from "react";
import PropTypes from "prop-types";
import "./ElevationProfile.css";

const W = 600;
const H = 170;
const PAD = { top: 12, right: 12, bottom: 24, left: 42 };

/** Graduations "rondes" entre min et max */
function niceTicks(min, max, count) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

/**
 * Profil altimétrique de la spéciale ; le survol met en évidence la position sur la carte
 */
export default function ElevationProfile({ profile, hoverKm = null, onHover = () => {} }) {
  const svgRef = useRef(null);

  const chart = useMemo(() => {
    if (!profile || profile.length < 2) return null;
    const totalKm = profile[profile.length - 1][0];
    const zs = profile.map((p) => p[1]);
    const zMin = Math.min(...zs);
    const zMax = Math.max(...zs);
    // Échelle verticale d'au moins 100 m pour ne pas exagérer le relief en plaine
    const pad = Math.max(10, (100 - (zMax - zMin)) / 2);
    const lo = zMin - pad;
    const hi = zMax + pad;

    const x = (km) => PAD.left + (km / totalKm) * (W - PAD.left - PAD.right);
    const y = (z) => PAD.top + (1 - (z - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);

    const line = profile.map(([km, z], i) => `${i ? "L" : "M"}${x(km).toFixed(1)},${y(z).toFixed(1)}`).join(" ");
    const area = `${line} L${x(totalKm).toFixed(1)},${H - PAD.bottom} L${PAD.left},${H - PAD.bottom} Z`;

    return {
      totalKm,
      x,
      y,
      line,
      area,
      zTicks: niceTicks(lo, hi, 3),
      kmTicks: niceTicks(0, totalKm, 6),
    };
  }, [profile]);

  if (!chart) return null;

  const zAt = (km) => {
    const i = profile.findIndex((p) => p[0] >= km);
    if (i <= 0) return profile[0][1];
    const [k0, z0] = profile[i - 1];
    const [k1, z1] = profile[i];
    return z0 + ((z1 - z0) * (km - k0)) / (k1 - k0 || 1);
  };

  const handleMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const km = ((px - PAD.left) / (W - PAD.left - PAD.right)) * chart.totalKm;
    onHover(Math.max(0, Math.min(chart.totalKm, km)));
  };

  return (
    <figure className="elevation-profile">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Profil d'altitude de la spéciale"
        onMouseMove={handleMove}
        onMouseLeave={() => onHover(null)}
      >
        {chart.zTicks.map((z) => (
          <g key={`z${z}`}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={chart.y(z)} y2={chart.y(z)} />
            <text className="axis" x={PAD.left - 6} y={chart.y(z) + 4} textAnchor="end">
              {Math.round(z)}
            </text>
          </g>
        ))}
        {chart.kmTicks.map((km) => (
          <text key={`k${km}`} className="axis" x={chart.x(km)} y={H - 6} textAnchor="middle">
            {km} km
          </text>
        ))}
        <path className="area" d={chart.area} />
        <path className="line" d={chart.line} />
        {hoverKm !== null && (
          <g>
            <line className="cursor" x1={chart.x(hoverKm)} x2={chart.x(hoverKm)} y1={PAD.top} y2={H - PAD.bottom} />
            <circle className="cursor-dot" cx={chart.x(hoverKm)} cy={chart.y(zAt(hoverKm))} r="4" />
            <text
              className="cursor-label"
              x={Math.min(chart.x(hoverKm) + 6, W - 90)}
              y={PAD.top + 12}
            >
              {hoverKm.toFixed(2)} km · {Math.round(zAt(hoverKm))} m
            </text>
          </g>
        )}
      </svg>
    </figure>
  );
}

ElevationProfile.propTypes = {
  profile: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.number)),
  hoverKm: PropTypes.number,
  onHover: PropTypes.func,
};

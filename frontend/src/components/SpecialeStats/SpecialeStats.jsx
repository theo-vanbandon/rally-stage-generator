import React from "react";
import "./SpecialeStats.css";

export default function SpecialeStats({ stats }) {
  if (!stats) return null;

  return (
    <div className="speciale-stats">
      <h2>Statistiques de la spéciale</h2>
      <ul>
        <li>
          <strong>Longueur :</strong> {stats.length} km
        </li>
        <li>
          <strong>Nombre d'intersections :</strong> {stats.intersections}
        </li>
        <li>
          <strong>Distance moyenne entre les PK :</strong> {stats.avgDistanceBetweenPK} km
        </li>
        <li>
          <strong>Altitude minimale :</strong> {stats.elevation.min.toFixed(0)} m
        </li>
        <li>
          <strong>Altitude maximale :</strong> {stats.elevation.max.toFixed(0)} m
        </li>
        <li>
          <strong>Dénivelé positif :</strong> {stats.elevation.gain} m
        </li>
        <li>
          <strong>Dénivelé négatif :</strong> {stats.elevation.loss} m
        </li>
        <li>
          <strong>Pente moyenne :</strong> {stats.avgSlope} %
        </li>
      </ul>
    </div>
  );
}

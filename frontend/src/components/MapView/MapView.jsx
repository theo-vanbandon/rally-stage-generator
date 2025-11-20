import React, { useMemo } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIconPng from "leaflet/dist/images/marker-icon.png";
import markerShadowPng from "leaflet/dist/images/marker-shadow.png";
import { haversineDistance } from "../../utils/geometry";
import "./MapView.css";

// Icône de départ (rouge)
const startIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
  shadowUrl: markerShadowPng,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
  className: "start-marker",
});

// Icône d'arrivée (bleue)
const endIcon = new L.Icon({
  iconUrl: markerIconPng,
  shadowUrl: markerShadowPng,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
  className: "end-marker",
});

/**
 * Crée une icône pour les points kilométriques
 */
const createPKIcon = (label) => {
  return new L.DivIcon({
    html: `<div class="pk-marker-container">
             <div class="pk-marker-label">${label}</div>
           </div>`,
    iconSize: [40, 20],
    iconAnchor: [20, 10],
    popupAnchor: [0, -10],
    className: "pk-icon",
  });
};

/**
 * Calcule les PK aux indices d'intersection
 */
function calculatePKs(specialeCoords, intersectionIndices) {
  if (!intersectionIndices || intersectionIndices.length === 0) {
    return [];
  }

  const indices = Array.isArray(intersectionIndices)
    ? intersectionIndices
    : Array.from(intersectionIndices);

  const pks = [];
  let cumulativeDistance = 0;

  for (let i = 0; i < specialeCoords.length - 1; i++) {
    const dist = haversineDistance(specialeCoords[i], specialeCoords[i + 1]);
    cumulativeDistance += dist;

    if (indices.includes(i)) {
      const pkNumber = Math.round(cumulativeDistance * 10);
      pks.push({
        position: [specialeCoords[i][1], specialeCoords[i][0]], // [lat, lon]
        distance: cumulativeDistance,
        label: `PK${pkNumber}`,
      });
    }
  }

  return pks;
}

export default function MapView({ geojson, intersections }) {
  // Extraction des lignes pour l'affichage
  const lines = geojson?.features
    ?.filter((f) => f.geometry.type === "LineString")
    .map((f) => f.geometry.coordinates.map((c) => [c[1], c[0]])); // [lat, lon]

  // Points de départ et d'arrivée
  const start = lines?.length ? lines[0][0] : null;
  const end = lines?.length ? lines[0][lines[0].length - 1] : null;

  // Calcul des PK
  const pks = useMemo(() => {
    const coords = geojson?.features?.[0]?.geometry?.coordinates;
    if (!coords || !intersections) return [];
    return calculatePKs(coords, intersections);
  }, [geojson, intersections]);

  return (
    <MapContainer
      center={start || [46.5, 6.1]}
      zoom={13}
      style={{ height: "80vh", width: "100%" }}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      {/* Tracé de la spéciale */}
      {lines?.map((coords, i) => (
        <Polyline key={i} positions={coords} color="#E53935" weight={4} />
      ))}

      {/* Marqueur de départ */}
      {start && (
        <Marker position={start} icon={startIcon}>
          <Popup>Départ</Popup>
        </Marker>
      )}

      {/* Marqueur d'arrivée */}
      {end && (
        <Marker position={end} icon={endIcon}>
          <Popup>Arrivée</Popup>
        </Marker>
      )}

      {/* Points kilométriques */}
      {pks.map((pk, i) => (
        <Marker
          key={`pk-${i}`}
          position={pk.position}
          icon={createPKIcon(pk.label)}
          zIndexOffset={1000}
        >
          <Popup>
            <strong>{pk.label}</strong>
            <br />
            {pk.distance.toFixed(2)} km depuis le départ
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

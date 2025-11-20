// src/components/MapView.jsx
import React, { useMemo } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIconPng from "leaflet/dist/images/marker-icon.png";
import markerShadowPng from "leaflet/dist/images/marker-shadow.png";

import "./MapView.css";

// Icônes Leaflet
const startIcon = new L.Icon({
  iconUrl: markerIconPng,
  shadowUrl: markerShadowPng,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const endIcon = new L.Icon({
  iconUrl: markerIconPng,
  shadowUrl: markerShadowPng,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
  className: "end-marker",
});

// Icône pour les PK (texte blanc sur fond bleu)
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

// Fonction pour calculer la distance entre deux coordonnées [lon, lat]
function haversineDistance(coord1, coord2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const [lon1, lat1] = coord1;
  const [lon2, lat2] = coord2;
  const R = 6371; // Rayon de la Terre en km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Calculer les PK aux indices d'intersection donnés par le backend
function calculatePKs(specialeCoords, intersectionIndices) {
  if (!intersectionIndices || intersectionIndices.length === 0) {
    console.log("Aucune intersection fournie");
    return [];
  }
  
  // S'assurer que c'est un tableau
  const indices = Array.isArray(intersectionIndices) ? intersectionIndices : Array.from(intersectionIndices);
  
  console.log("=== CALCUL DES PK ===");
  console.log("Intersections reçues:", indices);
  
  const pks = [];
  let cumulativeDistance = 0;
  
  for (let i = 0; i < specialeCoords.length - 1; i++) {
    const dist = haversineDistance(specialeCoords[i], specialeCoords[i + 1]);
    cumulativeDistance += dist;
    
    // Si cet indice est une intersection
    if (indices.includes(i)) {
      const pkNumber = Math.round(cumulativeDistance * 10);
      pks.push({
        position: [specialeCoords[i][1], specialeCoords[i][0]], // [lat, lon]
        distance: cumulativeDistance,
        label: `PK${pkNumber}`,
      });
      console.log(`PK ajouté: ${pkNumber} à l'indice ${i} (${cumulativeDistance.toFixed(2)} km)`);
    }
  }
  
  console.log("Total PK générés:", pks.length);
  return pks;
}

export default function MapView({ geojson, intersections }) {
  console.log("MapView render - geojson:", geojson, "intersections:", intersections);
  
  // On récupère les coordonnées des LineString pour les afficher
  const lines = geojson?.features
    ?.filter(f => f.geometry.type === "LineString")
    .map(f => f.geometry.coordinates.map(c => [c[1], c[0]])); // [lat, lon]

  // Départ / arrivée = première et dernière coordonnées de la première ligne
  const start = lines && lines.length ? lines[0][0] : null;
  const end = lines && lines.length ? lines[0][lines[0].length - 1] : null;

  // Calculer les PK basés sur les intersections fournies par le backend
  const pks = useMemo(() => {
    if (!geojson?.features?.[0]?.geometry?.coordinates) {
      console.log("Pas de coordonnées spéciale");
      return [];
    }
    if (!intersections) {
      console.log("Pas d'intersections fournies");
      return [];
    }
    
    const coords = geojson.features[0].geometry.coordinates;
    return calculatePKs(coords, intersections);
  }, [geojson, intersections]);

  return (
    <>
      <style>{`
        .pk-marker-container {
          position: relative;
          z-index: 1000 !important;
        }
        .pk-marker-label {
          background-color: #2196F3;
          color: white;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 11px;
          font-weight: bold;
          white-space: nowrap;
          border: 2px solid white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.4);
        }
        .pk-icon {
          background: transparent !important;
          border: none !important;
          z-index: 1000 !important;
        }
        .leaflet-marker-pane .pk-icon {
          z-index: 1000 !important;
        }
      `}</style>
      
      <MapContainer
        center={start || [46.5, 6.1]}
        zoom={13}
        style={{ height: "80vh", width: "100%" }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {/* Tracé de la spéciale en rouge */}
        {lines?.map((coords, i) => (
          <Polyline key={i} positions={coords} color="#E53935" weight={4} />
        ))}

        {/* Marqueurs de départ et arrivée */}
        {start && (
          <Marker position={start} icon={startIcon}>
            <Popup>Départ</Popup>
          </Marker>
        )}

        {end && (
          <Marker position={end} icon={endIcon}>
            <Popup>Arrivée</Popup>
          </Marker>
        )}

        {/* PK aux intersections */}
        {pks.map((pk, i) => (
          <Marker key={`pk-${i}`} position={pk.position} icon={createPKIcon(pk.label)} zIndexOffset={1000}>
            <Popup>
              <strong>{pk.label}</strong><br />
              {pk.distance.toFixed(2)} km depuis le départ
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </>
  );
}

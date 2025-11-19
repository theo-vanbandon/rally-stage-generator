// src/components/MapView.jsx
import React from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIconPng from "leaflet/dist/images/marker-icon.png";
import markerShadowPng from "leaflet/dist/images/marker-shadow.png";

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

export default function MapView({ geojson }) {
  // On récupère les coordonnées des LineString pour les afficher
  const lines = geojson?.features
    ?.filter(f => f.geometry.type === "LineString")
    .map(f => f.geometry.coordinates.map(c => [c[1], c[0]])); // [lat, lon]

  // Départ / arrivée = première et dernière coordonnées de la première ligne
  const start = lines && lines.length ? lines[0][0] : null;
  const end = lines && lines.length ? lines[0][lines[0].length - 1] : null;

  return (
    <MapContainer
      center={start || [46.5, 6.1]} // centre France par défaut
      zoom={10}
      style={{ height: "80vh", width: "100%" }}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      {lines?.map((coords, i) => (
        <Polyline key={i} positions={coords} color="red" />
      ))}

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
    </MapContainer>
  );
}

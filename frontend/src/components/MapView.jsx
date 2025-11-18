// src/components/MapView.jsx
import React from "react";
import { MapContainer, TileLayer, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export default function MapView({ geojson }) {
  // On récupère les coordonnées des LineString pour les afficher
  const lines = geojson?.features
    ?.filter(f => f.geometry.type === "LineString")
    .map(f => f.geometry.coordinates.map(c => [c[1], c[0]])); // [lat, lon]

  return (
    <MapContainer
      center={lines && lines.length ? lines[0][0] : [46.5, 6.1]} // centre France par défaut
      zoom={10}
      style={{ height: "80vh", width: "100%" }}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {lines?.map((coords, i) => (
        <Polyline key={i} positions={coords} color="red" />
      ))}
    </MapContainer>
  );
}

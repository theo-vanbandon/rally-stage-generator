// src/components/RouteGenerator.jsx
import React, { useState } from "react";
import MapView from "./MapView";

export default function RouteGenerator() {
  const [place, setPlace] = useState("");
  const [postal, setPostal] = useState("");
  const [radiusKm, setRadiusKm] = useState(5);
  const [geojson, setGeojson] = useState(null);

  const handleGenerate = async () => {
    if (!place) return;

    try {
      const res = await fetch("http://localhost:4000/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place, postal, radiusKm }),
      });

      const data = await res.json();

      if (data.ok) {
        setGeojson(data.geojson);
      } else {
        alert("Erreur : " + (data.error || "Unknown"));
      }
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la communication avec le backend.");
    }
  };

  return (
    <div style={{ padding: "1rem" }}>
      <h1>Rally Stage Generator</h1>

      <label>
        Ville :{" "}
        <input
          type="text"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          placeholder="Ex : Gap"
        />
      </label>
      <br />

      <label>
        Code postal :{" "}
        <input
          type="text"
          value={postal}
          onChange={(e) => setPostal(e.target.value)}
          placeholder="Ex : 05000"
        />
      </label>
      <br />

      <label>
        Rayon (km) :{" "}
        <input
          type="number"
          value={radiusKm}
          onChange={(e) => setRadiusKm(Number(e.target.value))}
          min={1}
          max={50}
        />
      </label>
      <br />

      <button onClick={handleGenerate}>Générer routes</button>

      {geojson && <MapView geojson={geojson} />}
    </div>
  );
}

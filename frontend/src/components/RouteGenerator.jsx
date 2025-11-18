import React, { useState } from "react";
import MapView from "./MapView";
import "./RouteGenerator.css";

export default function RouteGenerator() {
  const [place, setPlace] = useState("");
  const [postal, setPostal] = useState("");
  const [radiusKm, setRadiusKm] = useState(5);
  const [geojson, setGeojson] = useState(null);
  const [loading, setLoading] = useState(false); // <-- état de chargement

  const handleGenerate = async () => {
    if (!place) return;

    setLoading(true); // début du chargement
    setGeojson(null); // reset carte pendant le chargement

    try {
      const res = await fetch("http://localhost:4000/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place, postal, radiusKm }),
      });

      const data = await res.json();

      if (data.ok) setGeojson(data.geojson);
      else alert("Erreur : " + (data.error || "Unknown"));
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la communication avec le backend.");
    } finally {
      setLoading(false); // fin du chargement
    }
  };

  return (
    <div className="route-generator">
      <h1>Rally Stage Generator</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleGenerate();
        }}
      >
        <label>
          Ville :
          <input
            type="text"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder="Ex : Gap"
          />
        </label>

        <label>
          Code postal :
          <input
            type="text"
            value={postal}
            onChange={(e) => setPostal(e.target.value)}
            placeholder="Ex : 05000"
          />
        </label>

        <label>
          Rayon (km) :
          <input
            type="number"
            value={radiusKm}
            onChange={(e) => setRadiusKm(Number(e.target.value))}
            min={1}
            max={50}
          />
        </label>

        <button type="submit" disabled={loading}>
          {loading ? "Chargement..." : "Générer routes"}
        </button>
      </form>

      {loading && (
        <div className="loader-container">
          <div className="loader"></div>
        </div>
      )}

      {geojson && !loading && (
        <div className="map-container">
          <MapView geojson={geojson} />
        </div>
      )}
    </div>
  );
}

import React, { useState } from "react";
import MapView from "./MapView";
import "./RouteGenerator.css";

export default function RouteGenerator() {
  const [place, setPlace] = useState("");
  const [postal, setPostal] = useState("");
  const [radiusKm, setRadiusKm] = useState(5);
  const [geojson, setGeojson] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleGenerate = async () => {
    setErrorMsg("");

    // --- Validation rapide (front-end) ---
    if (!place.trim()) {
      setErrorMsg("Veuillez entrer une ville.");
      return;
    }

    if (!/^\d{5}$/.test(postal)) {
      setErrorMsg("Veuillez entrer un code postal valide (5 chiffres).");
      return;
    }

    if (radiusKm < 1 || radiusKm > 50) {
      setErrorMsg("Le rayon doit être compris entre 1 km et 50 km.");
      return;
    }

    setLoading(true);
    setGeojson(null);

    try {
      const res = await fetch("http://localhost:4000/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place, postal, radiusKm }),
      });

      const data = await res.json();

      if (data.ok) setGeojson(data.geojson);
      else setErrorMsg(data.error || "Erreur inconnue.");
    } catch (err) {
      console.error(err);
      setErrorMsg("Impossible de communiquer avec le backend.");
    } finally {
      setLoading(false);
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
            required
          />
        </label>

        <label>
          Code postal :
          <input
            type="text"
            value={postal}
            onChange={(e) => setPostal(e.target.value)}
            placeholder="Ex : 05000"
            pattern="\d{5}"
            required
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
            required
          />
          <small>Min : 1 km — Max : 50 km</small>
        </label>

        <button type="submit" disabled={loading}>
          {loading ? "Chargement..." : "Générer routes"}
        </button>
      </form>

      {/* ---- Affichage erreur ---- */}
      {errorMsg && <p className="error-message">{errorMsg}</p>}

      {/* ---- Loader ---- */}
      {loading && (
        <div className="loader-container">
          <div className="loader"></div>
        </div>
      )}

      {/* ---- Carte ---- */}
      {geojson && !loading && (
        <div className="map-container">
          <MapView geojson={geojson} />
        </div>
      )}
    </div>
  );
}

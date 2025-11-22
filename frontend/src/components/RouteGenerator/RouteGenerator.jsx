import React, { useState, useEffect } from "react";
import MapView from "../MapView";
import SpecialeStats from "../SpecialeStats";
import { generateSpeciale } from "../../services/api";
import { exportGeoJSON, exportKML, exportGPX } from "../../services/exportService";
import { calculateSpecialeStats } from "../../utils/specialeStats";
import "./RouteGenerator.css";

export default function RouteGenerator() {
  const [place, setPlace] = useState("");
  const [postal, setPostal] = useState("");
  const [radiusKm, setRadiusKm] = useState(5);
  const [geojson, setGeojson] = useState(null);
  const [intersections, setIntersections] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [stats, setStats] = useState(null);

  const validateForm = () => {
    if (!place.trim()) {
      setErrorMsg("Veuillez entrer une ville.");
      return false;
    }
    if (!/^\d{5}$/.test(postal)) {
      setErrorMsg("Veuillez entrer un code postal valide (5 chiffres).");
      return false;
    }
    if (radiusKm < 1 || radiusKm > 50) {
      setErrorMsg("Le rayon doit être compris entre 1 km et 50 km.");
      return false;
    }
    return true;
  };

  const handleGenerate = async () => {
    setErrorMsg("");
    if (!validateForm()) return;

    setLoading(true);
    setGeojson(null);
    setIntersections(null);
    setStats(null);

    try {
      const data = await generateSpeciale(place, postal, radiusKm);
      setGeojson(data.geojson);
      setIntersections(data.intersections);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || "Impossible de communiquer avec le backend.");
    } finally {
      setLoading(false);
    }
  };

  // Calcul des statistiques
  useEffect(() => {
    if (geojson && intersections) {
      calculateSpecialeStats(geojson, intersections).then(setStats);
    }
  }, [geojson, intersections]);

  return (
    <div className="route-generator">
      <h1>Générateur de spéciale de rallye</h1>

      <form onSubmit={(e) => { e.preventDefault(); handleGenerate(); }}>
        <label htmlFor="place">Ville :</label>
        <input
          id="place"
          type="text"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          placeholder="Ex : Gap"
          required
        />

        <label htmlFor="postal">Code postal :</label>
        <input
          id="postal"
          type="text"
          value={postal}
          onChange={(e) => setPostal(e.target.value)}
          placeholder="Ex : 05000"
          pattern="\d{5}"
          required
        />

        <label htmlFor="radiusKm">Rayon (km) :</label>
        <input
          id="radiusKm"
          type="number"
          value={radiusKm}
          onChange={(e) => setRadiusKm(Number(e.target.value))}
          min={1}
          max={50}
          required
        />
        <small>Min : 1 km — Max : 50 km</small>

        <button type="submit" disabled={loading}>
          {loading ? "Chargement..." : "Générer la spéciale"}
        </button>
      </form>

      {errorMsg && <p className="error-message">{errorMsg}</p>}

      {loading && (
        <div className="loader-container">
          <div className="loader"></div>
        </div>
      )}

      {geojson && !loading && (
        <>
          <div className="export-buttons">
            <button type="button" onClick={() => exportGeoJSON(geojson)}>
              Export GeoJSON
            </button>
            <button type="button" onClick={() => exportKML(geojson)}>
              Export KML
            </button>
            <button type="button" onClick={() => exportGPX(geojson)}>
              Export GPX
            </button>
          </div>

          <div className="map-container">
            <MapView geojson={geojson} intersections={intersections} />
          </div>

          <SpecialeStats stats={stats} />
        </>
      )}
    </div>
  );
}

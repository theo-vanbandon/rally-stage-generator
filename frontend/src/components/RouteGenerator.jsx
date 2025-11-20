// src/components/RouteGenerator.jsx
import React, { useState } from "react";
import MapView from "./MapView";
import "./RouteGenerator.css";

export default function RouteGenerator() {
  const [place, setPlace] = useState("");
  const [postal, setPostal] = useState("");
  const [radiusKm, setRadiusKm] = useState(5);
  const [geojson, setGeojson] = useState(null);
  const [intersections, setIntersections] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleGenerate = async () => {
    setErrorMsg("");

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
    setIntersections(null);

    try {
      const res = await fetch("http://localhost:4000/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place, postal, radiusKm }),
      });

      const data = await res.json();

      if (data.ok) {
        setGeojson(data.geojson);
        setIntersections(data.intersections);
      } else {
        setErrorMsg(data.error || "Erreur inconnue.");
      }
    } catch (err) {
      console.error(err);
      setErrorMsg("Impossible de communiquer avec le backend.");
    } finally {
      setLoading(false);
    }
  };

  // --- Fonctions d'export ---
  const exportGeoJSON = (geojsonData) => {
    const blob = new Blob([JSON.stringify(geojsonData)], { type: "application/geo+json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "stage.geojson";
    a.click();
  };

  const exportKML = (geojsonData) => {
    if (!geojsonData.features) return;

    let coordsList = [];
    geojsonData.features.forEach(f => {
      if (f.geometry.type === "LineString") {
        coordsList.push(f.geometry.coordinates);
      }
    });

    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><LineString><coordinates>`;

    coordsList.forEach(coords => {
      coords.forEach(([lon, lat]) => {
        kml += `${lon},${lat},0 `;
      });
    });

    kml += `</coordinates></LineString></Placemark></Document></kml>`;

    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "stage.kml";
    a.click();
  };

  const exportGPX = (geojsonData) => {
    if (!geojsonData.features) return;

    let coordsList = [];
    geojsonData.features.forEach(f => {
      if (f.geometry.type === "LineString") {
        coordsList.push(f.geometry.coordinates);
      }
    });

    let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RallyStageGenerator"><trk><name>Trace exportée</name><trkseg>`;

    coordsList.forEach(coords => {
      coords.forEach(([lon, lat]) => {
        gpx += `<trkpt lat="${lat}" lon="${lon}"></trkpt>`;
      });
    });

    gpx += `</trkseg></trk></gpx>`;

    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "stage.gpx";
    a.click();
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
          {loading ? "Chargement..." : "Générer la spéciale"}
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

      {/* ---- Boutons d’export ---- */}
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

          {/* ---- Carte ---- */}
          <div className="map-container">
            <MapView geojson={geojson} intersections={intersections} />
          </div>
        </>
      )}
    </div>
  );
}

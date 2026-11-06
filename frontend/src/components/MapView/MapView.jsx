import React, { useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import {
  MapContainer,
  TileLayer,
  LayersControl,
  Polyline,
  Marker,
  CircleMarker,
  Rectangle,
  Tooltip,
  ScaleControl,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { bboxAround } from "../../utils/geometry";
import "./MapView.css";

const FRANCE_CENTER = [46.6, 2.5];

const IGN_WMTS =
  "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&STYLE=normal&TILEMATRIXSET=PM" +
  "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";
const IGN_ATTRIBUTION = '&copy; <a href="https://www.ign.fr/">IGN</a> — Géoplateforme';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const flagIcon = (className, label) =>
  new L.DivIcon({
    html: `<span class="stage-flag ${className}">${label}</span>`,
    className: "stage-flag-icon",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

const startIcon = flagIcon("start", "D");
const finishIcon = flagIcon("finish", "A");
const stopIcon = flagIcon("stop", "S");

const toLatLngs = (coords) => coords.map(([lon, lat]) => [lat, lon]);

// Styles Leaflet (appliqués via setStyle : pas de variables CSS possibles ici)
const STYLES = {
  casing: { color: "#ffffff", weight: 9, opacity: 0.9, interactive: false },
  selected: { color: "#e53935", weight: 5, opacity: 1, interactive: false },
  alternative: { color: "#455a64", weight: 5, opacity: 0.55, dashArray: "8 6" },
  searchArea: { color: "#5d6875", weight: 1.5, dashArray: "6 6", fill: false, interactive: false },
  pk: { color: "#ffffff", weight: 2, fillColor: "#263238", fillOpacity: 1 },
  hover: { color: "#ffffff", weight: 3, fillColor: "#e53935", fillOpacity: 1, interactive: false },
  stopPath: { color: "#263238", weight: 3, dashArray: "2 7", interactive: false },
};

// Style du tracé selon le revêtement (voir la légende dans RouteGenerator).
// Pas d'orange : c'est la couleur des grands axes sur le Plan IGN. Pointillés = chemin, comme sur une carte.
export const SURFACE_STYLES = {
  paved: { color: "#e53935" },
  gravel: { color: "#6d4127" },
  dirt: { color: "#6d4127", dashArray: "7 6" },
};

/** Recadre la carte sur la spéciale sélectionnée */
function FitToStage({ positions }) {
  const map = useMap();
  useEffect(() => {
    if (positions?.length) map.fitBounds(positions, { padding: [40, 40] });
  }, [map, positions]);
  return null;
}

/** Centre la carte sur un point (clic dans le roadbook) */
function FlyTo({ point }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.flyTo([point[1], point[0]], Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [map, point]);
  return null;
}

export default function MapView({
  stages = [],
  selectedIndex = 0,
  onSelect = () => {},
  searchArea = null,
  hoverPoint = null,
  focusPoint = null,
}) {
  const lines = useMemo(() => stages.map((s) => toLatLngs(s.geometry.coordinates)), [stages]);
  const selected = stages[selectedIndex];
  const selectedLine = lines[selectedIndex];

  const searchBounds = useMemo(() => {
    if (!searchArea) return null;
    const [s, w, n, e] = bboxAround(searchArea.lat, searchArea.lon, searchArea.radiusKm);
    return [
      [s, w],
      [n, e],
    ];
  }, [searchArea]);

  return (
    <MapContainer center={FRANCE_CENTER} zoom={6} className="map-view" scrollWheelZoom>
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="Plan IGN">
          <TileLayer
            url={`${IGN_WMTS}&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&FORMAT=image/png`}
            attribution={IGN_ATTRIBUTION}
            maxZoom={19}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Photo aérienne">
          <TileLayer
            url={`${IGN_WMTS}&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&FORMAT=image/jpeg`}
            attribution={IGN_ATTRIBUTION}
            maxZoom={19}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="OpenStreetMap">
          <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution={OSM_ATTRIBUTION} maxZoom={19} />
        </LayersControl.BaseLayer>
      </LayersControl>

      <ScaleControl position="bottomleft" imperial={false} />

      {searchBounds && (
        <Rectangle bounds={searchBounds} pathOptions={STYLES.searchArea} />
      )}

      {lines.map((positions, i) =>
        i === selectedIndex ? null : (
          <Polyline
            key={stages[i].id}
            positions={positions}
            pathOptions={STYLES.alternative}
            eventHandlers={{
              click: () => onSelect(i),
              mouseover: (e) => e.target.setStyle({ opacity: 0.9 }),
              mouseout: (e) => e.target.setStyle({ opacity: STYLES.alternative.opacity }),
            }}
          >
            <Tooltip sticky>Tracé {i + 1} — {stages[i].stats.lengthKm} km (cliquer pour afficher)</Tooltip>
          </Polyline>
        )
      )}

      {selectedLine && (
        <>
          <Polyline positions={selectedLine} pathOptions={STYLES.casing} />
          {(selected.surfaces?.length ? selected.surfaces : [{ surface: "paved", from: 0, to: selectedLine.length - 1 }]).map(
            (section) => (
              <Polyline
                key={`${section.surface}-${section.from}`}
                positions={selectedLine.slice(section.from, section.to + 1)}
                pathOptions={{ ...STYLES.selected, ...SURFACE_STYLES[section.surface] }}
              />
            )
          )}
          <FitToStage positions={selectedLine} />

          {selected.roadbook
            .filter((c) => c.type === "junction" || c.type === "surface")
            .map((c) => (
              <CircleMarker key={c.n} center={[c.coord[1], c.coord[0]]} radius={5} pathOptions={STYLES.pk}>
                <Tooltip direction="top" offset={[0, -6]}>
                  <strong>Case {c.n}</strong> — km {c.km.toFixed(2)} — {c.direction}
                  {c.road ? ` (${c.road})` : ""}
                </Tooltip>
              </CircleMarker>
            ))}

          {selected.stop && (
            <>
              <Polyline positions={toLatLngs(selected.stop.path)} pathOptions={STYLES.stopPath} />
              <Marker position={[selected.stop.coord[1], selected.stop.coord[0]]} icon={stopIcon} zIndexOffset={900}>
                <Tooltip direction="top" offset={[0, -14]}>
                  Point stop — {selected.stop.distanceKm.toFixed(2)} km après l'arrivée
                </Tooltip>
              </Marker>
            </>
          )}

          <Marker position={selectedLine[0]} icon={startIcon} zIndexOffset={1000}>
            <Tooltip direction="top" offset={[0, -14]}>Départ</Tooltip>
          </Marker>
          <Marker position={selectedLine[selectedLine.length - 1]} icon={finishIcon} zIndexOffset={1000}>
            <Tooltip direction="top" offset={[0, -14]}>Arrivée — {selected.stats.lengthKm} km</Tooltip>
          </Marker>
        </>
      )}

      {hoverPoint && (
        <CircleMarker
          center={[hoverPoint[1], hoverPoint[0]]}
          radius={8}
          pathOptions={STYLES.hover}
        />
      )}

      <FlyTo point={focusPoint} />
    </MapContainer>
  );
}

const stageShape = PropTypes.shape({
  id: PropTypes.string.isRequired,
  geometry: PropTypes.shape({ coordinates: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.number)) }).isRequired,
  roadbook: PropTypes.arrayOf(PropTypes.object).isRequired,
  stop: PropTypes.shape({
    coord: PropTypes.arrayOf(PropTypes.number),
    path: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.number)),
    distanceKm: PropTypes.number,
  }),
  surfaces: PropTypes.arrayOf(
    PropTypes.shape({ surface: PropTypes.string, from: PropTypes.number, to: PropTypes.number })
  ),
  stats: PropTypes.shape({ lengthKm: PropTypes.number }).isRequired,
});

MapView.propTypes = {
  stages: PropTypes.arrayOf(stageShape),
  selectedIndex: PropTypes.number,
  onSelect: PropTypes.func,
  searchArea: PropTypes.shape({ lat: PropTypes.number, lon: PropTypes.number, radiusKm: PropTypes.number }),
  hoverPoint: PropTypes.arrayOf(PropTypes.number),
  focusPoint: PropTypes.arrayOf(PropTypes.number),
};

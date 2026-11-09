import React, { useEffect, useMemo, useState } from "react";
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
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { bboxAround, cumulativeDistances, loopArrows, pointAtKm } from "../../utils/geometry";
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

const LOOP_ARROW_COLOR = "#1565c0";

const arrowHeadIcon = (angle) =>
  new L.DivIcon({
    // La pointe du triangle (25, 14) est le point d'ancrage et le centre de rotation : elle tombe exactement au bout
    // du trait, quel que soit l'angle
    html: `<svg class="loop-arrow-head" viewBox="0 0 28 28" style="transform-origin: 25px 14px; transform: rotate(${angle.toFixed(0)}deg)"><path d="M6 4 L25 14 L6 24 L10 14 Z"/></svg>`,
    className: "loop-arrow-head-icon",
    iconSize: [28, 28],
    iconAnchor: [25, 14],
  });

const sharedIcon = new L.DivIcon({
  html: '<span class="shared-badge" aria-hidden="true">2×</span>',
  className: "loop-hub-icon",
  iconSize: [30, 20],
  iconAnchor: [15, 10],
});

const loopIcon = new L.DivIcon({
  html: '<span class="loop-hub" aria-hidden="true"><b>2×</b></span>',
  className: "loop-hub-icon",
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

/** Indice du point du tracé le plus proche d'un kilométrage donné */
const indexAtKm = (cumulative, km) => {
  let best = 0;
  cumulative.forEach((d, i) => {
    if (Math.abs(d - km) < Math.abs(cumulative[best] - km)) best = i;
  });
  return best;
};

/**
 * Grosses flèches de sens de la boucle, dessinées à côté du tracé (côté extérieur), jamais sur un autre
 * morceau de la spéciale. Recalculées à chaque zoom pour garder le même écart à l'écran.
 */
function LoopArrows({ coords, loop }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  // Le recadrage sur la spéciale (FitToStage) a lieu avant que l'écoute du zoom soit en place
  useEffect(() => setZoom(map.getZoom()), [map, coords]);

  const cumulative = useMemo(() => cumulativeDistances(coords), [coords]);
  const arrows = useMemo(() => {
    const pts = coords.map(([lon, lat]) => {
      const p = map.project([lat, lon], zoom);
      return [p.x, p.y];
    });
    // Portion commune : les flèches font le tour complet (portion + boucle)
    const range = [indexAtKm(cumulative, loop.sharedFromKm ?? loop.fromKm), indexAtKm(cumulative, loop.fromKm + loop.lengthKm)];
    const toLatLng = ([x, y]) => map.unproject([x, y], zoom);
    return loopArrows(pts, range).map(({ shaft, head }) => ({
      shaft: shaft.map(toLatLng),
      head: { position: toLatLng([head.x, head.y]), angle: head.angle },
    }));
  }, [map, coords, cumulative, loop, zoom]);

  return arrows.map(({ shaft, head }, i) => (
    <React.Fragment key={`${zoom}-${i}`}>
      <Polyline positions={shaft} pathOptions={STYLES.loopArrowCasing} />
      <Polyline positions={shaft} pathOptions={STYLES.loopArrow} />
      <Marker position={head.position} icon={arrowHeadIcon(head.angle)} interactive={false} keyboard={false} />
    </React.Fragment>
  ));
}

LoopArrows.propTypes = {
  coords: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.number)).isRequired,
  loop: PropTypes.shape({ fromKm: PropTypes.number, lengthKm: PropTypes.number, sharedFromKm: PropTypes.number }).isRequired,
};

/** Portion commune (parcourue deux fois) surlignée sous le tracé, avec un badge « 2× » en son milieu */
function SharedPortion({ coords, loop }) {
  const cumulative = useMemo(() => cumulativeDistances(coords), [coords]);
  const { positions, badge } = useMemo(() => {
    const from = indexAtKm(cumulative, loop.sharedFromKm);
    const to = indexAtKm(cumulative, loop.sharedFromKm + loop.sharedKm);
    const mid = pointAtKm(coords, cumulative, loop.sharedFromKm + loop.sharedKm / 2);
    return { positions: toLatLngs(coords.slice(from, to + 1)), badge: [mid[1], mid[0]] };
  }, [coords, cumulative, loop]);
  const secondKm = loop.fromKm + loop.lengthKm;
  return (
    <>
      <Polyline positions={positions} pathOptions={STYLES.sharedPortion} />
      <Marker position={badge} icon={sharedIcon} zIndexOffset={800}>
        <Tooltip direction="top" offset={[0, -12]}>
          Portion commune parcourue deux fois dans le même sens : km {loop.sharedFromKm.toFixed(2)} →{" "}
          {loop.fromKm.toFixed(2)}, puis km {secondKm.toFixed(2)} → {(secondKm + loop.sharedKm).toFixed(2)}
        </Tooltip>
      </Marker>
    </>
  );
}

SharedPortion.propTypes = {
  coords: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.number)).isRequired,
  loop: PropTypes.shape({
    sharedFromKm: PropTypes.number,
    sharedKm: PropTypes.number,
    fromKm: PropTypes.number,
    lengthKm: PropTypes.number,
  }).isRequired,
};

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
  sharedPortion: { color: LOOP_ARROW_COLOR, weight: 16, opacity: 0.45, lineCap: "round", interactive: false },
  loopArrowCasing: { color: "#ffffff", weight: 9, opacity: 0.95, lineCap: "round", interactive: false },
  loopArrow: { color: LOOP_ARROW_COLOR, weight: 5, opacity: 1, lineCap: "round", interactive: false },
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

/** Centre la carte sur la case sélectionnée (clic dans le roadbook) ; chaque clic relance le vol */
function FlyTo({ focus }) {
  const map = useMap();
  useEffect(() => {
    if (focus?.fly) map.flyTo([focus.coord[1], focus.coord[0]], Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [map, focus]);
  return null;
}

const focusIcon = new L.DivIcon({
  html: '<span class="focus-marker" aria-hidden="true"><span class="focus-pulse"></span><span class="focus-dot"></span></span>',
  className: "focus-marker-icon",
  iconSize: [44, 44],
  iconAnchor: [22, 22],
});

/** Case sélectionnée : point agrandi qui pulse, avec son étiquette affichée en permanence */
function FocusMarker({ roadbookCase }) {
  const { n, coord, km, direction, road } = roadbookCase;
  return (
    <Marker position={[coord[1], coord[0]]} icon={focusIcon} zIndexOffset={1200} interactive={false} keyboard={false}>
      <Tooltip permanent direction="top" offset={[0, -18]} className="focus-tooltip">
        <strong>Case {n}</strong> — km {km.toFixed(2)} — {direction}
        {road ? ` (${road})` : ""}
      </Tooltip>
    </Marker>
  );
}

FocusMarker.propTypes = {
  roadbookCase: PropTypes.shape({
    n: PropTypes.number.isRequired,
    coord: PropTypes.arrayOf(PropTypes.number).isRequired,
    km: PropTypes.number.isRequired,
    direction: PropTypes.string.isRequired,
    road: PropTypes.string,
  }).isRequired,
};

export default function MapView({
  stages = [],
  selectedIndex = 0,
  onSelect = () => {},
  searchArea = null,
  hoverPoint = null,
  focusedCase = null,
  onSelectCase = () => {},
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
          {selected.stats.loop?.kind === "shared" && (
            <SharedPortion coords={selected.geometry.coordinates} loop={selected.stats.loop} />
          )}
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
          {selected.stats.loop && <LoopArrows coords={selected.geometry.coordinates} loop={selected.stats.loop} />}

          {selected.stats.loop?.kind !== "shared" && selected.stats.loop && (
            <Marker position={[selected.stats.loop.coord[1], selected.stats.loop.coord[0]]} icon={loopIcon} zIndexOffset={800}>
              <Tooltip direction="top" offset={[0, -16]}>
                Carrefour de la boucle : 1er passage au km {selected.stats.loop.fromKm.toFixed(2)}, 2e au km{" "}
                {(selected.stats.loop.fromKm + selected.stats.loop.lengthKm).toFixed(2)}
              </Tooltip>
            </Marker>
          )}

          {selected.roadbook
            .filter((c) => c.type === "junction" || c.type === "surface")
            .map((c) => (
              <CircleMarker
                key={c.n}
                center={[c.coord[1], c.coord[0]]}
                radius={5}
                pathOptions={STYLES.pk}
                eventHandlers={{ click: () => onSelectCase(c) }}
              >
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

      {focusedCase && <FocusMarker key={focusedCase.n} roadbookCase={focusedCase} />}
      <FlyTo focus={focusedCase} />
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
  stats: PropTypes.shape({
    lengthKm: PropTypes.number,
    loop: PropTypes.shape({ fromKm: PropTypes.number, lengthKm: PropTypes.number, coord: PropTypes.arrayOf(PropTypes.number) }),
  }).isRequired,
});

MapView.propTypes = {
  stages: PropTypes.arrayOf(stageShape),
  selectedIndex: PropTypes.number,
  onSelect: PropTypes.func,
  searchArea: PropTypes.shape({ lat: PropTypes.number, lon: PropTypes.number, radiusKm: PropTypes.number }),
  hoverPoint: PropTypes.arrayOf(PropTypes.number),
  focusedCase: PropTypes.shape({
    n: PropTypes.number,
    coord: PropTypes.arrayOf(PropTypes.number),
    km: PropTypes.number,
    direction: PropTypes.string,
    road: PropTypes.string,
    fly: PropTypes.bool,
  }),
  onSelectCase: PropTypes.func,
};

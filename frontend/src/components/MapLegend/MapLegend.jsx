import React, { useState } from "react";
import PropTypes from "prop-types";
import { SURFACE_STYLES, LIAISON_COLOR, LOOP_ARROW_COLOR, ALTERNATIVE_COLOR, STOP_PATH_COLOR } from "../MapView";
import "./MapLegend.css";

const MOBILE_QUERY = "(max-width: 860px)";
const SEARCH_AREA_COLOR = "#5d6875";

/** Trait de légende (couleur, pointillés, épaisseur), éventuellement surligné comme la portion commune */
function Line({ color, dash = null, width = 4, halo = null }) {
  return (
    <svg className="legend-line" viewBox="0 0 28 14" aria-hidden="true">
      {halo && <line x1="3" y1="7" x2="25" y2="7" stroke={halo} strokeWidth="12" strokeOpacity="0.45" strokeLinecap="round" />}
      <line
        x1="2"
        y1="7"
        x2="26"
        y2="7"
        stroke={color}
        strokeWidth={width}
        strokeDasharray={dash ?? undefined}
        strokeLinecap={dash ? "butt" : "round"}
      />
    </svg>
  );
}

Line.propTypes = {
  color: PropTypes.string,
  dash: PropTypes.string,
  width: PropTypes.number,
  halo: PropTypes.string,
};

/** Flèche de sens de la boucle, comme sur la carte (trait bleu bordé de blanc, pointe) */
function LoopArrow() {
  return (
    <svg className="legend-line" viewBox="0 0 28 14" aria-hidden="true">
      <path d="M3 10 Q 11 3 19 7" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      <path d="M3 10 Q 11 3 19 7" fill="none" stroke={LOOP_ARROW_COLOR} strokeWidth="3" strokeLinecap="round" />
      <path d="M16 2 L26 8 L15 12 L18 7 Z" fill={LOOP_ARROW_COLOR} stroke="#fff" strokeWidth="1" />
    </svg>
  );
}

function Item({ symbol, children }) {
  return (
    <li>
      <span className="legend-symbol">{symbol}</span>
      <span>{children}</span>
    </li>
  );
}

Item.propTypes = { symbol: PropTypes.node.isRequired, children: PropTypes.node.isRequired };

/**
 * Légende de la carte : uniquement ce qui y est réellement dessiné (revêtements de la spéciale affichée, autres
 * tracés, liaisons, boucle…). Repliable ; repliée par défaut sur téléphone pour laisser la carte visible.
 */
export default function MapLegend({ stage, otherStages = 0, liaisons = [], searchArea = false, rallyOrder = false }) {
  const [open, setOpen] = useState(() => !(window.matchMedia?.(MOBILE_QUERY)?.matches ?? false));
  const { surfacePct, loop } = stage.stats;
  const mixed = surfacePct.paved < 100;
  const compromise = liaisons.some((l) => l.warnings?.length);
  const clean = liaisons.some((l) => !l.warnings?.length);

  return (
    <section className={`map-legend${open ? " open" : ""}`} aria-label="Légende de la carte">
      <button type="button" className="map-legend-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        Légende <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="map-legend-body">
          <h3>Tracés</h3>
          <ul>
            {mixed ? (
              <>
                {surfacePct.paved > 0 && <Item symbol={<Line color={SURFACE_STYLES.paved.color} />}>Spéciale : asphalte</Item>}
                {surfacePct.gravel > 0 && (
                  <Item symbol={<Line color={SURFACE_STYLES.gravel.color} />}>Spéciale : route empierrée</Item>
                )}
                {surfacePct.dirt > 0 && (
                  <Item symbol={<Line color={SURFACE_STYLES.dirt.color} dash="5 4" />}>Spéciale : chemin de terre</Item>
                )}
              </>
            ) : (
              <Item symbol={<Line color={SURFACE_STYLES.paved.color} />}>Spéciale affichée</Item>
            )}
            {otherStages > 0 && (
              <Item symbol={<Line color={ALTERNATIVE_COLOR} dash="6 4" />}>
                {otherStages > 1 ? "Autres tracés (cliquer pour les afficher)" : "Autre tracé (cliquer pour l'afficher)"}
              </Item>
            )}
            {clean && <Item symbol={<Line color={LIAISON_COLOR} />}>Liaison entre ES</Item>}
            {compromise && <Item symbol={<Line color={LIAISON_COLOR} dash="6 5" />}>Liaison avec compromis (⚠)</Item>}
            {stage.stop && <Item symbol={<Line color={STOP_PATH_COLOR} dash="2 4" width={3} />}>Vers le point stop</Item>}
            {searchArea && <Item symbol={<Line color={SEARCH_AREA_COLOR} dash="4 3" width={1.5} />}>Zone de recherche</Item>}
          </ul>

          <h3>Points</h3>
          <ul>
            <Item symbol={<span className="stage-flag start legend-flag">D</span>}>Départ</Item>
            <Item symbol={<span className="stage-flag finish legend-flag">A</span>}>Arrivée lancée</Item>
            {stage.stop && <Item symbol={<span className="stage-flag stop legend-flag">S</span>}>Point stop</Item>}
            <Item symbol={<span className="legend-dot" />}>Case du roadbook (cliquer pour la voir)</Item>
            {rallyOrder && <Item symbol={<span className="es-badge selected legend-es">ES1</span>}>Numéro d&apos;ES (ordre du rallye)</Item>}
          </ul>

          {loop && (
            <>
              <h3>Boucle</h3>
              <ul>
                {loop.kind === "shared" ? (
                  <Item symbol={<Line color={SURFACE_STYLES.paved.color} halo={LOOP_ARROW_COLOR} />}>Portion parcourue 2 fois</Item>
                ) : (
                  <Item symbol={<span className="loop-hub legend-hub" />}>Carrefour passé 2 fois</Item>
                )}
                <Item symbol={<LoopArrow />}>Sens de la boucle</Item>
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

MapLegend.propTypes = {
  stage: PropTypes.shape({
    stop: PropTypes.object,
    stats: PropTypes.shape({
      surfacePct: PropTypes.shape({ paved: PropTypes.number, gravel: PropTypes.number, dirt: PropTypes.number }).isRequired,
      loop: PropTypes.shape({ kind: PropTypes.string }),
    }).isRequired,
  }).isRequired,
  otherStages: PropTypes.number,
  liaisons: PropTypes.arrayOf(PropTypes.shape({ warnings: PropTypes.arrayOf(PropTypes.string) })),
  searchArea: PropTypes.bool,
  rallyOrder: PropTypes.bool,
};

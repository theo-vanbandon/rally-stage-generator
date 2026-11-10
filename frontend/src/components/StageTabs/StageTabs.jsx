import React, { useRef, useState } from "react";
import PropTypes from "prop-types";
import "./StageTabs.css";

const DRAG_THRESHOLD_PX = 5; // en dessous : c'est un clic (sélection), au-delà : on déplace l'onglet

/** Déplace l'élément d'indice `from` à l'indice `to` (les autres glissent d'un cran) */
export function moveItem(list, from, to) {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Déplacement horizontal limité au rail : l'onglet ne sort jamais de la barre */
export function clampToRail(dx, tab, rail) {
  return Math.max(rail.left - tab.left, Math.min(rail.right - tab.right, dx));
}

/**
 * Position où l'onglet glissé sera déposé : il dépasse un voisin dès que son bord atteint le milieu de ce voisin
 * (bord droit en allant à droite, bord gauche en allant à gauche). Les bouts du rail sont donc toujours
 * atteignables, même si les onglets n'ont pas tous la même largeur.
 * @param {{left: number, width: number}[]} rects - Onglets dans l'ordre affiché
 * @param {number} from - Onglet glissé
 * @param {number} dx - Déplacement horizontal (déjà limité au rail)
 */
export function dropPosition(rects, from, dx) {
  const middle = (r) => r.left + r.width / 2;
  const left = rects[from].left + dx;
  const right = left + rects[from].width;
  let position = from;
  for (let i = from + 1; i < rects.length; i++) if (right >= middle(rects[i])) position = i;
  for (let i = from - 1; i >= 0; i--) if (left <= middle(rects[i])) position = i;
  return position;
}

/**
 * Onglets des tracés, dans l'ordre du rallye (ES1, ES2…). Un clic sélectionne le tracé ; un glisser horizontal
 * change l'ordre, sur un rail : l'onglet ne quitte pas la barre. Clavier : Alt + ← / → déplace l'onglet.
 */
export default function StageTabs({ stages, order, selectedIndex, reversedTraces, onSelect, onReorder }) {
  const railRef = useRef(null);
  const [drag, setDrag] = useState(null);

  const startDrag = (e, position) => {
    if (e.button !== undefined && e.button !== 0) return;
    const tabs = [...railRef.current.querySelectorAll('[role="tab"]')];
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({
      position,
      startX: e.clientX,
      dx: 0,
      moved: false,
      rects: tabs.map((t) => t.getBoundingClientRect()),
      rail: railRef.current.getBoundingClientRect(),
    });
  };

  const moveDrag = (e) => {
    if (!drag) return;
    const raw = e.clientX - drag.startX;
    const moved = drag.moved || Math.abs(raw) > DRAG_THRESHOLD_PX;
    setDrag({ ...drag, moved, dx: moved ? clampToRail(raw, drag.rects[drag.position], drag.rail) : 0 });
  };

  const endDrag = (trace) => {
    if (!drag) return;
    if (drag.moved) {
      const to = dropPosition(drag.rects, drag.position, drag.dx);
      if (to !== drag.position) onReorder(moveItem(order, drag.position, to));
    } else {
      onSelect(trace);
    }
    setDrag(null);
  };

  // Pendant le glisser : les autres onglets s'écartent pour montrer où l'onglet sera déposé
  const target = drag?.moved ? dropPosition(drag.rects, drag.position, drag.dx) : null;
  const shiftOf = (position) => {
    if (!drag?.moved) return 0;
    if (position === drag.position) return drag.dx;
    const step = drag.rects[drag.position].width + (drag.rects[1] ? drag.rects[1].left - drag.rects[0].right : 0);
    if (drag.position < target && position > drag.position && position <= target) return -step;
    if (drag.position > target && position < drag.position && position >= target) return step;
    return 0;
  };

  // Numéros d'ES affichés : ceux de l'ordre qu'on obtiendrait en lâchant l'onglet maintenant
  const preview = target === null ? order : moveItem(order, drag.position, target);

  const onKeyDown = (e, position) => {
    if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    const to = position + (e.key === "ArrowLeft" ? -1 : 1);
    if (to < 0 || to >= order.length) return;
    e.preventDefault();
    onReorder(moveItem(order, position, to));
  };

  return (
    <div
      className={`proposals stage-tabs${drag?.moved ? " dragging" : ""}`}
      role="tablist"
      aria-label="Tracés proposés, dans l'ordre du rallye (glisser pour changer l'ordre)"
      ref={railRef}
    >
      {order.map((trace, position) => {
        const s = stages[trace];
        const isDragged = drag?.moved && drag.position === position;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={trace === selectedIndex}
            aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
            className={`${trace === selectedIndex ? "selected" : ""}${isDragged ? " dragged" : ""}`}
            style={{ transform: `translateX(${shiftOf(position)}px)` }}
            onPointerDown={(e) => startDrag(e, position)}
            onPointerMove={moveDrag}
            onPointerUp={() => endDrag(trace)}
            onPointerCancel={() => setDrag(null)}
            onClick={(e) => {
              // Clic au clavier (Entrée, Espace) : pas de pointeur
              if (e.detail === 0) onSelect(trace);
            }}
            onKeyDown={(e) => onKeyDown(e, position)}
          >
            <span className="stage-tab-es">ES{preview.indexOf(trace) + 1}</span>
            <strong>Tracé {trace + 1}</strong>
            <small>
              {s.stats.lengthKm.toFixed(1)} km{reversedTraces.includes(trace) ? " · inverse" : ""}
            </small>
          </button>
        );
      })}
    </div>
  );
}

StageTabs.propTypes = {
  stages: PropTypes.arrayOf(
    PropTypes.shape({ id: PropTypes.string, stats: PropTypes.shape({ lengthKm: PropTypes.number }) })
  ).isRequired,
  order: PropTypes.arrayOf(PropTypes.number).isRequired,
  selectedIndex: PropTypes.number.isRequired,
  reversedTraces: PropTypes.arrayOf(PropTypes.number).isRequired,
  onSelect: PropTypes.func.isRequired,
  onReorder: PropTypes.func.isRequired,
};

import React from "react";
import PropTypes from "prop-types";
import "./RoadbookPicker.css";

/**
 * Roadbooks du rallye, dans l'ordre : ES1 · L1 · ES2 · L2 · ES3. Par défaut le roadbook affiché est celui de la
 * spéciale sélectionnée sur la carte ; on peut en choisir un autre ici (une autre spéciale ou une liaison).
 * @param {{key: string, label: string, title: string, kind: "stage"|"liaison", disabled?: boolean}[]} items
 */
export default function RoadbookPicker({ items, value, onChange }) {
  return (
    <div className="roadbook-picker" role="radiogroup" aria-label="Roadbook affiché">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="radio"
          aria-checked={item.key === value}
          className={`roadbook-pick roadbook-pick--${item.kind}${item.key === value ? " selected" : ""}`}
          title={item.title}
          disabled={item.disabled}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

RoadbookPicker.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      key: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      title: PropTypes.string.isRequired,
      kind: PropTypes.oneOf(["stage", "liaison"]).isRequired,
      disabled: PropTypes.bool,
    })
  ).isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
};

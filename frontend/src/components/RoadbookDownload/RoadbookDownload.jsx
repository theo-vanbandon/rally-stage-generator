import React, { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import "./RoadbookDownload.css";

const FORMATS = [
  { value: "a5", label: "A5", hint: "format roadbook" },
  { value: "a4", label: "A4", hint: "plus grand" },
];

/**
 * Popup de téléchargement du roadbook (PDF) : épreuves à inclure, dans l'ordre du rallye, nom de chaque spéciale
 * (« ES1 » par défaut), page de garde (nom du rallye, ville d'accueil) et format.
 * @param {object[]} entries - Dans l'ordre du rallye : { key, kind: "stage"|"liaison", label, detail, title?, disabled? }
 */
export default function RoadbookDownload({ entries, defaultHostTown = "", onClose, onDownload }) {
  const [checked, setChecked] = useState(() => new Set(entries.filter((e) => !e.disabled).map((e) => e.key)));
  const [names, setNames] = useState(() =>
    Object.fromEntries(entries.filter((e) => e.kind === "stage").map((e) => [e.key, e.label]))
  );
  const [rallyName, setRallyName] = useState("");
  const [hostTown, setHostTown] = useState(defaultHostTown);
  const [format, setFormat] = useState("a5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstFieldRef = useRef(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (key) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onDownload({
        keys: entries.filter((en) => checked.has(en.key)).map((en) => en.key),
        names: Object.fromEntries(Object.entries(names).map(([key, name]) => [key, name.trim() || entries.find((en) => en.key === key).label])),
        rallyName: rallyName.trim(),
        hostTown: hostTown.trim(),
        format,
      });
      onClose();
    } catch (err) {
      setError(err.message || "Le roadbook n'a pas pu être créé.");
      setBusy(false);
    }
  };

  return (
    <div className="rbd-backdrop" onClick={onClose} role="presentation">
      <form
        className="rbd-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rbd-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <header className="rbd-header">
          <h2 id="rbd-title">Télécharger le roadbook</h2>
          <button type="button" className="rbd-close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </header>

        <fieldset className="rbd-cover">
          <legend>Page de garde</legend>
          <label>
            Nom du rallye
            <input
              ref={firstFieldRef}
              type="text"
              value={rallyName}
              placeholder="Rallye des Routes du Nord"
              maxLength={80}
              onChange={(e) => setRallyName(e.target.value)}
            />
          </label>
          <label>
            Ville d'accueil
            <input type="text" value={hostTown} maxLength={60} onChange={(e) => setHostTown(e.target.value)} />
          </label>
        </fieldset>

        <fieldset className="rbd-items">
          <legend>Épreuves, dans l'ordre du rallye</legend>
          <ul>
            {entries.map((entry) => (
              <li key={entry.key} className={`rbd-item rbd-item--${entry.kind}${checked.has(entry.key) ? "" : " off"}`}>
                <input
                  type="checkbox"
                  checked={checked.has(entry.key)}
                  disabled={entry.disabled}
                  onChange={() => toggle(entry.key)}
                  aria-label={`Inclure ${entry.kind === "stage" ? entry.label : entry.title}`}
                />
                <span className="rbd-badge">{entry.label}</span>
                {entry.kind === "stage" ? (
                  <input
                    type="text"
                    className="rbd-name"
                    value={names[entry.key]}
                    maxLength={60}
                    aria-label={`Nom de l'${entry.label}`}
                    onChange={(e) => setNames((prev) => ({ ...prev, [entry.key]: e.target.value }))}
                  />
                ) : (
                  <span className="rbd-title">{entry.title}</span>
                )}
                <small>{entry.detail}</small>
              </li>
            ))}
          </ul>
        </fieldset>

        <fieldset className="rbd-format">
          <legend>Format</legend>
          {FORMATS.map((f) => (
            <label key={f.value} className={format === f.value ? "checked" : ""}>
              <input type="radio" name="rbd-format" value={f.value} checked={format === f.value} onChange={() => setFormat(f.value)} />
              <strong>{f.label}</strong>
              <small>{f.hint}</small>
            </label>
          ))}
        </fieldset>

        {error && (
          <p className="rbd-error" role="alert">
            {error}
          </p>
        )}

        <footer className="rbd-actions">
          <button type="button" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="rbd-submit" disabled={busy || checked.size === 0}>
            {busy ? "Création du PDF…" : "Télécharger le PDF"}
          </button>
        </footer>
      </form>
    </div>
  );
}

RoadbookDownload.propTypes = {
  entries: PropTypes.arrayOf(
    PropTypes.shape({
      key: PropTypes.string.isRequired,
      kind: PropTypes.oneOf(["stage", "liaison"]).isRequired,
      label: PropTypes.string.isRequired,
      title: PropTypes.string,
      detail: PropTypes.string,
      disabled: PropTypes.bool,
    })
  ).isRequired,
  defaultHostTown: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onDownload: PropTypes.func.isRequired,
};

import React, { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { searchCommunes } from "../../services/api";
import "./CommuneSearch.css";

const DEBOUNCE_MS = 250;

/**
 * Champ de recherche de commune avec suggestions (nom ou code postal)
 */
export default function CommuneSearch({ value, onSelect }) {
  const [query, setQuery] = useState(value ? `${value.name} (${value.postal})` : "");
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const skipNextSearch = useRef(false);

  useEffect(() => {
    if (value) {
      skipNextSearch.current = true;
      setQuery(`${value.name} (${value.postal})`);
    }
  }, [value]);

  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchCommunes(query, { signal: controller.signal })
        .then((results) => {
          setSuggestions(results);
          setActive(results.length ? 0 : -1);
          setOpen(results.length > 0);
        })
        .catch(() => {});
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const choose = (commune) => {
    setOpen(false);
    onSelect(commune);
  };

  const onKeyDown = (e) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(suggestions[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="commune-search">
      <input
        id="commune"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="commune-suggestions"
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        placeholder="Nom ou code postal (ex : Gap, 05000)"
        onChange={(e) => {
          skipNextSearch.current = false;
          setQuery(e.target.value);
          if (value) onSelect(null);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <ul id="commune-suggestions" className="commune-suggestions" role="listbox">
          {suggestions.map((c, i) => (
            <li
              key={`${c.name}-${c.postal}-${c.department}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(c);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="commune-name">{c.name}</span>
              <span className="commune-meta">
                {c.postal} · {c.department}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

CommuneSearch.propTypes = {
  value: PropTypes.shape({
    name: PropTypes.string,
    postal: PropTypes.string,
  }),
  onSelect: PropTypes.func.isRequired,
};

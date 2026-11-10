import { useEffect, useRef, useState } from "react";
import { computeLiaisons } from "../services/api";

const DEBOUNCE_MS = 250; // plusieurs clics rapides sur l'ordre : un seul calcul

/**
 * Liaisons entre les spéciales, recalculées dès que l'ordre ou le sens d'une spéciale change
 * @param {{lat: number, lon: number}|null} center - Centre de la génération
 * @param {number|null} radiusKm - Rayon de la génération
 * @param {object[]} stages - Spéciales dans l'ordre du rallye, chacune dans son sens
 * @returns {{status: "idle"|"loading"|"done"|"error", liaisons: object[], error?: string}}
 */
export default function useLiaisons(center, radiusKm, stages) {
  const [state, setState] = useState({ status: "idle", liaisons: [] });
  const stagesRef = useRef(stages);
  stagesRef.current = stages;
  // Chaque sens a son propre identifiant : la clé change avec l'ordre comme avec le sens
  const key = stages.length >= 2 ? stages.map((s) => s.id).join("|") : "";
  const lat = center?.lat;
  const lon = center?.lon;

  useEffect(() => {
    if (!key || lat === undefined || !radiusKm) {
      setState({ status: "idle", liaisons: [] });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: "loading", liaisons: [] });
    const timer = setTimeout(async () => {
      try {
        const data = await computeLiaisons({ lat, lon, radiusKm, stages: stagesRef.current }, { signal: controller.signal });
        setState({ status: "done", liaisons: data.liaisons });
      } catch (err) {
        if (err.name !== "AbortError") setState({ status: "error", liaisons: [], error: err.message });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, lat, lon, radiusKm]);

  return state;
}

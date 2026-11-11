import { useEffect, useRef, useState } from "react";
import { computeWaterPoints } from "../services/api";

/**
 * Points de vigilance eau de chaque spéciale affichée (dans son sens), recalculés si une spéciale change de sens
 * @param {object[]} stages - Spéciales affichées
 * @returns {{status: "idle"|"loading"|"done"|"error", points: object[][], error?: string}} points[i] : spéciale i
 */
export default function useWaterPoints(stages) {
  const [state, setState] = useState({ status: "idle", points: [] });
  const stagesRef = useRef(stages);
  stagesRef.current = stages;
  const key = stages.map((s) => s.id).join("|");

  useEffect(() => {
    if (!key) {
      setState({ status: "idle", points: [] });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: "loading", points: [] });
    computeWaterPoints(stagesRef.current, { signal: controller.signal })
      .then((data) => setState({ status: "done", points: data.points }))
      .catch((err) => {
        if (err.name !== "AbortError") setState({ status: "error", points: [], error: err.message });
      });
    return () => controller.abort();
  }, [key]);

  return state;
}

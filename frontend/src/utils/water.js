/**
 * Textes des points de vigilance eau (plongeurs), partagés par la carte et le panneau
 */

export const WATER_LEVELS = {
  divers: { label: "Plongeurs recommandés", short: "Plongeurs" },
  watch: { label: "À surveiller", short: "À surveiller" },
};

/** « Lac du Ganivet » ou « plan d'eau » / « rivière » / « canal » */
const waterName = (p) => p.name || p.kind;

/** « Lac du Ganivet à droite, à 3 m » ; « Rivière sous la route » pour un pont */
export function waterWhere(p) {
  const name = waterName(p);
  const capital = name.charAt(0).toUpperCase() + name.slice(1);
  if (p.side === "pont") return `${capital} sous la route`;
  return `${capital} à ${p.side}, à ${p.distanceM} m de la route`;
}

/** « extérieur de virage, arrivée rapide » */
export const waterReasons = (p) => p.reasons.filter((r) => r !== "pont" || p.side !== "pont").join(", ");

/** Texte complet d'un point, pour une info-bulle */
export function waterLabel(p) {
  const reasons = waterReasons(p);
  return `${WATER_LEVELS[p.level].label} — km ${p.km.toFixed(2)} — ${waterWhere(p)}${reasons ? ` (${reasons})` : ""}`;
}

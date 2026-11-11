import { waterLabel, waterWhere, waterReasons } from '../../utils/water';

const base = { level: 'divers', km: 4.23, side: 'droite', kind: "plan d'eau", name: "Lac de l'Aulagnier", distanceM: 3, reasons: ['extérieur de virage', 'pont'] };

describe('textes de vigilance eau', () => {
  test('nom, côté et distance', () => {
    expect(waterWhere(base)).toBe("Lac de l'Aulagnier à droite, à 3 m de la route");
    expect(waterWhere({ ...base, name: null, kind: 'rivière', side: 'gauche', distanceM: 8 })).toBe('Rivière à gauche, à 8 m de la route');
  });

  test('raisons', () => {
    expect(waterReasons(base)).toBe('extérieur de virage, pont');
  });

  test('info-bulle complète', () => {
    expect(waterLabel(base)).toBe("Plongeurs recommandés — km 4.23 — Lac de l'Aulagnier à droite, à 3 m de la route (extérieur de virage, pont)");
    expect(waterLabel({ ...base, level: 'watch', reasons: [] })).toBe("À surveiller — km 4.23 — Lac de l'Aulagnier à droite, à 3 m de la route");
  });
});

const { waterPoints, trackBox } = require('../../services/water');
const { CENTER } = require('../fixtures/network');

// Repère local en mètres autour de CENTER
const M_LAT = 1 / 111320;
const M_LON = 1 / (111320 * Math.cos((CENTER.lat * Math.PI) / 180));
const at = (x, y) => [CENTER.lon + x * M_LON, CENTER.lat + y * M_LAT];
const rect = (x0, y0, x1, y1) => [[at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)]];

// Route : 300 m vers le nord, puis virage à gauche et 300 m vers l'ouest (un point tous les 10 m)
const road = [
  ...Array.from({ length: 31 }, (_, i) => at(0, i * 10)),
  ...Array.from({ length: 30 }, (_, i) => at(-(i + 1) * 10, 300)),
];

const lake = (polygon, nature = 'Retenue', name = 'Étang test') => ({
  geometry: { type: 'MultiPolygon', coordinates: [polygon] },
  properties: { nature, cpx_toponyme_de_plan_d_eau: name },
});
const water = ({ surfaces = [], lines = [] }) => ({ surfaces, lines });

describe('Vigilance eau', () => {
  test("étang à l'extérieur du virage, tout près : plongeurs recommandés", () => {
    // Au-delà du virage, au nord : une voiture qui rate le virage à gauche continue tout droit dans l'eau
    const points = waterPoints(road, water({ surfaces: [lake(rect(-150, 305, 150, 450))] }));
    expect(points).toHaveLength(1);
    expect(points[0]).toEqual(
      expect.objectContaining({ level: 'divers', kind: "plan d'eau", name: 'Étang test', distanceM: 5 })
    );
    expect(points[0].reasons).toContain('extérieur de virage');
    expect(points[0].km).toBeGreaterThan(0.2);
    expect(points[0].km).toBeLessThan(0.4);
  });

  test("le même étang à l'intérieur du virage : seulement à surveiller", () => {
    const points = waterPoints(road, water({ surfaces: [lake(rect(-150, 100, -5, 295))] }));
    expect(points).toHaveLength(1);
    expect(points[0].level).toBe('watch');
    expect(points[0].side).toBe('gauche');
  });

  test("ni les mares, ni l'eau trop loin de la route", () => {
    // Mare de 30 m × 30 m (0,09 ha) à l'extérieur du virage
    expect(waterPoints(road, water({ surfaces: [lake(rect(-15, 305, 15, 335))] }))).toEqual([]);
    // Grand étang à 25 m
    expect(waterPoints(road, water({ surfaces: [lake(rect(-150, 325, 150, 450))] }))).toEqual([]);
  });

  test("un simple pont n'est pas signalé (parapets)", () => {
    const river = {
      geometry: { type: 'LineString', coordinates: [at(-200, 150), at(200, 150)] },
      properties: { nature: 'Ecoulement naturel', classe_de_largeur: 'Entre 15 et 50 m', cpx_toponyme_de_cours_d_eau: 'la Rivière' },
    };
    expect(waterPoints(road, water({ lines: [river] }))).toEqual([]);
  });

  test("jamais plus d'un point « plongeurs » par spéciale : le plus exposé", () => {
    // Deux virages au-dessus de l'eau : un à droite (km 0.3), un à gauche (km 0.6)
    const zigzag = [
      ...Array.from({ length: 31 }, (_, i) => at(0, i * 10)),
      ...Array.from({ length: 30 }, (_, i) => at((i + 1) * 10, 300)),
      ...Array.from({ length: 30 }, (_, i) => at(300, 300 + (i + 1) * 10)),
    ];
    const points = waterPoints(
      zigzag,
      water({
        surfaces: [
          lake(rect(-150, 305, -5, 450), 'Retenue', 'Étang A'), // extérieur du 1er virage (à droite)
          lake(rect(305, 150, 450, 295), 'Retenue', 'Étang B'), // extérieur du 2e virage (à gauche)
        ],
      })
    );
    expect(points.filter((p) => p.level === 'divers')).toHaveLength(1);
    expect(points.filter((p) => p.level === 'watch').length).toBeGreaterThanOrEqual(1);
  });

  test('aucune eau : aucun point', () => {
    expect(waterPoints(road, water({}))).toEqual([]);
  });

  test('rectangle de recherche serré autour du tracé', () => {
    const [s, w, n, e] = trackBox(road);
    expect(s).toBeLessThan(CENTER.lat);
    expect(n).toBeGreaterThan(CENTER.lat + 300 * M_LAT);
    expect(w).toBeLessThan(CENTER.lon - 300 * M_LON);
    expect(e - w).toBeLessThan(0.01); // pas toute la zone : quelques centaines de mètres
  });
});

const {
  buildNetwork,
  dropDenseUrbanAreas,
  isDrivable,
  isLinkRoad,
  surfaceOf,
  basePreference,
  measureShape,
  fillElevations,
} = require('../../services/roadNetwork');
const { createProjection } = require('../../utils/geometry');
const { segment, wiggly, gridSegments, CENTER } = require('../fixtures/network');

describe('Road Network Service', () => {
  describe('surfaceOf / isDrivable', () => {
    test('devrait classer les revêtements selon la nature IGN', () => {
      expect(surfaceOf({ nature: 'Route à 1 chaussée' })).toBe('paved');
      expect(surfaceOf({ nature: 'Route empierrée' })).toBe('gravel');
      expect(surfaceOf({ nature: 'Chemin' })).toBe('dirt');
      expect(surfaceOf({ nature: 'Route à 2 chaussées' })).toBeNull();
    });

    test('devrait accepter une petite route ouverte à la circulation', () => {
      expect(isDrivable(segment([]))).toBe(true);
    });

    test.each([
      ['accès restreint', { access: 'Restreint aux ayants droit' }],
      ['route privée', { private: true }],
      ['voie verte', { greenway: true }],
      ['sens unique', { direction: 'Sens direct' }],
      ['route nationale', { importance: 2 }],
      ['quatre voies', { nature: 'Route à 2 chaussées' }],
      ['gué', { level: 'Gué ou radier' }],
    ])('devrait exclure : %s', (_, overrides) => {
      expect(isDrivable(segment([], overrides))).toBe(false);
    });
  });

  describe('basePreference', () => {
    test('devrait préférer les petites routes étroites aux grands axes', () => {
      const narrow = basePreference(segment([], { importance: 5, width: 3.5 }));
      const wide = basePreference(segment([], { importance: 3, width: 7 }));
      expect(narrow).toBeGreaterThan(wide);
    });
  });

  describe('measureShape', () => {
    test('une route droite ne doit avoir ni sinuosité ni virage', () => {
      const shape = measureShape([[6, 44], [6, 44.01]]);
      expect(shape.twistDeg).toBe(0);
      expect(shape.straightKm).toBeCloseTo(1.11, 1);
      expect(shape.headStart).toBeCloseTo(0, 0);
    });

    test('une route sinueuse doit cumuler du virage et peu de ligne droite', () => {
      const coords = wiggly([6, 44], [6.01, 44]).map(([lon, lat]) => [lon, lat]);
      const shape = measureShape(coords);
      expect(shape.twistDeg).toBeGreaterThan(200);
      expect(shape.longestStraightKm).toBeLessThan(0.3);
    });
  });

  describe('fillElevations', () => {
    test('devrait interpoler les altitudes manquantes', () => {
      expect(fillElevations([[0, 0, 100], [0, 0, null], [0, 0, 200]])).toEqual([100, 150, 200]);
      expect(fillElevations([[0, 0, null], [0, 0, 120]])).toEqual([120, 120]);
      expect(fillElevations([[0, 0, null], [0, 0, null]])).toEqual([null, null]);
    });
  });

  describe('dropDenseUrbanAreas', () => {
    const projection = createProjection(CENTER.lat, CENTER.lon);
    const shift = (segments, dLon) =>
      segments.map((s) => ({ ...s, coords: s.coords.map(([lon, lat, z]) => [lon + dLon, lat, z]) }));
    const straightGrid = (size, step, overrides) => {
      const segs = [];
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          const p = [6 + i * step, 44.5 + j * step, 0];
          if (i + 1 < size) segs.push(segment([p, [p[0] + step, p[1], 0]], overrides));
          if (j + 1 < size) segs.push(segment([p, [p[0], p[1] + step, 0]], overrides));
        }
      }
      return segs;
    };

    test('devrait supprimer un centre urbain dense (rues tous les 100 m)', () => {
      const town = straightGrid(8, 0.001, { urban: true });
      const kept = dropDenseUrbanAreas(town, projection);
      // Seules quelques rues de lisière, moins denses, peuvent subsister
      expect(kept.length / town.length).toBeLessThan(0.05);
      expect(kept.every((s) => s.coords.some(([lon, lat]) => lon >= 6.006 || lat >= 44.506))).toBe(true);
    });

    test('devrait garder une route de campagne bordée de maisons et un hameau', () => {
      // Route de 3 km entièrement "urbaine" (habitat en ruban) + petit hameau
      const ribbon = [0, 1, 2].map((i) => segment([[6 + i * 0.013, 44.5, 0], [6 + (i + 1) * 0.013, 44.5, 0]], { urban: true }));
      const hamlet = shift(straightGrid(2, 0.002, { urban: true }), 0.1);
      const rural = shift(gridSegments({ size: 2 }), 0.2);
      const segments = [...ribbon, ...hamlet, ...rural];
      expect(dropDenseUrbanAreas(segments, projection)).toHaveLength(segments.length);
    });
  });

  describe('isLinkRoad', () => {
    test('devrait accepter toute route publique, y compris un grand axe', () => {
      expect(isLinkRoad(segment([], { importance: 1, nature: 'Route à 2 chaussées' }))).toBe(true);
      expect(isLinkRoad(segment([], { urban: true }))).toBe(true);
    });

    test('devrait refuser chemins de terre, routes privées et accès restreints', () => {
      expect(isLinkRoad(segment([], { nature: 'Chemin' }))).toBe(false);
      expect(isLinkRoad(segment([], { private: true }))).toBe(false);
      expect(isLinkRoad(segment([], { access: 'Restreint aux ayants droit' }))).toBe(false);
    });
  });

  describe('buildNetwork', () => {
    test('devrait marquer comme ancres les grands axes et le bord de la zone', () => {
      const segments = [
        segment([[6, 44.5, 0], [6.05, 44.5, 0]]),
        segment([[6.05, 44.5, 0], [6.1, 44.5, 0]]),
        segment([[6.05, 44.5, 0], [6.05, 44.55, 0]], { importance: 2, nature: 'Route à 2 chaussées' }),
        segment([[6.02, 44.52, 0], [6.03, 44.52, 0]]),
      ];
      const network = buildNetwork(segments, CENTER);
      const anchorAt = (lon, lat) => network.nodes.find((n) => n.coord[0] === lon && n.coord[1] === lat).anchor;

      expect(anchorAt(6.05, 44.5)).toBe(true); // touche la route d'importance 2
      expect(anchorAt(6, 44.5)).toBe(true); // bord ouest
      expect(anchorAt(6.02, 44.52)).toBe(false); // intérieur
      expect(network.edges).toHaveLength(3); // la 2x2 voies n'est pas roulable en spéciale
      expect(network.nodes.find((n) => n.coord[0] === 6.05 && n.coord[1] === 44.5).links).toHaveLength(3);
    });

    test('devrait garder les rues des villes pour la liaison, pas pour la spéciale', () => {
      const city = [];
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          const p = [6 + i * 0.001, 44.5 + j * 0.001, 0];
          if (i < 7) city.push(segment([p, [p[0] + 0.001, p[1], 0]], { urban: true }));
          if (j < 7) city.push(segment([p, [p[0], p[1] + 0.001, 0]], { urban: true }));
        }
      }
      const network = buildNetwork(city, CENTER);
      expect(network.edges.length / city.length).toBeLessThan(0.05);
      expect(network.nodes.every((n) => n.anchor && n.links.length > 0)).toBe(true);
    });

    test('devrait relier les tronçons par leurs extrémités communes', () => {
      const network = buildNetwork(gridSegments({ size: 3 }), CENTER);
      expect(network.nodes).toHaveLength(9);
      expect(network.edges).toHaveLength(12);
      const center = network.nodes.find((n) => n.edges.length === 4);
      expect(center).toBeDefined();
      expect(center.roadDegree).toBe(4);
    });

    test('devrait ignorer les tronçons non roulables mais les compter dans les intersections', () => {
      const segments = gridSegments({ size: 2, overrides: (i, j, dir) => (dir === 'h' && j === 0 ? { private: true } : {}) });
      const network = buildNetwork(segments, CENTER);
      expect(network.edges).toHaveLength(3);
      expect(network.nodes.reduce((sum, n) => sum + n.roadDegree, 0)).toBe(8);
    });

    test('devrait calculer longueur, sinuosité et altitudes de chaque tronçon', () => {
      const [edge] = buildNetwork([segment(wiggly([6, 44.5], [6, 44.51]))], CENTER).edges;
      expect(edge.lengthKm).toBeGreaterThan(1.1);
      expect(edge.twistDeg).toBeGreaterThan(100);
      expect(edge.z[0]).toBe(500);
      expect(edge.z.at(-1)).toBe(540);
      expect(edge.samples.length % 2).toBe(0);
    });
  });
});

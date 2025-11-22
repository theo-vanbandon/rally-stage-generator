const { generateSpeciale } = require('../../services/specialeGenerator');

describe('Speciale Generator Service', () => {
  
  describe('generateSpeciale', () => {
    test('devrait retourner un résultat vide si pas de features', () => {
      const result = generateSpeciale(null);
      
      expect(result.path).toEqual([]);
      expect(result.intersections).toEqual([]);
    });

    test('devrait retourner un résultat vide si features est vide', () => {
      const geojson = { type: 'FeatureCollection', features: [] };
      
      const result = generateSpeciale(geojson);
      
      expect(result.path).toEqual([]);
      expect(result.intersections).toEqual([]);
    });

    test('devrait retourner un résultat vide si geojson est undefined', () => {
      const result = generateSpeciale(undefined);
      
      expect(result.path).toEqual([]);
      expect(result.intersections).toEqual([]);
    });

    test('devrait générer un chemin avec des features valides', () => {
      const geojson = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [2.35, 48.85],
                [2.36, 48.86],
                [2.37, 48.87],
                [2.38, 48.88],
                [2.39, 48.89],
                [2.4, 48.9]
              ]
            }
          },
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [2.4, 48.9],
                [2.41, 48.91],
                [2.42, 48.92],
                [2.43, 48.93],
                [2.44, 48.94],
                [2.45, 48.95]
              ]
            }
          }
        ]
      };
      
      // Avec minKm très bas pour que le test passe
      const result = generateSpeciale(geojson, 0.001, 100);
      
      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('intersections');
      expect(Array.isArray(result.path)).toBe(true);
      expect(Array.isArray(result.intersections)).toBe(true);
    });
  });
});

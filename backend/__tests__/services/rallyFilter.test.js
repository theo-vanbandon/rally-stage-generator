const { filterRallyeWays } = require('../../services/rallyFilter');

describe('Rally Filter Service', () => {
  
  const createFeature = (highway, surface = null, length = 0.5) => ({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [[0, 0], [length * 0.01, 0]] // Approximation
    },
    properties: {
      highway,
      surface
    }
  });

  describe('filterRallyeWays', () => {
    test('devrait garder les routes de type "track"', () => {
      const geojson = {
        type: 'FeatureCollection',
        features: [createFeature('track')]
      };
      
      const result = filterRallyeWays(geojson);
      expect(result.features.length).toBe(1);
    });

    test('devrait garder les routes de type "unclassified"', () => {
      const geojson = {
        type: 'FeatureCollection',
        features: [createFeature('unclassified')]
      };
      
      const result = filterRallyeWays(geojson);
      expect(result.features.length).toBe(1);
    });

    test('devrait exclure les autoroutes', () => {
      const geojson = {
        type: 'FeatureCollection',
        features: [createFeature('motorway')]
      };
      
      const result = filterRallyeWays(geojson);
      expect(result.features.length).toBe(0);
    });

    test('devrait exclure les chemins piétons', () => {
      const geojson = {
        type: 'FeatureCollection',
        features: [createFeature('footway')]
      };
      
      const result = filterRallyeWays(geojson);
      expect(result.features.length).toBe(0);
    });

    test('devrait exclure les pistes cyclables', () => {
      const geojson = {
        type: 'FeatureCollection',
        features: [createFeature('cycleway')]
      };
      
      const result = filterRallyeWays(geojson);
      expect(result.features.length).toBe(0);
    });

    test('devrait garder les routes avec surface "gravel"', () => {
      const geojson = {
        type: 'FeatureCollection',
        features: [createFeature('track', 'gravel')]
      };
      
      const result = filterRallyeWays(geojson);
      expect(result.features.length).toBe(1);
    });

    test('devrait exclure les routes avec surface "cobblestone"', () => {
      const feature = createFeature('unclassified', 'cobblestone');
      const geojson = {
        type: 'FeatureCollection',
        features: [feature]
      };
      
      const result = filterRallyeWays(geojson);
      expect(result.features.length).toBe(0);
    });
  });
});

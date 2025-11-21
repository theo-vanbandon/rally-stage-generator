const { osmJsonToGeoJson, coordsToGeoJSON } = require('../../services/geojsonConverter');

describe('GeoJSON Converter Service', () => {
  
  describe('osmJsonToGeoJson', () => {
    test('devrait retourner un GeoJSON vide si pas de données', () => {
      const result = osmJsonToGeoJson(null);
      
      expect(result.geojson.type).toBe('FeatureCollection');
      expect(result.geojson.features).toEqual([]);
      expect(result.stats.waysCount).toBe(0);
      expect(result.stats.totalKm).toBe(0);
    });

    test('devrait retourner un GeoJSON vide si elements est vide', () => {
      const result = osmJsonToGeoJson({ elements: [] });
      
      expect(result.geojson.features).toEqual([]);
      expect(result.stats.waysCount).toBe(0);
    });

    test('devrait retourner un GeoJSON vide si elements est undefined', () => {
      const result = osmJsonToGeoJson({});
      
      expect(result.geojson.features).toEqual([]);
    });
  });

  describe('coordsToGeoJSON', () => {
    test('devrait convertir des coordonnées en GeoJSON', () => {
      const coords = [[2.35, 48.85], [2.36, 48.86], [2.37, 48.87]];
      
      const result = coordsToGeoJSON(coords);
      
      expect(result.type).toBe('FeatureCollection');
      expect(result.features.length).toBe(1);
      expect(result.features[0].geometry.type).toBe('LineString');
      expect(result.features[0].geometry.coordinates).toEqual(coords);
    });

    test('devrait retourner un GeoJSON vide si coordonnées null', () => {
      const result = coordsToGeoJSON(null);
      
      expect(result.type).toBe('FeatureCollection');
      expect(result.features).toEqual([]);
    });

    test('devrait retourner un GeoJSON vide si moins de 2 coordonnées', () => {
      const result = coordsToGeoJSON([[2.35, 48.85]]);
      
      expect(result.features).toEqual([]);
    });

    test('devrait retourner un GeoJSON vide si tableau vide', () => {
      const result = coordsToGeoJSON([]);
      
      expect(result.features).toEqual([]);
    });
  });
});

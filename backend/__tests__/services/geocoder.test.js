const { geocode } = require('../../services/geocoder');

describe('Geocoder Service', () => {
  
  // Tests d'intégration (nécessitent une connexion internet)
  describe('geocode - integration', () => {
    
    test('devrait géocoder Paris correctement', async () => {
      const result = await geocode('Paris', null);
      
      expect(result).toHaveProperty('lat');
      expect(result).toHaveProperty('lon');
      expect(result.lat).toBeCloseTo(48.86, 0);
      expect(result.lon).toBeCloseTo(2.34, 0);
    }, 10000);

    test('devrait géocoder Gap correctement', async () => {
      const result = await geocode('Gap', '05000');
      
      expect(result).toHaveProperty('lat');
      expect(result).toHaveProperty('lon');
      expect(result.lat).toBeCloseTo(44.56, 0);
      expect(result.lon).toBeCloseTo(6.08, 0);
    }, 10000);

    test('devrait géocoder Marseille correctement', async () => {
      const result = await geocode('Marseille', null);
      
      expect(result).toHaveProperty('lat');
      expect(result).toHaveProperty('lon');
      expect(result.lat).toBeCloseTo(43.30, 0);
      expect(result.lon).toBeCloseTo(5.37, 0);
    }, 10000);

    test('devrait rejeter une ville inexistante', async () => {
      await expect(geocode('VilleQuiNExistePas123', '00000'))
        .rejects
        .toThrow();
    }, 10000);
  });
});

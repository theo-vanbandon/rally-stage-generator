import { haversineDistance } from '../../utils/geometry';

describe('Geometry Utils', () => {
  
  describe('haversineDistance', () => {
    test('devrait calculer la distance entre deux points', () => {
      // Paris à Lyon ~ 392 km
      const paris = [2.3522, 48.8566];
      const lyon = [4.8357, 45.7640];
      
      const distance = haversineDistance(paris, lyon);
      
      expect(distance).toBeGreaterThan(380);
      expect(distance).toBeLessThan(410);
    });

    test('devrait retourner 0 pour le même point', () => {
      const point = [2.3522, 48.8566];
      
      const distance = haversineDistance(point, point);
      
      expect(distance).toBe(0);
    });

    test('devrait calculer correctement une petite distance', () => {
      // Deux points proches (~1km)
      const point1 = [2.3522, 48.8566];
      const point2 = [2.3622, 48.8566];
      
      const distance = haversineDistance(point1, point2);
      
      expect(distance).toBeGreaterThan(0.5);
      expect(distance).toBeLessThan(1.5);
    });
  });
});

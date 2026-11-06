import { haversineDistance, cumulativeDistances, pointAtKm, bboxAround } from '../../utils/geometry';

describe('Geometry Utils', () => {
  
  describe('haversineDistance', () => {
    test('devrait calculer la distance entre deux points', () => {
      // Paris à Lyon ~ 392 km
      const paris = [2.3522, 48.8566];
      const lyon = [4.8357, 45.764];
      
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

  describe('cumulativeDistances / pointAtKm', () => {
    const line = [[6, 44], [6, 44.01], [6, 44.02]];
    const cumulative = cumulativeDistances(line);

    test('devrait cumuler les distances', () => {
      expect(cumulative[0]).toBe(0);
      expect(cumulative[2]).toBeCloseTo(2 * cumulative[1], 6);
    });

    test('devrait interpoler un point le long du tracé', () => {
      const [lon, lat] = pointAtKm(line, cumulative, cumulative[1] / 2);
      expect(lon).toBeCloseTo(6, 6);
      expect(lat).toBeCloseTo(44.005, 4);
    });

    test('devrait borner aux extrémités', () => {
      expect(pointAtKm(line, cumulative, -1)).toEqual([6, 44]);
      expect(pointAtKm(line, cumulative, 99)).toEqual([6, 44.02]);
    });
  });

  describe('bboxAround', () => {
    test('devrait produire un carré centré', () => {
      const [s, w, n, e] = bboxAround(44, 6, 10);
      expect(haversineDistance([6, s], [6, n])).toBeCloseTo(20, 0);
      expect(haversineDistance([w, 44], [e, 44])).toBeCloseTo(20, 0);
    });
  });
});

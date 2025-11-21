const { 
  segmentsIntersect, 
  isNearSegment, 
  areSegmentsAligned 
} = require('../../utils/geometry');

describe('Geometry Utils', () => {
  
  describe('segmentsIntersect', () => {
    test('devrait détecter deux segments qui se croisent', () => {
      const p1 = [0, 0];
      const p2 = [1, 1];
      const p3 = [0, 1];
      const p4 = [1, 0];
      
      expect(segmentsIntersect(p1, p2, p3, p4)).toBe(true);
    });

    test('devrait retourner false pour des segments parallèles', () => {
      const p1 = [0, 0];
      const p2 = [1, 0];
      const p3 = [0, 1];
      const p4 = [1, 1];
      
      expect(segmentsIntersect(p1, p2, p3, p4)).toBe(false);
    });

    test('devrait retourner false pour des segments qui ne se croisent pas', () => {
      const p1 = [0, 0];
      const p2 = [1, 0];
      const p3 = [2, 0];
      const p4 = [3, 0];
      
      expect(segmentsIntersect(p1, p2, p3, p4)).toBe(false);
    });
  });

  describe('isNearSegment', () => {
    test('devrait détecter un point proche du segment', () => {
      const point = [0.5, 0.5];
      const seg = [[0, 0], [1, 1]];
      
      expect(isNearSegment(point, seg, 0.1)).toBe(true);
    });

    test('devrait retourner false pour un point éloigné', () => {
      const point = [5, 5];
      const seg = [[0, 0], [1, 1]];
      
      expect(isNearSegment(point, seg, 0.1)).toBe(false);
    });
  });

  describe('areSegmentsAligned', () => {
    test('devrait détecter trois points alignés', () => {
      const a = [0, 0];
      const b = [1, 1];
      const c = [2, 2];
      
      expect(areSegmentsAligned(a, b, c)).toBe(true);
    });

    test('devrait retourner false pour trois points non alignés', () => {
      const a = [0, 0];
      const b = [1, 1];
      const c = [2, 0];
      
      expect(areSegmentsAligned(a, b, c)).toBe(false);
    });
  });
});

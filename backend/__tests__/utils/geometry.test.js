const {
  haversineKm,
  bearing,
  signedAngle,
  lineLengthKm,
  resample,
  bboxAround,
  createRng,
} = require('../../utils/geometry');

describe('Geometry Utils', () => {
  describe('haversineKm', () => {
    test('devrait calculer Paris-Lyon (~392 km)', () => {
      const d = haversineKm([2.3522, 48.8566], [4.8357, 45.764]);
      expect(d).toBeGreaterThan(385);
      expect(d).toBeLessThan(400);
    });

    test('devrait retourner 0 pour le même point', () => {
      expect(haversineKm([6, 44], [6, 44])).toBe(0);
    });
  });

  describe('bearing / signedAngle', () => {
    test('devrait donner 0° vers le nord et 90° vers l\'est', () => {
      expect(bearing([6, 44], [6, 45])).toBeCloseTo(0, 1);
      expect(bearing([6, 44], [6.01, 44])).toBeCloseTo(90, 0);
    });

    test('devrait signer les virages (positif = droite)', () => {
      expect(signedAngle(0, 90)).toBe(90);
      expect(signedAngle(0, 270)).toBe(-90);
      expect(signedAngle(350, 10)).toBe(20);
      expect(signedAngle(10, 350)).toBe(-20);
    });
  });

  describe('resample', () => {
    test('devrait produire des points régulièrement espacés', () => {
      const line = [[6, 44], [6, 44.01]]; // ~1.11 km
      const pts = resample(line, 0.1);
      expect(pts.length).toBe(13);
      expect(haversineKm(pts[0], pts[1])).toBeCloseTo(0.1, 3);
      expect(pts.at(-1)).toEqual([6, 44.01]);
    });

    test('devrait conserver la longueur totale', () => {
      const line = [[6, 44], [6.01, 44.005], [6.02, 44]];
      expect(lineLengthKm(resample(line, 0.025))).toBeCloseTo(lineLengthKm(line), 2);
    });
  });

  describe('bboxAround', () => {
    test('devrait produire un carré centré de demi-côté donné', () => {
      const [s, w, n, e] = bboxAround(44, 6, 10);
      expect(haversineKm([6, s], [6, n])).toBeCloseTo(20, 0);
      expect(haversineKm([w, 44], [e, 44])).toBeCloseTo(20, 0);
    });
  });

  describe('createRng', () => {
    test('devrait être reproductible avec la même graine', () => {
      const a = createRng(42);
      const b = createRng(42);
      expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    });

    test('devrait varier avec une autre graine et rester dans [0, 1[', () => {
      const a = createRng(1);
      const b = createRng(2);
      const values = Array.from({ length: 100 }, () => a());
      expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
      expect(a()).not.toBe(b());
    });
  });
});

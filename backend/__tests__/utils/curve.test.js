const { headingDeg, startTangent, spline, cutAtLength, curveLength, roadCurve } = require('../../utils/curve');

/** Arc de cercle de rayon r, centré sur (r, 0), partant de (0, 0) vers le nord et tournant à droite */
const arcPoints = (r, stepM, lengthM) => {
  const pts = [];
  for (let s = 0; s <= lengthM + 1e-9; s += stepM) {
    const a = s / r;
    pts.push([r - r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
};
const distToArc = (r) => ([x, y]) => Math.abs(Math.hypot(x - r, y) - r);

describe('Courbes de route', () => {
  describe('startTangent', () => {
    test.each([
      [50, 5],
      [50, 20],
      [50, 35],
      [30, 20],
      [80, 40],
    ])('arc de rayon %i m, points tous les %i m : tangente exacte au départ (plein nord)', (r, step) => {
      const t = startTangent(arcPoints(r, step, 90));
      expect(headingDeg(t)).toBeCloseTo(0, 0);
    });

    test('ligne droite : tangente = direction de la route', () => {
      expect(headingDeg(startTangent([[0, 0], [10, 10], [20, 20]]))).toBeCloseTo(45, 5);
    });

    test('ignore un doublon de numérisation collé au départ', () => {
      const pts = [[0, 0], [0.05, 0.4], ...arcPoints(50, 20, 60).slice(1)];
      expect(headingDeg(startTangent(pts))).toBeCloseTo(0, 0);
    });
  });

  describe('spline', () => {
    test('passe exactement par les points IGN', () => {
      const pts = arcPoints(40, 20, 80);
      const curve = spline(pts, { spacing: 1 });
      for (const p of pts) {
        expect(Math.min(...curve.map((c) => Math.hypot(c[0] - p[0], c[1] - p[1])))).toBeLessThan(1e-6);
      }
    });

    test('reste collée au vrai virage même avec des points espacés (là où les segments droits le coupent)', () => {
      const r = 30;
      const pts = arcPoints(r, 20, 90);
      const curve = spline(pts, { spacing: 1, startDir: startTangent(pts) });
      const splineError = Math.max(...curve.map(distToArc(r)));
      // Un segment droit de 20 m sur un rayon de 30 m s'écarte du virage de r(1 - cos(θ/2)) ≈ 1,7 m
      const chordError = r * (1 - Math.cos(20 / r / 2));
      expect(chordError).toBeGreaterThan(1.5);
      expect(splineError).toBeLessThan(0.6);
      expect(splineError).toBeLessThan(chordError / 2.5);
    });

    test("ne fait ni boucle ni dépassement dans un angle vif (carrefour en équerre)", () => {
      const curve = spline([[0, 0], [0, 30], [0.5, 30.5], [30, 31]], { spacing: 0.5 });
      expect(Math.max(...curve.map(([x]) => x))).toBeLessThanOrEqual(30.01);
      expect(Math.min(...curve.map(([x]) => x))).toBeGreaterThan(-0.5);
      expect(Math.max(...curve.map(([, y]) => y))).toBeLessThan(31.5);
    });

    test('virage progressif : le cap évolue sans à-coup', () => {
      const curve = spline(arcPoints(40, 25, 100), { spacing: 1 });
      for (let i = 2; i < curve.length; i++) {
        const h1 = headingDeg([curve[i - 1][0] - curve[i - 2][0], curve[i - 1][1] - curve[i - 2][1]]);
        const h2 = headingDeg([curve[i][0] - curve[i - 1][0], curve[i][1] - curve[i - 1][1]]);
        expect(Math.abs(((h2 - h1 + 540) % 360) - 180)).toBeLessThan(5);
      }
    });
  });

  describe('roadCurve / cutAtLength', () => {
    test('coupe la courbe à la longueur voulue', () => {
      const { curve } = roadCurve(arcPoints(50, 20, 120), 40);
      expect(curveLength(curve)).toBeCloseTo(40, 0);
    });

    test('route plus courte que la portée : gardée entière', () => {
      expect(curveLength(cutAtLength([[0, 0], [0, 10]], 40))).toBeCloseTo(10, 5);
    });
  });
});

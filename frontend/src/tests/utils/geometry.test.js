import { haversineDistance, cumulativeDistances, pointAtKm, bboxAround, loopArrows } from '../../utils/geometry';

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

  describe('loopArrows', () => {
    // Spéciale en pixels écran (y vers le bas) : bras d'entrée vers l'est, boucle carrée de 400 px dans le sens
    // horaire à l'écran (est, sud, ouest, nord), retour au pivot puis bras de sortie vers le nord
    const square = (x0, y0, side, n) => {
      const pts = [];
      const corners = [[x0, y0], [x0 + side, y0], [x0 + side, y0 + side], [x0, y0 + side], [x0, y0]];
      for (let c = 1; c < corners.length; c++) {
        for (let i = 0; i < n; i++) {
          const t = i / n;
          const [a, b] = [corners[c - 1], corners[c]];
          pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
      }
      pts.push([x0, y0]);
      return pts;
    };
    const armIn = [[-300, 0], [-150, 0]];
    const loop = square(0, 0, 400, 20);
    const armOut = [[0, -150], [0, -300]];
    const pts = [...armIn, ...loop, ...armOut];
    const range = [armIn.length, armIn.length + loop.length - 1];
    const distTo = (q, poly) => Math.min(...poly.slice(1).map((b, i) => {
      const a = poly[i];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
    }));

    test("devrait placer les flèches à l'extérieur de la boucle, sans toucher la spéciale", () => {
      const arrows = loopArrows(pts, range);
      expect(arrows.length).toBeGreaterThanOrEqual(3);
      for (const { shaft } of arrows) {
        for (const q of shaft) {
          const inside = q[0] > 0 && q[0] < 400 && q[1] > 0 && q[1] < 400;
          expect(inside).toBe(false);
          expect(distTo(q, pts)).toBeGreaterThanOrEqual(16);
        }
      }
    });

    test('devrait orienter les flèches dans le sens de parcours', () => {
      const arrows = loopArrows(pts, range, { min: 4, max: 4, spacing: 400 });
      // Un côté par flèche : est (0°), sud (90°), ouest (180°), nord (-90°)
      expect(arrows.map((a) => Math.round(a.head.angle))).toEqual([0, 90, 180, -90]);
    });

    test("devrait passer de l'autre côté quand un autre morceau de spéciale longe la boucle", () => {
      // Un bras longe le côté nord de la boucle, à 30 px à l'extérieur
      const alongside = [[...pts.slice(0, -2)], [[420, -30], [-20, -30]]].flat();
      const arrows = loopArrows(alongside, range, { min: 4, max: 4, spacing: 400 });
      const north = arrows.find((a) => Math.round(a.head.angle) === 0);
      expect(north.shaft.every((q) => q[1] > 0)).toBe(true); // côté intérieur
    });

    test('la pointe est au bout du trait, dans son prolongement', () => {
      for (const { shaft, head } of loopArrows(pts, range)) {
        const end = shaft[shaft.length - 1];
        const gap = Math.hypot(head.x - end[0], head.y - end[1]);
        expect(gap).toBeGreaterThan(5); // le trait s'arrête sous la pointe…
        expect(gap).toBeLessThan(12); // …sans s'en décoller
        const dir = (Math.atan2(head.y - end[1], head.x - end[0]) * 180) / Math.PI;
        expect(Math.abs(((dir - head.angle + 540) % 360) - 180)).toBeLessThan(15);
      }
    });

    test('devrait éviter les virages serrés et les abords du pivot (pas de zigzag)', () => {
      // Boucle en épingle : un long aller, une épingle, un long retour parallèle à 120 px
      const hairpin = [];
      for (let x = 0; x <= 600; x += 10) hairpin.push([x, 0]);
      for (let a = 1; a < 18; a++) hairpin.push([600 + 60 * Math.sin((a * Math.PI) / 18), 60 - 60 * Math.cos((a * Math.PI) / 18)]);
      for (let x = 600; x >= 0; x -= 10) hairpin.push([x, 120]);
      for (let y = 110; y > 0; y -= 10) hairpin.push([0, y]);
      hairpin.push([0, 0]);
      const arrows = loopArrows(hairpin, [0, hairpin.length - 1]);
      expect(arrows.length).toBeGreaterThan(0);
      for (const { shaft } of arrows) {
        for (let i = 2; i < shaft.length; i++) {
          const u = [shaft[i - 1][0] - shaft[i - 2][0], shaft[i - 1][1] - shaft[i - 2][1]];
          const v = [shaft[i][0] - shaft[i - 1][0], shaft[i][1] - shaft[i - 1][1]];
          const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v) || 1);
          expect((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI).toBeLessThanOrEqual(40.5);
        }
        // Loin du pivot (0, 0)
        expect(Math.min(...shaft.map((q) => Math.hypot(q[0], q[1])))).toBeGreaterThan(30);
      }
    });

    test('ne devrait rien dessiner sur une boucle minuscule', () => {
      expect(loopArrows(square(0, 0, 10, 4), [0, 16])).toEqual([]);
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

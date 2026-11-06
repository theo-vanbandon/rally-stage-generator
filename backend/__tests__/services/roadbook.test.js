/**
 * Roadbook : tulipes et directions sur des carrefours types à géométrie exacte.
 * Convention : on arrive par le bas, tout droit = haut, angles positifs à droite, rayon de tulipe 1 = 40 m.
 */
const { straight, towards, arc, road, stageThrough, junctionCase } = require('../fixtures/junctions');

const O = [0, 0];

/**
 * Carrefour standard : arrivée par le sud (tronçon 0), sortie (tronçon 1) prolongée par une route
 * d'importance 3 (point stop), autres branches ensuite.
 */
function crossroads(exitPts, otherBranches = [], { approach = straight([0, -400], O), exitOverrides } = {}) {
  const exitEnd = exitPts.at(-1);
  const before = exitPts.at(-2);
  const heading = (Math.atan2(exitEnd[0] - before[0], exitEnd[1] - before[1]) * 180) / Math.PI;
  const segments = [
    road(approach),
    road(exitPts, exitOverrides),
    ...otherBranches.map((b) => road(b.pts, b.overrides)),
    road(straight(exitEnd, towards(exitEnd, heading, 500)), { importance: 3 }),
  ];
  return junctionCase(stageThrough(segments, [0, 1]));
}

const branch = (heading, length = 400, overrides) => ({ pts: straight(O, towards(O, heading, length)), overrides });
const anglesOf = (tulip) => tulip.others.map((b) => b.angle).sort((a, b) => a - b);

/** Écart max (repère tulipe) entre une forme et la corde centre → dernier point : 0 = ligne droite */
function curvature(path) {
  const [ex, ey] = path.at(-1);
  const len = Math.hypot(ex, ey);
  return Math.max(...path.map(([x, y]) => Math.abs(x * ey - y * ex) / len));
}

describe('Roadbook — tulipes des carrefours types', () => {
  test('croisement en croix, tout droit', () => {
    const c = crossroads(straight(O, [0, 400]), [branch(90), branch(270)]);
    expect(c.type).toBe('junction');
    expect(Math.abs(c.tulip.exit)).toBeLessThanOrEqual(2);
    expect(c.direction).toBe('Tout droit');
    expect(anglesOf(c.tulip)).toEqual([expect.closeTo(-90, 0), expect.closeTo(90, 0)]);
    expect(c.tulip.entry).toBe('road');
  });

  test.each([
    [90, 'À droite'],
    [-90, 'À gauche'],
    [35, 'Légèrement à droite'],
    [-35, 'Légèrement à gauche'],
  ])('T / fourche : sortie à %i° → %s', (heading, label) => {
    const c = crossroads(straight(O, towards(O, heading, 400)), [branch(-heading)]);
    expect(c.tulip.exit).toBeCloseTo(heading, -0.5);
    expect(c.direction).toBe(label);
  });

  test('fourche très fermée : la sortie est bien la branche empruntée, pas sa voisine', () => {
    // Deux branches à -6° et +6° : seule l'identité du tronçon permet de ne pas les confondre
    const c = crossroads(straight(O, towards(O, -6, 400)), [branch(6)]);
    expect(c.tulip.exit).toBeLessThan(0);
    expect(c.tulip.others).toHaveLength(1);
    expect(c.tulip.others[0].angle).toBeGreaterThan(0);
  });

  test.each([
    ['droite', 90],
    ['gauche', -90],
  ])('virage arrondi à %s dans le carrefour : la sortie est dessinée en courbe', (_, turn) => {
    // La route principale tourne de 90° sur un arc de 25 m de rayon ; une petite route part tout droit
    const bend = arc(O, 0, turn, 25);
    const exit = [...bend.pts, ...straight(bend.end, towards(bend.end, bend.heading, 400)).slice(1)];
    const c = crossroads(exit, [branch(0)]);

    expect(Math.sign(c.tulip.exit)).toBe(Math.sign(turn));
    expect(Math.abs(c.tulip.exit)).toBeGreaterThan(40);
    expect(curvature(c.tulip.exitPath)).toBeGreaterThan(0.08); // la courbe est visible
    expect(c.tulip.others[0].angle).toBeCloseTo(0, -0.5); // la petite route reste tout droit
  });

  test('arrivée en courbe : les autres routes restent placées par rapport au sens de marche', () => {
    // On arrive d'ouest en virant à gauche (arc de 30 m) pour finir plein nord dans le carrefour
    const bend = arc([0, 0], 90, -90, 30); // départ cap est, fin cap nord
    const shift = (p) => [p[0] - bend.end[0], p[1] - bend.end[1]];
    const approach = [...straight(towards(bend.pts[0], 270, 300), bend.pts[0]), ...bend.pts.slice(1)].map(shift);
    const c = crossroads(straight(O, [0, 400]), [branch(90)], { approach });

    expect(Math.abs(c.tulip.exit)).toBeLessThan(25);
    expect(c.tulip.others[0].angle).toBeGreaterThan(65);
    expect(c.tulip.others[0].angle).toBeLessThan(115);
    expect(curvature(c.tulip.entryPath)).toBeGreaterThan(0.08); // l'arrivée en courbe est dessinée
  });

  test("arrivée par une épingle juste avant le carrefour : la tulipe montre quand même l'arrivée par le bas", () => {
    // La route vient du nord-est et fait demi-tour sur 8 m de rayon juste avant le carrefour
    const hairpin = arc([0, 0], 180, 170, 8); // cap sud, demi-tour par la droite
    const shift = (p) => [p[0] - hairpin.end[0], p[1] - hairpin.end[1]];
    const approach = [...straight(towards(hairpin.pts[0], 0, 300), hairpin.pts[0]), ...hairpin.pts.slice(1)].map(shift);
    const c = crossroads(straight(O, towards(O, hairpin.heading, 400)), [branch(hairpin.heading + 90)], { approach });

    for (const [, y] of c.tulip.entryPath) expect(y).toBeLessThan(0);
    const [, endY] = c.tulip.entryPath.at(-1);
    expect(endY).toBeLessThanOrEqual(-0.6);
    // On est encore en train de tourner (à droite) en passant le carrefour : la sortie part à droite, sans excès
    expect(c.tulip.exit).toBeGreaterThanOrEqual(0);
    expect(c.tulip.exit).toBeLessThan(60);
  });

  test("arrivée par un angle droit serré juste avant le carrefour : le point reste en bas, pas sur le côté", () => {
    // La route vient de l'est puis tourne à angle droit (rayon 6 m) vers le nord à 10 m du carrefour
    const corner = arc([0, -16], 270, 90, 6); // cap ouest → cap nord en virant à droite, fin du virage à y = -10
    const tail = straight(corner.end, [corner.end[0], 0]);
    const approach = [...straight(towards(corner.pts[0], 90, 300), corner.pts[0]), ...corner.pts.slice(1), ...tail.slice(1)].map(
      (p) => [p[0] - corner.end[0], p[1]]
    );
    const c = crossroads(straight(O, [0, 400]), [branch(270)], { approach });

    const [x, y] = c.tulip.entryPath.at(-1);
    expect(Math.abs(Math.atan2(x, -y))).toBeLessThan((76 * Math.PI) / 180); // dans le secteur bas
    expect(y).toBeLessThanOrEqual(-0.4); // nettement sous le carrefour
    expect(Math.abs(c.tulip.exit)).toBeLessThan(15);
  });

  test.each([
    [130, 'Épingle', 1],
    [165, 'Épingle très serrée', 2],
  ])('épingle à %i° : note et niveau de danger', (heading, note, danger) => {
    const c = crossroads(straight(O, towards(O, heading, 400)), [branch(0)]);
    expect(c.notes).toContain(note);
    expect(c.danger).toBe(danger);
    expect(c.direction).toMatch(/^Épingle droite/);
  });

  test.each([
    ['droite', 175],
    ['gauche', -175],
  ])("épingle très serrée à %s : le V reste ouvert sur le dessin, l'angle réel est conservé", (_, heading) => {
    const c = crossroads(straight(O, towards(O, heading, 400)), [branch(0)]);
    expect(Math.abs(c.tulip.exit)).toBeGreaterThan(170); // angle du terrain inchangé
    const [x, y] = c.tulip.exitPath.at(-1);
    const drawn = (Math.atan2(x, y) * 180) / Math.PI;
    expect(Math.abs(drawn)).toBeLessThanOrEqual(156); // au moins ~25° d'écart avec l'arrivée
    expect(Math.sign(drawn)).toBe(Math.sign(c.tulip.exit)); // et toujours du bon côté
  });

  test('passage de 360° à 0° : cap 355° puis 5° = tout droit, légèrement à droite', () => {
    const approach = straight(towards(O, 175, 400), O); // on roule au cap 355°
    const c = crossroads(straight(O, towards(O, 5, 400)), [branch(275)], { approach });
    expect(c.tulip.exit).toBeCloseTo(10, -0.5);
    expect(c.direction).toBe('Tout droit');
  });

  test('branche très courte (tronçon IGN de 6 m) : prolongée pour rester lisible', () => {
    const c = crossroads(straight(O, [0, 400]), [branch(90, 6)]);
    const [x, y] = c.tulip.others[0].path.at(-1);
    expect(Math.hypot(x, y)).toBeGreaterThanOrEqual(0.74);
    expect(c.tulip.others[0].angle).toBeCloseTo(90, -0.5);
  });

  test('les formes restent dans la tulipe et l\'arrivée vient du bas', () => {
    const c = crossroads(straight(O, [0, 400]), [branch(60), branch(200)]);
    const all = [c.tulip.entryPath, c.tulip.exitPath, ...c.tulip.others.map((b) => b.path)].flat();
    for (const [x, y] of all) {
      expect(Math.abs(x)).toBeLessThanOrEqual(1.01);
      expect(Math.abs(y)).toBeLessThanOrEqual(1.01);
    }
    const [ex, ey] = c.tulip.entryPath.at(-1);
    expect(ex).toBeCloseTo(0, 1);
    expect(ey).toBeCloseTo(-1, 1);
  });

  test('route principale : la prendre ou la croiser', () => {
    const take = crossroads(straight(O, [400, 0]), [branch(270, 400, { importance: 3 })], { exitOverrides: { importance: 3 } });
    expect(take.notes).toContain('Prendre la route principale');
    expect(take.tulip.exitKind).toBe('major');

    const cross = crossroads(straight(O, [0, 400]), [branch(90, 400, { importance: 2, nature: 'Route à 2 chaussées' })]);
    expect(cross.notes).toContain('Croisement route principale');
    expect(cross.tulip.others[0].kind).toBe('major');
  });

  test('piste de terre dans le carrefour : dessinée comme piste', () => {
    const c = crossroads(straight(O, [0, 400]), [branch(90), branch(270, 400, { nature: 'Chemin' })]);
    const track = c.tulip.others.find((b) => b.angle < 0);
    expect(track.kind).toBe('track');
  });

  test("une piste seule en cul-de-sac ne crée pas de case (sinon chaque entrée de champ en serait une)", () => {
    const segments = [
      road(straight([0, -400], O)),
      road(straight(O, [0, 400])),
      road(straight(O, [400, 0]), { nature: 'Chemin' }),
      road(straight([0, 400], [0, 900]), { importance: 3 }),
    ];
    expect(junctionCase(stageThrough(segments, [0, 1]))).toBeUndefined();
  });
});

describe('Roadbook — la route est une courbe, pas une suite de points', () => {
  // Arrivée sur un virage régulier qui finit plein nord dans le carrefour, numérisé plus ou moins finement.
  // Vérité terrain : on continue tout droit (0°), la route perpendiculaire est à +90°.
  test.each([
    [50, 5],
    [50, 20],
    [50, 35],
    [30, 20],
    [80, 40],
  ])('arrivée en virage de rayon %i m, points IGN tous les %i m : directions exactes', (radius, step) => {
    const bend = arc([0, 0], 90, -90, radius, step); // cap est → cap nord en virant à gauche
    const shift = (p) => [p[0] - bend.end[0], p[1] - bend.end[1]];
    const approach = [...straight(towards(bend.pts[0], 270, 300), bend.pts[0], step), ...bend.pts.slice(1)].map(shift);
    const c = crossroads(straight(O, [0, 400]), [branch(90)], { approach });

    expect(Math.abs(c.tulip.exit)).toBeLessThanOrEqual(2);
    expect(c.direction).toBe('Tout droit');
    expect(c.tulip.others[0].angle).toBeGreaterThanOrEqual(88);
    expect(c.tulip.others[0].angle).toBeLessThanOrEqual(92);
  });

  test.each([
    ['décroché de 2 m vers la gauche', [-1.5, -1.5]],
    ['décroché de 2,5 m vers la droite', [2, -1.5]],
  ])('nœud bruité (%s au ras du carrefour) : la direction reste juste', (_, kink) => {
    // Approche plein nord, mais le dernier point IGN avant le carrefour est décalé (jonction mal numérisée)
    const approach = [...straight([0, -400], [0, -10]), kink, O];
    const c = crossroads(straight(O, [0, 400]), [branch(90)], { approach });
    expect(Math.abs(c.tulip.exit)).toBeLessThanOrEqual(3);
    expect(c.tulip.others[0].angle).toBeGreaterThanOrEqual(86);
    expect(c.tulip.others[0].angle).toBeLessThanOrEqual(94);
  });

  test("crochet de numérisation dans le tronçon (cas réel de Saint-Girons) : direction de la vraie route", () => {
    // Points IGN réels : la route file vers l'ouest à 4 m au sud du nœud, puis un crochet la ramène au nœud
    const approach = [[120, -3.7], [56.4, -3.7], [42.9, -3.5], [27.3, -3.6], [10.2, -4.5], [1.3, -3.7], [-2.4, -2.8], O];
    const c = crossroads(straight(O, [-400, 0]), [branch(0)], { approach });
    // Vraie manœuvre : on roule vers l'ouest et on continue vers l'ouest
    expect(Math.abs(c.tulip.exit)).toBeLessThan(20);
    expect(c.notes.join()).not.toMatch(/Épingle/);
  });

  test("épingle d'approche très serrée (cas réel de Bagnères) : respectée, pas prise pour un crochet", () => {
    // Points IGN réels (du carrefour vers l'arrière) : la route arrive en s'enroulant autour du carrefour
    const back = [[1.3, -0.4], [4.2, -5], [2.9, -9.5], [-2.1, -12.8], [-8.2, -15.1], [-15.6, -20.8], [-40, -40]];
    const approach = [...back].reverse().concat([O]);
    const c = crossroads(straight(O, [0, 400]), [branch(200)], { approach });
    // L'arrivée est dessinée par le bas et ne remonte pas dans la tulipe
    const near = c.tulip.entryPath.find(([x, y]) => Math.hypot(x, y) >= 0.2);
    expect(near[1]).toBeLessThan(0);
  });

  test("vrai virage serré juste avant le carrefour (cas réel de Gap) : respecté, pas pris pour un crochet", () => {
    // Points IGN réels (du carrefour vers l'arrière) d'une route qui arrive du sud en virage serré
    const back = [[-1.2, 2.2], [-2.8, 3.9], [-5.4, 4.7], [-8.9, 3.9], [-12.1, 0.8], [-17.8, -14.8], [-30, -60]];
    const approach = [...back].reverse().concat([O]);
    const c = crossroads(straight(O, towards(O, 158, 400)), [branch(250)], { approach });
    // On sort du virage dans son prolongement (cap ≈ 158°) : tout droit, et l'arrivée est dessinée par le bas
    expect(Math.abs(c.tulip.exit)).toBeLessThan(20);
    const near = c.tulip.entryPath.find(([x, y]) => Math.hypot(x, y) >= 0.2);
    expect(near[1]).toBeLessThan(0);
  });

  test("carrefour IGN en deux nœuds reliés par un crochet de 8 m : une seule case, pas de fausse épingle", () => {
    // Route nord-sud à 8 m à l'est du carrefour ; un tronçon de liaison de 8 m la relie au nœud (0, 0)
    const N1 = [8, -2];
    const segments = [
      road(straight([8, 400], N1)), // 0 : arrivée, plein sud
      road([N1, [3, -3], O]), // 1 : liaison (tronçon IGN séparé)
      road(straight(O, [-400, 0])), // 2 : sortie, plein ouest
      road(straight(N1, [8, -400])), // 3 : la route nord-sud continue
      road(straight(O, [0, -400])), // 4 : autre route au carrefour
      road(straight([-400, 0], [-900, 0]), { importance: 3 }),
    ];
    const stage = stageThrough(segments, [0, 1, 2]);
    const junctions = stage.roadbook.filter((c) => c.type === 'junction');
    expect(junctions).toHaveLength(1); // un seul carrefour physique
    const [c] = junctions;
    // Vraie manœuvre : on arrive cap sud, on repart cap ouest = à droite
    expect(c.notes.join()).not.toMatch(/Épingle/);
    expect(c.tulip.exit).toBeGreaterThan(60);
    expect(c.tulip.exit).toBeLessThan(120);
    expect(c.tulip.others).toHaveLength(2); // la route nord-sud qui continue + la route au sud du nœud
  });

  test("carrefour décalé (liaison perpendiculaire de 6 m) : direction de la vraie route d'arrivée", () => {
    const N1 = [0, 6];
    const segments = [
      road(straight([-400, 6], N1)), // 0 : arrivée, plein est
      road([N1, O]), // 1 : liaison de 6 m
      road(straight(O, [0, -400])), // 2 : sortie, plein sud
      road(straight(N1, [400, 6])), // 3 : la route est-ouest continue
      road(straight(O, [400, 0])), // 4 : autre route au carrefour
      road(straight([0, -400], [0, -900]), { importance: 3 }),
    ];
    const stage = stageThrough(segments, [0, 1, 2]);
    const junctions = stage.roadbook.filter((c) => c.type === 'junction');
    expect(junctions).toHaveLength(1);
    // Arrivée cap est, sortie cap sud = à droite
    expect(junctions[0].tulip.exit).toBeGreaterThan(60);
    expect(junctions[0].tulip.exit).toBeLessThan(120);
    expect(junctions[0].direction).toBe('À droite');
  });

  test('virage dans le carrefour numérisé tous les 15 m : le dessin suit le vrai virage, pas les segments', () => {
    const r = 25;
    const bend = arc(O, 0, 90, r, 15); // virage à droite de rayon 25 m, un point IGN tous les 15 m
    const exit = [...bend.pts, ...straight(bend.end, towards(bend.end, 90, 400)).slice(1)];
    const c = crossroads(exit, [branch(0)]);

    // Arrivée plein nord : repère tulipe = repère carte. Vrai virage : cercle de centre (25, 0)
    const metres = c.tulip.exitPath.map(([x, y]) => [x * 40, y * 40]).filter(([x]) => x < r);
    const error = Math.max(...metres.map(([x, y]) => Math.abs(Math.hypot(x - r, y) - r)));
    const chordError = r * (1 - Math.cos(15 / r / 2)); // écart d'un segment droit de 15 m : ≈ 1,1 m
    expect(error).toBeLessThan(chordError / 2);
  });
});

describe('Roadbook — cases particulières', () => {
  test("patte d'oie : deux nœuds IGN à 20 m = une seule case", () => {
    const segments = [
      road(straight([0, -400], O)),
      road(straight(O, [0, 20])),
      road(straight([0, 20], [0, 400])),
      road(straight(O, [-400, 0])),
      road(straight([0, 20], [400, 20])),
      road(straight([0, 400], [0, 900]), { importance: 3 }),
    ];
    const stage = stageThrough(segments, [0, 1, 2]);
    expect(stage.roadbook.filter((c) => c.type === 'junction')).toHaveLength(1);
  });

  test('départ en pleine route : la route qui continue derrière apparaît en bas de la tulipe', () => {
    const segments = [
      road(straight([0, -400], O)), // route qui continue derrière le départ
      road(straight(O, [0, 400])),
      road(straight([0, 400], [0, 900]), { importance: 3 }),
    ];
    const stage = stageThrough(segments, [1]);
    const start = stage.roadbook[0];
    expect(start.type).toBe('start');
    expect(start.tulip.entry).toBeNull();
    expect(start.tulip.exit).toBe(0);
    expect(Math.abs(start.tulip.others[0].angle)).toBeGreaterThan(170);
  });

  test("arrivée : la flèche suit la route de sortie vers le point stop, même en virage", () => {
    const bend = arc([0, 400], 0, 90, 25); // après l'arrivée, la route vire à droite
    const segments = [
      road(straight([0, -400], O)),
      road(straight(O, [0, 400])),
      road([...bend.pts, ...straight(bend.end, towards(bend.end, 90, 500)).slice(1)], { importance: 3 }),
    ];
    const stage = stageThrough(segments, [0, 1]);
    const finish = stage.roadbook.find((c) => c.type === 'finish');
    expect(finish.tulip.exit).toBeGreaterThan(30);
    expect(finish.tulip.exitKind).toBe('major');
    expect(stage.stop.distanceKm).toBeGreaterThanOrEqual(0.3);
  });
});

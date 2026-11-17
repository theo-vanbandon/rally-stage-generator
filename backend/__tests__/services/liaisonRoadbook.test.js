const { liaisonRoadbook } = require('../../services/liaisonRoadbook');
const { fastestPath } = require('../../services/liaisons');
const { buildNetwork } = require('../../services/roadNetwork');
const { segment, CENTER } = require('../fixtures/network');

const key = (c) => `${c[0]},${c[1]}`;
const P = (i, j) => [CENTER.lon + i * 0.01, CENTER.lat + j * 0.01];
const D = 0.0003; // rayon du rond-point (~25 m)

// A ── B ── rond-point (W, S, E, N, sens antihoraire) ── X ── T
//      │               sorties : S (D2), E (D3), N (D4)
//      └ route secondaire          à X : tout droit vers (2, 2), à droite vers T (D5)
const ring = (dx, dy) => [CENTER.lon + 0.02 + dx, CENTER.lat + dy];
const [W, S, E, N] = [ring(-D, 0), ring(0, -D), ring(D, 0), ring(0, D)];
const network = buildNetwork(
  [
    segment([P(0, 0), P(1, 0)], { ref: 'D1' }),
    segment([P(1, 0), W], { ref: 'D1' }),
    segment([P(1, 0), P(1, 1)], { importance: 6 }), // route secondaire à B : on reste sur la D1, pas de case
    ...[[W, S], [S, E], [E, N], [N, W]].map((c) => segment(c, { nature: 'Rond-point', direction: 'Sens direct', ref: 'D1' })),
    segment([S, P(2, -1)], { ref: 'D2' }),
    segment([E, P(3, 0)], { ref: 'D3' }),
    segment([N, P(2, 1)], { ref: 'D4' }),
    segment([P(2, 1), P(2, 2)], { ref: 'D4' }),
    segment([P(2, 1), P(3, 1)], { ref: 'D5' }),
  ],
  CENTER
);
const nodeAt = (c) => network.nodes.findIndex((n) => key(n.coord) === key(c));

describe('Roadbook des liaisons', () => {
  const path = fastestPath(network, nodeAt(P(0, 0)), nodeAt(P(3, 1)), new Set());
  const roadbook = liaisonRoadbook(network, {
    lead: [],
    path,
    entryLink: null,
    uturn: false,
    nodeNotes: new Map([[nodeAt(P(2, 1)), ["Traversée de l'ES3 : point de traversée à organiser"]]]),
    fromEs: 'ES1',
    toEs: 'ES2',
  });

  test("une case seulement là où il faut agir : du point stop au CH de l'ES suivante", () => {
    expect(roadbook.map((c) => c.direction)).toEqual([
      'Point stop ES1 — départ liaison',
      'Rond-point — 3e sortie',
      'À droite',
      'CH — Départ ES2',
    ]);
    expect(roadbook.map((c) => c.n)).toEqual([1, 2, 3, 4]);
  });

  test('kilométrages total et partiel croissants, jusqu’au bout de la liaison', () => {
    for (let i = 1; i < roadbook.length; i++) {
      expect(roadbook[i].km).toBeGreaterThan(roadbook[i - 1].km);
      expect(roadbook[i].partial).toBeCloseTo(roadbook[i].km - roadbook[i - 1].km, 2);
    }
    expect(roadbook.at(-1).km).toBeCloseTo(path.km, 1);
  });

  test('rond-point : tulipe schématique, une route par direction', () => {
    const rp = roadbook[1];
    expect(rp.road).toBe('D4');
    expect(rp.tulip.roundabout).toBe(true);
    // Arrivée de l'ouest, sortie au nord : à gauche ; on passe devant la D2 (à droite) et la D3 (en face)
    expect(rp.tulip.exit).toBeLessThan(-45);
    const angles = rp.tulip.others.map((o) => o.angle).sort((a, b) => a - b);
    expect(angles).toHaveLength(2);
    expect(Math.abs(angles[0])).toBeLessThan(30);
    expect(angles[1]).toBeGreaterThan(60);
    // Traits droits : pas de géométrie détaillée
    expect(rp.tulip.exitPath).toBeNull();
    expect(rp.tulip.others.every((o) => o.path === null)).toBe(true);
  });

  test('les carrefours où la liaison touche une spéciale portent la consigne', () => {
    expect(roadbook[2].road).toBe('D5');
    expect(roadbook[2].notes).toContain("Traversée de l'ES3 : point de traversée à organiser");
    expect(roadbook[2].danger).toBeGreaterThanOrEqual(1);
  });
});

describe("Roadbook des liaisons : îlot juste avant le rond-point", () => {
  // Même rond-point, mais la route d'arrivée se sépare 15 m avant l'anneau (îlot) : J relie aussi une petite route
  const J = ring(-D - 0.0002, 0);
  const net = buildNetwork(
    [
      segment([P(0, 0), P(1, 0)], { ref: 'D1' }),
      segment([P(1, 0), J], { ref: 'D1' }),
      segment([J, W], { ref: 'D1' }),
      segment([J, ring(-D - 0.0002, -0.001)], { importance: 6 }), // bretelle vers le sud depuis l'îlot
      ...[[W, S], [S, E], [E, N], [N, W]].map((c) => segment(c, { nature: 'Rond-point', direction: 'Sens direct', ref: 'D1' })),
      segment([S, P(2, -1)], { ref: 'D2' }),
      segment([E, P(3, 0)], { ref: 'D3' }),
      segment([N, P(2, 1)], { ref: 'D4' }),
    ],
    CENTER
  );
  const at = (c) => net.nodes.findIndex((n) => key(n.coord) === key(c));

  test('une seule case de rond-point, avec le numéro de sortie et une tulipe lisible', () => {
    const p = fastestPath(net, at(P(0, 0)), at(P(2, 1)), new Set());
    const rb = liaisonRoadbook(net, { lead: [], path: p, entryLink: null, uturn: false, nodeNotes: new Map(), fromEs: 'ES1', toEs: 'ES2' });
    expect(rb.map((c) => c.direction)).toEqual(['Point stop ES1 — départ liaison', 'Rond-point — 3e sortie', 'CH — Départ ES2']);
    const { tulip } = rb[1];
    expect(tulip.roundabout).toBe(true);
    expect(tulip.others.length).toBeLessThanOrEqual(3);
  });
});

describe('Roadbook des liaisons : route à deux chaussées avant le rond-point', () => {
  // La D1 se sépare en deux sens à I, ~40 m avant l'anneau : I → W (entrée), NW → I (sortie de l'anneau vers la D1)
  const I = ring(-D - 0.0005, 0);
  const NW = ring(-D * 0.7, D * 0.7);
  const net = buildNetwork(
    [
      segment([P(0, 0), P(1, 0)], { ref: 'D1' }),
      segment([P(1, 0), I], { ref: 'D1' }),
      segment([I, W], { ref: 'D1', direction: 'Sens direct' }),
      segment([NW, I], { ref: 'D1', direction: 'Sens direct' }),
      ...[[W, S], [S, E], [E, N], [N, NW], [NW, W]].map((c) => segment(c, { nature: 'Rond-point', direction: 'Sens direct', ref: 'D1' })),
      segment([S, P(2, -1)], { ref: 'D2' }),
      segment([E, P(3, 0)], { ref: 'D3' }),
      segment([N, P(2, 1)], { ref: 'D4' }),
    ],
    CENTER
  );
  const at = (c) => net.nodes.findIndex((n) => key(n.coord) === key(c));
  const rb = liaisonRoadbook(net, {
    lead: [],
    path: fastestPath(net, at(P(0, 0)), at(P(2, 1)), new Set()),
    entryLink: null,
    uturn: false,
    nodeNotes: new Map(),
    fromEs: 'ES1',
    toEs: 'ES2',
  });

  test("l'îlot fait partie de la case du rond-point : pas de case « légèrement à droite » juste avant", () => {
    expect(rb.map((c) => c.direction)).toEqual(['Point stop ES1 — départ liaison', 'Rond-point — 3e sortie', 'CH — Départ ES2']);
  });

  test('tulipe : routes placées selon leur position autour de l’anneau (D2 à droite, D3 en face, sortie D4 à gauche)', () => {
    const { tulip } = rb[1];
    expect(tulip.exit).toBeLessThan(-60);
    const angles = tulip.others.map((o) => o.angle).sort((a, b) => a - b);
    expect(angles).toHaveLength(2);
    expect(Math.abs(angles[0])).toBeLessThan(30);
    expect(angles[1]).toBeGreaterThan(60);
  });
});

describe('Roadbook des liaisons : cases rapprochées', () => {
  // X1 : fourche qu'on passe tout droit ; 40 m plus loin, X2 : on tourne à droite. Une seule case utile : X2.
  const X1 = P(1, 0);
  const X2 = [X1[0] + 0.0005, X1[1]];
  const net = buildNetwork(
    [
      segment([P(0, 0), X1]),
      segment([X1, [X1[0] + 0.003, X1[1] + 0.0008]]), // bretelle presque dans l'axe
      segment([X1, X2]),
      segment([X2, [X2[0] + 0.01, X2[1]]]), // tout droit
      segment([X2, [X2[0] + 0.005, X2[1] - 0.005]]), // à droite : la liaison
    ],
    CENTER
  );
  const at = (c) => net.nodes.findIndex((n) => key(n.coord) === key(c));

  test("un « tout droit » à moins de 60 m d'une autre case n'a pas de case", () => {
    const p = fastestPath(net, at(P(0, 0)), at([X2[0] + 0.005, X2[1] - 0.005]), new Set());
    const rb = liaisonRoadbook(net, { lead: [], path: p, entryLink: null, uturn: false, nodeNotes: new Map(), fromEs: 'ES1', toEs: 'ES2' });
    const junctions = rb.filter((c) => c.type === 'junction');
    expect(junctions).toHaveLength(1);
    expect(key(junctions[0].coord)).toBe(key(X2));
    expect(junctions[0].angle).toBeGreaterThan(30);
  });
});

describe('Roadbook des liaisons : terre-plein central', () => {
  // La rue se sépare en deux chaussées à sens unique autour d'un terre-plein (M → Q), puis se rejoint
  const M = P(1, 0);
  const Q = [M[0] + 0.003, M[1]];
  const street = { name: "R D'ERQUINGHEM" };
  const carriageway = { ...street, nature: 'Route à 2 chaussées' };
  const net = buildNetwork(
    [
      segment([P(0, 0), M], street),
      segment([M, [M[0] + 0.0015, M[1] - 0.0001], Q], { ...carriageway, direction: 'Sens direct' }),
      segment([M, [M[0] + 0.0015, M[1] + 0.0001], Q], { ...carriageway, direction: 'Sens inverse' }),
      segment([Q, P(2, 0)], street),
    ],
    CENTER
  );
  const at = (c) => net.nodes.findIndex((n) => key(n.coord) === key(c));

  test("ni virage ni « prendre la route principale » : c'est la même rue", () => {
    const p = fastestPath(net, at(P(0, 0)), at(P(2, 0)), new Set());
    const rb = liaisonRoadbook(net, { lead: [], path: p, entryLink: null, uturn: false, nodeNotes: new Map(), fromEs: 'ES1', toEs: 'ES2' });
    expect(rb.map((c) => c.type)).toEqual(['stop', 'start']);
  });
});

describe('Roadbook des liaisons : tulipe schématique', () => {
  // Fourche serrée : la liaison part à ~25° à droite, l'autre branche file presque tout droit (~5°)
  const Y = P(1, 0);
  const net = buildNetwork(
    [
      segment([P(0, 0), Y], { ref: 'D1' }),
      segment([Y, [Y[0] + 0.01, Y[1] - 0.0033]], { ref: 'D2' }), // ~25° à droite (est-sud-est)
      segment([Y, [Y[0] + 0.01, Y[1] + 0.0006]], { ref: 'D1' }), // presque tout droit
    ],
    CENTER
  );
  const at = (c) => net.nodes.findIndex((n) => key(n.coord) === key(c));

  test("traits droits et écart net entre la flèche et l'autre branche", () => {
    const p = fastestPath(net, at(P(0, 0)), at([Y[0] + 0.01, Y[1] - 0.0033]), new Set());
    const rb = liaisonRoadbook(net, { lead: [], path: p, entryLink: null, uturn: false, nodeNotes: new Map(), fromEs: 'ES1', toEs: 'ES2' });
    const { tulip } = rb.find((c) => c.type === 'junction');
    expect(tulip.exit).toBeGreaterThan(15);
    expect(tulip.others).toHaveLength(1);
    expect(Math.abs(tulip.others[0].angle - tulip.exit)).toBeGreaterThanOrEqual(40);
    expect(tulip.others[0].angle).toBeLessThan(tulip.exit); // reste du bon côté (à gauche de la flèche)
    expect(tulip.entryPath).toBeNull();
    expect(tulip.exitPath).toBeNull();
    expect(tulip.others[0].path).toBeNull();
  });

  test("fourche passée tout droit : une case (jugée sur les vrais angles), l'autre branche bien écartée", () => {
    const p = fastestPath(net, at(P(0, 0)), at([Y[0] + 0.01, Y[1] + 0.0006]), new Set());
    const rb = liaisonRoadbook(net, { lead: [], path: p, entryLink: null, uturn: false, nodeNotes: new Map(), fromEs: 'ES1', toEs: 'ES2' });
    const fork = rb.find((c) => c.type === 'junction');
    expect(fork.direction).toBe('Tout droit');
    expect(Math.abs(fork.tulip.others[0].angle - fork.tulip.exit)).toBeGreaterThanOrEqual(40);
  });
});

const { computeLiaisons, fastestPath, canDrive } = require('../../services/liaisons');
const { generateStages } = require('../../services/stageGenerator');
const { buildNetwork } = require('../../services/roadNetwork');
const { gridSegments, segment, CENTER } = require('../fixtures/network');

const key = (c) => `${c[0]},${c[1]}`;
const P = (i, j) => [CENTER.lon + i * 0.01, CENTER.lat + j * 0.01];

describe('Liaisons', () => {
  describe('fastestPath', () => {
    // Carré A-B-C-D : A→B à sens unique (sens de numérisation), le reste à double sens
    //  D ---- C
    //  |      |
    //  A -->- B
    const square = () =>
      buildNetwork(
        [
          segment([P(0, 0), P(1, 0)], { direction: 'Sens direct' }),
          segment([P(1, 0), P(1, 1)]),
          segment([P(1, 1), P(0, 1)]),
          segment([P(0, 1), P(0, 0)]),
        ],
        CENTER
      );
    const nodeAt = (network, c) => network.nodes.findIndex((n) => key(n.coord) === key(c));

    test('respecte les sens interdits', () => {
      const network = square();
      const [A, B] = [nodeAt(network, P(0, 0)), nodeAt(network, P(1, 0))];
      // A → B : directement par le sens unique
      expect(fastestPath(network, A, B, new Set()).coords).toHaveLength(2);
      // B → A : interdit à contresens, on fait le tour par C et D
      const back = fastestPath(network, B, A, new Set());
      expect(back.coords.map(key)).toEqual([P(1, 0), P(1, 1), P(0, 1), P(0, 0)].map(key));
    });

    test("le sens « Sens inverse » n'autorise que l'autre sens", () => {
      const network = buildNetwork([segment([P(0, 0), P(1, 0)], { direction: 'Sens inverse' })], CENTER);
      const link = network.nodes[0].linkIds[0];
      expect(canDrive(network, link, nodeAt(network, P(0, 0)))).toBe(false);
      expect(canDrive(network, link, nodeAt(network, P(1, 0)))).toBe(true);
    });

    test("n'emprunte jamais un carrefour fermé, sauf l'arrivée visée", () => {
      const network = square();
      const [A, B, C, D] = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)].map((c) => nodeAt(network, c));
      expect(fastestPath(network, B, A, new Set([C]))).toBeNull(); // seul chemin autorisé passe par C
      expect(fastestPath(network, B, D, new Set([D]))).not.toBeNull(); // D fermé mais c'est la destination
    });

    test('interdit le demi-tour au premier pas', () => {
      const network = square();
      const [A, B, C] = [P(0, 0), P(1, 0), P(1, 1)].map((c) => nodeAt(network, c));
      expect(fastestPath(network, B, C, new Set(), C)).toBeNull(); // la seule autre route est à contresens
      expect(fastestPath(network, A, C, new Set(), B).coords.map(key)).toEqual([P(0, 0), P(0, 1), P(1, 1)].map(key));
    });
  });

  describe('compromis', () => {
    const square = () =>
      buildNetwork(
        [segment([P(0, 0), P(1, 0)]), segment([P(1, 0), P(1, 1)]), segment([P(1, 1), P(0, 1)]), segment([P(0, 1), P(0, 0)])],
        CENTER
      );
    const at = (network, c) => network.nodes.findIndex((n) => key(n.coord) === key(c));

    test('traverser un carrefour fermé sans rouler sur la spéciale', () => {
      const network = square();
      const [A, B, C, D] = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)].map((c) => at(network, c));
      // A et C fermés : de B à D, il faut traverser C
      expect(fastestPath(network, B, D, new Set([A, C]))).toBeNull();
      expect(fastestPath(network, B, D, new Set([A, C]), null, { crossable: new Set([C]) }).nodes).toEqual([B, C, D]);
      // … mais pas si la route B–C fait partie de la spéciale
      const roads = new Set([`${Math.min(B, C)}|${Math.max(B, C)}`]);
      expect(fastestPath(network, B, D, new Set([A, C]), null, { crossable: new Set([C]), roads })).toBeNull();
    });

    test('une route de spéciale est prise seulement faute de mieux', () => {
      const network = square();
      const [A, B, C, D] = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)].map((c) => at(network, c));
      const avoid = new Set([`${Math.min(B, C)}|${Math.max(B, C)}`]);
      expect(fastestPath(network, B, D, new Set(), null, { avoid }).nodes).toEqual([B, A, D]);
      // Le temps rendu est le vrai temps de conduite, sans la pénalité
      const direct = fastestPath(network, B, D, new Set());
      expect(fastestPath(network, B, D, new Set(), null, { avoid }).hours).toBeCloseTo(direct.hours, 4);
    });
  });

  describe('computeLiaisons', () => {
    let network;
    let stages;
    beforeAll(() => {
      // Grille assez grande pour que les 3 spéciales fermées laissent de la place aux liaisons
      network = buildNetwork(gridSegments({ size: 9 }), CENTER);
      ({ stages } = generateStages(network, { seed: 3 }));
    });
    const asInput = (s) => ({ start: s.start, finish: s.finish, stop: s.stop, coordinates: s.geometry.coordinates });

    test('relie le point stop de chaque spéciale au départ de la suivante, sans toucher aucune spéciale', () => {
      expect(stages.length).toBeGreaterThanOrEqual(2);
      const input = stages.map(asInput);
      const liaisons = computeLiaisons(network, input);
      expect(liaisons).toHaveLength(input.length - 1);
      const junctions = new Set(network.nodes.map((n) => key(n.coord)));
      const closed = new Set(input.flatMap((s) => s.coordinates.map(key)).filter((k) => junctions.has(k)));
      for (const l of liaisons) {
        expect(l.ok).toBe(true);
        expect(key(l.coordinates[0])).toBe(key(input[l.from].stop.coord));
        expect(key(l.coordinates.at(-1))).toBe(key(input[l.to].start));
        expect(l.coordinates.slice(0, -1).filter((c) => closed.has(key(c)))).toEqual([]);
        expect(l.km).toBeGreaterThan(0);
        expect(l.minutes).toBeGreaterThan(0);
      }
    });

    test("suit l'ordre et le sens demandés", () => {
      const [s1, s2] = stages;
      const forward = computeLiaisons(network, [asInput(s1), asInput(s2)]);
      const swapped = computeLiaisons(network, [asInput(s2), asInput(s1.reverse)]);
      expect(key(forward[0].coordinates.at(-1))).toBe(key(s2.start));
      expect(key(swapped[0].coordinates[0])).toBe(key(s2.stop.coord));
      expect(key(swapped[0].coordinates.at(-1))).toBe(key(s1.reverse.start));
    });

    test('ne calcule que les liaisons demandées', () => {
      const input = stages.map(asInput);
      const liaisons = computeLiaisons(network, input, { only: new Set([1]) });
      expect(liaisons.map((l) => l.from)).toEqual([1]);
    });

    test('propose toujours une liaison, en signalant le compromis', () => {
      // Petite grille, 3 spéciales fermées : la liaison propre est impossible, un compromis est proposé
      const small = buildNetwork(gridSegments({ size: 7 }), CENTER);
      const { stages: tight } = generateStages(small, { seed: 3 });
      const input = tight.map(asInput);
      expect(computeLiaisons(small, input, { maxTier: 1 })[0].ok).toBe(false);
      const [l] = computeLiaisons(small, input);
      expect(l.ok).toBe(true);
      expect(l.tier).toBeGreaterThan(1);
      expect(l.warnings.length).toBeGreaterThan(0);
      expect(key(l.coordinates.at(-1))).toBe(key(input[1].start));
    });

    test("une liaison propre n'a pas d'avertissement", () => {
      for (const l of computeLiaisons(network, stages.map(asInput))) {
        if (l.tier === 1) expect(l.warnings).toEqual([]);
      }
    });

    test('signale une liaison impossible', () => {
      const [s1, s2] = stages.map(asInput);
      // Départ de la 2e spéciale inconnu du réseau
      const [l] = computeLiaisons(network, [s1, { ...s2, start: [0, 0] }]);
      expect(l).toEqual({ from: 0, to: 1, ok: false });
    });
  });
});

const {
  generateStages,
  hasExit,
  preferencesFor,
  computeReach,
  turnLabel,
  elevationStats,
  LENGTH_PRESETS,
} = require('../../services/stageGenerator');
const { buildNetwork } = require('../../services/roadNetwork');
const { gridSegments, segment, wiggly, CENTER } = require('../fixtures/network');

const coordKey = (c) => `${c[0]},${c[1]}`;

describe('Stage Generator Service', () => {
  let network;

  beforeAll(() => {
    network = buildNetwork(gridSegments({ size: 7 }), CENTER);
  });

  describe('generateStages', () => {
    test('devrait générer une spéciale dans la fourchette de longueur', () => {
      const { stages } = generateStages(network, { length: 'medium', seed: 1 });
      const [minKm, maxKm] = LENGTH_PRESETS.medium;

      expect(stages.length).toBeGreaterThan(0);
      expect(stages[0].stats.lengthKm).toBeGreaterThanOrEqual(minKm);
      expect(stages[0].stats.lengthKm).toBeLessThanOrEqual(maxKm + 0.01);
    });

    test('ne devrait jamais repasser par le même carrefour', () => {
      const { stages } = generateStages(network, { seed: 7 });
      const junctionKeys = new Set(network.nodes.map((n) => coordKey(n.coord)));
      const visited = stages[0].geometry.coordinates.map(coordKey).filter((k) => junctionKeys.has(k));
      expect(new Set(visited).size).toBe(visited.length);
    });

    test('devrait être reproductible avec la même graine', () => {
      const a = generateStages(network, { seed: 123 });
      const b = generateStages(network, { seed: 123 });
      expect(a.stages[0].id).toBe(b.stages[0].id);
    });

    test('devrait proposer des spéciales différentes selon la graine', () => {
      const ids = new Set();
      for (let seed = 1; seed <= 8; seed++) ids.add(generateStages(network, { seed }).stages[0].id);
      expect(ids.size).toBeGreaterThan(3);
    });

    test('devrait proposer des alternatives qui ne chevauchent ni la principale ni entre elles', () => {
      for (let seed = 1; seed <= 5; seed++) {
        const { stages } = generateStages(network, { seed });
        expect(stages.length).toBe(3);
        // Deux tracés qui partagent un tronçon ont au moins deux points consécutifs en commun
        const segmentKeys = (s) => {
          const c = s.geometry.coordinates.map(coordKey);
          return new Set(c.slice(1).map((k, i) => [c[i], k].sort().join('|')));
        };
        const keys = stages.map(segmentKeys);
        for (let i = 0; i < keys.length; i++) {
          for (let j = i + 1; j < keys.length; j++) {
            expect([...keys[i]].some((k) => keys[j].has(k))).toBe(false);
          }
        }
      }
    });

    test('devrait fournir roadbook, statistiques et profil d\'altitude', () => {
      const [stage] = generateStages(network, { seed: 2 }).stages;
      expect(stage.roadbook.length).toBeGreaterThan(0);
      expect(stage.roadbook[0]).toEqual(
        expect.objectContaining({ km: expect.any(Number), direction: expect.any(String) })
      );
      const kms = stage.roadbook.map((pk) => pk.km);
      expect(kms).toEqual([...kms].sort((x, y) => x - y));
      expect(stage.stats.surfacePct.paved).toBe(100);
      expect(stage.stats.elevation.profile.length).toBeGreaterThan(10);
      expect(stage.geometry.coordinates[0]).toHaveLength(3);
    });

    test('ne devrait pas utiliser de piste en mode asphalte', () => {
      const segments = gridSegments({ size: 7, overrides: (i) => (i < 3 ? { nature: 'Route empierrée' } : {}) });
      const mixed = buildNetwork(segments, CENTER);
      const [stage] = generateStages(mixed, { surface: 'asphalt', length: 'short', seed: 3 }).stages;
      expect(stage.stats.surfacePct.gravel).toBe(0);
    });

    test('devrait privilégier la terre en mode terre', () => {
      const segments = gridSegments({ size: 7, overrides: (i) => (i < 4 ? { nature: 'Route empierrée' } : {}) });
      const mixed = buildNetwork(segments, CENTER);
      const [stage] = generateStages(mixed, { surface: 'gravel', length: 'short', seed: 3 }).stages;
      expect(stage.stats.surfacePct.gravel).toBeGreaterThan(50);
    });

    test("devrait imposer au moins 60 % de terre en mode terre et un vrai mélange en mixte", () => {
      // Moitié gauche de la grille en pistes, moitié droite goudronnée
      const segments = gridSegments({ size: 7, overrides: (i) => (i < 3 ? { nature: 'Route empierrée' } : {}) });
      const net = buildNetwork(segments, CENTER);
      for (let seed = 1; seed <= 4; seed++) {
        const gravel = generateStages(net, { surface: 'gravel', length: 'short', seed });
        for (const stage of gravel.stages) expect(100 - stage.stats.surfacePct.paved).toBeGreaterThanOrEqual(59);
        expect(gravel.surfaceRelaxed).toBe(false);

        const mixed = generateStages(net, { surface: 'mixed', length: 'short', seed });
        for (const stage of mixed.stages) {
          expect(100 - stage.stats.surfacePct.paved).toBeGreaterThanOrEqual(24);
          expect(100 - stage.stats.surfacePct.paved).toBeLessThanOrEqual(76);
        }
      }
    });

    test('devrait accepter moins de terre si la zone en manque, en le signalant', () => {
      // Une seule piste (~1,9 km, tracé sinueux) au milieu d'un réseau goudronné : 60 % de terre impossible sur 5 km
      const segments = gridSegments({
        size: 7,
        overrides: (i, j, dir) => (i === 3 && dir === 'v' && j === 2 ? { nature: 'Route empierrée' } : {}),
      });
      const result = generateStages(buildNetwork(segments, CENTER), { surface: 'gravel', length: 'short', seed: 2 });
      expect(result.stages.length).toBeGreaterThan(0);
      expect(result.surfaceRelaxed).toBe(true);
      expect(100 - result.stages[0].stats.surfacePct.paved).toBeGreaterThanOrEqual(34);
    });

    test('devrait découper le tracé en portions de revêtement contiguës', () => {
      const segments = gridSegments({ size: 7, overrides: (i) => (i < 3 ? { nature: 'Route empierrée' } : {}) });
      const [stage] = generateStages(buildNetwork(segments, CENTER), { surface: 'mixed', seed: 3 }).stages;
      const { surfaces, geometry } = stage;
      expect(surfaces[0].from).toBe(0);
      expect(surfaces.at(-1).to).toBe(geometry.coordinates.length - 1);
      surfaces.slice(1).forEach((section, i) => {
        expect(section.from).toBe(surfaces[i].to);
        expect(section.surface).not.toBe(surfaces[i].surface);
      });
    });

    test('devrait retourner une liste vide si le réseau est trop petit', () => {
      const tiny = buildNetwork(gridSegments({ size: 2 }), CENTER);
      const result = generateStages(tiny, { length: 'long', seed: 1 });
      expect(result.stages).toEqual([]);
    });

    test("devrait toujours laisser une route pour rejoindre le départ et quitter l'arrivée", () => {
      for (let seed = 1; seed <= 6; seed++) {
        const { stages } = generateStages(network, { seed, length: 'medium' });
        const keys = new Map(network.nodes.map((n, i) => [coordKey(n.coord), i]));
        const stageNodes = new Set(stages[0].geometry.coordinates.map(coordKey).filter((k) => keys.has(k)).map((k) => keys.get(k)));
        const start = keys.get(coordKey(stages[0].start));
        const finish = keys.get(coordKey(stages[0].finish));
        expect(hasExit(network, start, stageNodes)).toBe(true);
        expect(hasExit(network, finish, stageNodes)).toBe(true);
      }
    });

    test('ne devrait jamais finir dans une impasse fermée par la spéciale', () => {
      // Une boucle de 12 km sans autre accès qu'un seul carrefour : impossible d'y finir
      const loop = [];
      const pts = Array.from({ length: 13 }, (_, i) => {
        const a = (i / 12) * 2 * Math.PI;
        return [6.1 + 0.03 * Math.cos(a), 44.6 + 0.02 * Math.sin(a)];
      });
      for (let i = 0; i < 12; i++) loop.push(segment(wiggly(pts[i], pts[(i + 1) % 12])));
      const access = segment(wiggly([6.1 + 0.03, 44.6], [6.2, 44.6]), { importance: 3 });
      const net = buildNetwork([...loop, access], CENTER);

      const result = generateStages(net, { length: 'medium', seed: 4 });
      for (const stage of result.stages) {
        expect(stage.finish).not.toEqual(stage.start);
        const ends = [stage.start, stage.finish].map(coordKey);
        expect(ends).not.toEqual(expect.arrayContaining([coordKey(pts[3]), coordKey(pts[6])]));
      }
    });

    test('ne devrait pas reproposer un tracé déjà vu', () => {
      const seen = [];
      for (let click = 0; click < 4; click++) {
        const { stages } = generateStages(network, { seed: 99, avoid: seen });
        for (const s of stages) expect(seen).not.toContain(s.id);
        seen.push(...stages.map((s) => s.id));
      }
    });

    test('devrait signaler une zone épuisée et faire tourner les variantes', () => {
      const small = buildNetwork(gridSegments({ size: 4 }), CENTER);
      const seen = [];
      let exhausted = false;
      for (let click = 0; click < 15 && !exhausted; click++) {
        const result = generateStages(small, { length: 'short', seed: click, avoid: seen });
        exhausted = result.exhausted;
        expect(result.stages.length).toBeGreaterThan(0); // jamais de résultat vide, même épuisée
        seen.push(...result.stages.map((s) => s.id));
      }
      expect(exhausted).toBe(true);
    });

    test('devrait rejeter des options inconnues', () => {
      expect(() => generateStages(network, { surface: 'neige' })).toThrow();
      expect(() => generateStages(network, { length: 'marathon' })).toThrow();
    });
  });

  describe('preferencesFor', () => {
    test('devrait désactiver les impasses courtes', () => {
      const segments = [
        segment(wiggly([6, 44.5], [6.02, 44.5])),
        segment(wiggly([6.02, 44.5], [6.04, 44.5])),
        segment(wiggly([6.02, 44.5], [6.02, 44.503], { points: 6 })), // impasse de ~330 m
      ];
      const net = buildNetwork(segments, CENTER);
      const { pref } = preferencesFor(net, 'asphalt');
      expect(pref[2]).toBe(0);
      expect(pref[0]).toBeGreaterThan(0);
    });
  });

  describe('computeReach', () => {
    test('devrait mesurer la distance parcourable au-delà de chaque tronçon', () => {
      const segments = [
        segment(wiggly([6, 44.5], [6.01, 44.5])),
        segment(wiggly([6.01, 44.5], [6.02, 44.5])),
      ];
      const net = buildNetwork(segments, CENTER);
      const pref = new Float64Array([1, 1]);
      const reach = computeReach(net, pref);
      const [e0, e1] = net.edges;
      expect(reach[0]).toBeCloseTo(e0.lengthKm + e1.lengthKm, 5); // e0 dans le sens a→b puis e1
      expect(reach[1]).toBeCloseTo(e0.lengthKm, 5); // e0 à rebours : cul-de-sac
    });
  });

  describe('roadbook', () => {
    let stage;
    beforeAll(() => {
      [stage] = generateStages(network, { seed: 3 }).stages;
    });

    test('devrait commencer par CH/départ et finir par arrivée lancée puis point stop', () => {
      const types = stage.roadbook.map((c) => c.type);
      expect(types[0]).toBe('start');
      expect(types.slice(-2)).toEqual(['finish', 'stop']);
      expect(stage.roadbook.at(-2).km).toBeCloseTo(stage.stats.lengthKm, 2);
      expect(stage.roadbook.at(-1).km).toBeGreaterThan(stage.stats.lengthKm);
    });

    test('devrait numéroter les cases et donner des partiels cohérents', () => {
      stage.roadbook.forEach((c, i) => {
        expect(c.n).toBe(i + 1);
        const expected = i === 0 ? 0 : c.km - stage.roadbook[i - 1].km;
        expect(c.partial).toBeCloseTo(expected, 2);
        expect(c.partial).toBeGreaterThanOrEqual(0);
      });
    });

    test('devrait dessiner une tulipe à chaque carrefour, cohérente avec la direction', () => {
      const junctions = stage.roadbook.filter((c) => c.type === 'junction');
      expect(junctions.length).toBeGreaterThan(0);
      for (const c of junctions) {
        expect(c.tulip.entry).not.toBeNull();
        expect(c.tulip.exit).toBe(c.angle);
        expect(c.tulip.others.length).toBeGreaterThan(0);
      }
    });

    test('le chemin vers le point stop devrait suivre la route, pas une ligne droite', () => {
      const { haversineKm } = require('../../utils/geometry');
      const vertices = gridSegments({ size: 7 }).flatMap((seg) => seg.coords);
      for (const p of stage.stop.path) {
        const nearest = Math.min(...vertices.map((v) => haversineKm(p, v)));
        expect(nearest).toBeLessThan(0.002); // sommet réel d'une route (à 2 m près)
      }
      // Pas de saut à travers champs : les points se suivent au pas de la géométrie routière
      stage.stop.path.slice(1).forEach((p, i) => expect(haversineKm(stage.stop.path[i], p)).toBeLessThan(0.1));
      expect(stage.stop.distanceKm).toBeGreaterThanOrEqual(0.3);
    });

    test('le point stop devrait être sur une route qui quitte la spéciale', () => {
      expect(stage.stop.distanceKm).toBeGreaterThan(0.1);
      const onStage = new Set(stage.geometry.coordinates.map(coordKey));
      expect(onStage.has(coordKey(stage.stop.coord))).toBe(false);
    });
  });

  describe('hasExit', () => {
    // A — B — C — D, D relié à un grand axe
    const segments = [
      segment([[6, 44.5, 0], [6.01, 44.5, 0]]),
      segment([[6.01, 44.5, 0], [6.02, 44.5, 0]]),
      segment([[6.02, 44.5, 0], [6.03, 44.5, 0]]),
      segment([[6.03, 44.5, 0], [6.03, 44.6, 0]], { importance: 1, nature: 'Route à 2 chaussées' }),
    ];

    test('devrait trouver une sortie qui contourne la spéciale', () => {
      const net = buildNetwork(segments, CENTER);
      net.nodes.forEach((n) => { n.anchor = n.coord[0] === 6.03; });
      const idx = (lon) => net.nodes.findIndex((n) => n.coord[0] === lon && n.coord[1] === 44.5);
      expect(hasExit(net, idx(6.01), new Set([idx(6), idx(6.01)]))).toBe(true);
    });

    test('devrait détecter une arrivée enfermée', () => {
      const net = buildNetwork(segments, CENTER);
      net.nodes.forEach((n) => { n.anchor = n.coord[0] === 6.03; });
      const idx = (lon) => net.nodes.findIndex((n) => n.coord[0] === lon && n.coord[1] === 44.5);
      // Arrivée en A : la seule route repart par B, qui fait partie de la spéciale
      expect(hasExit(net, idx(6), new Set([idx(6), idx(6.01), idx(6.02)]))).toBe(false);
    });
  });

  describe('turnLabel', () => {
    test.each([
      [5, 'Tout droit'],
      [-40, 'Légèrement à gauche'],
      [90, 'À droite'],
      [-160, 'Épingle gauche'],
    ])('%i° → %s', (angle, label) => {
      expect(turnLabel(angle)).toBe(label);
    });
  });

  describe('elevationStats', () => {
    test('devrait calculer dénivelés et pente maximale', () => {
      const cum = [0, 0.5, 1];
      const stats = elevationStats(cum, [100, 150, 120]);
      expect(stats.min).toBe(100);
      expect(stats.max).toBe(150);
      expect(stats.gain).toBe(50);
      expect(stats.loss).toBe(30);
      expect(stats.maxSlopePct).toBeCloseTo(10, 0);
    });

    test('devrait retourner null sans altitude', () => {
      expect(elevationStats([0, 1], [null, null])).toBeNull();
    });
  });
});

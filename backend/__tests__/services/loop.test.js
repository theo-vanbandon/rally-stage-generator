const {
  generateStages,
  loopHubs,
  loopCompactness,
  insidePolygon,
  describeStage,
  reverseCandidate,
  evaluate,
  preferencesFor,
  hasExit,
  LOOP_PRESETS,
  SHARED_PRESETS,
  LENGTH_PRESETS,
} = require('../../services/stageGenerator');
const { buildNetwork } = require('../../services/roadNetwork');
const { gridSegments, segment, wiggly, CENTER } = require('../fixtures/network');
const { haversineKm } = require('../../utils/geometry');

const coordKey = (c) => `${c[0]},${c[1]}`;
const GRID = { size: 9, step: 0.007, amplitude: 0.0006 }; // ~1 km entre carrefours, pâtés de ~4 km de tour
const STEP = GRID.step;
const gridNode = (i, j) => [CENTER.lon + i * STEP, CENTER.lat + j * STEP];

/** Grille dont le carrefour (3, 3) est découpé en deux nœuds à ~16 m l'un de l'autre (carrefour décalé) */
function offsetCrossroadSegments() {
  const A = [CENTER.lon + 3 * STEP - 0.0001, CENTER.lat + 3 * STEP];
  const B = [CENTER.lon + 3 * STEP + 0.0001, CENTER.lat + 3 * STEP];
  const hub = gridNode(3, 3);
  const isHub = (p) => p[0] === hub[0] && p[1] === hub[1];
  const segments = gridSegments(GRID).map((seg) => {
    const first = seg.coords[0];
    const last = seg.coords.at(-1);
    if (!isHub(first) && !isHub(last)) return seg;
    const other = isHub(first) ? last : first;
    // ouest et nord → A ; est et sud → B
    const target = other[0] < hub[0] || other[1] > hub[1] ? A : B;
    const coords = seg.coords.map((c) => [...c]);
    const k = isHub(first) ? 0 : coords.length - 1;
    coords[k] = [target[0], target[1], coords[k][2]];
    return { ...seg, coords };
  });
  segments.push(segment([[...A, 520], [...B, 520]]));
  return { segments, A, B };
}

describe('Spéciales avec boucle', () => {
  let network;

  beforeAll(() => {
    network = buildNetwork(gridSegments(GRID), CENTER);
  });

  describe('generateStages({ loop: true })', () => {
    const SEEDS = [1, 2, 3, 4, 5];
    let results;

    beforeAll(() => {
      results = SEEDS.map((seed) => generateStages(network, { length: 'medium', seed, loop: true }));
    });

    test('devrait générer des spéciales avec une boucle de la bonne longueur', () => {
      const [minKm, maxKm] = LENGTH_PRESETS.medium;
      const [loopMin, loopMax] = LOOP_PRESETS.medium;
      for (const { stages, relaxed } of results) {
        expect(stages.length).toBeGreaterThan(0);
        expect(relaxed).toBe(false);
        for (const stage of stages) {
          expect(stage.stats.lengthKm).toBeGreaterThanOrEqual(minKm);
          expect(stage.stats.lengthKm).toBeLessThanOrEqual(maxKm + 0.01);
          expect(stage.stats.loop).not.toBeNull();
          expect(stage.stats.loop.lengthKm).toBeGreaterThanOrEqual(loopMin - 0.01);
          expect(stage.stats.loop.lengthKm).toBeLessThanOrEqual(loopMax + 0.01);
          expect(stage.stats.loop.fromKm).toBeGreaterThanOrEqual(1); // un vrai tronçon avant la boucle
        }
      }
    });

    test('devrait passer deux fois par un seul carrefour, jamais deux fois sur la même route', () => {
      const junctionKeys = new Set(network.nodes.map((n) => coordKey(n.coord)));
      for (const { stages } of results) {
        for (const stage of stages) {
          const coords = stage.geometry.coordinates.map(coordKey);
          const junctions = coords.filter((k) => junctionKeys.has(k));
          const counts = new Map();
          junctions.forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1));
          const repeated = [...counts.entries()].filter(([, n]) => n > 1);
          expect(repeated).toHaveLength(1);
          expect(repeated[0][1]).toBe(2);
          expect(repeated[0][0]).toBe(coordKey(stage.stats.loop.coord));
          // Aucune portion de route parcourue deux fois
          const pieces = coords.slice(1).map((k, i) => [coords[i], k].sort().join('|'));
          expect(new Set(pieces).size).toBe(pieces.length);
        }
      }
    });

    test('devrait signaler les deux passages au carrefour de la boucle dans le roadbook', () => {
      for (const { stages } of results) {
        for (const stage of [stages[0], stages[0].reverse]) {
          const loopCases = stage.roadbook.filter((c) => c.notes?.some((n) => n.startsWith('Boucle')));
          expect(loopCases).toHaveLength(2);
          expect(loopCases[0].notes.join(' ')).toMatch(/1er passage/);
          expect(loopCases[1].notes.join(' ')).toMatch(/2e passage/);
          expect(loopCases.every((c) => coordKey(c.coord) === coordKey(loopCases[0].coord))).toBe(true);
          expect(loopCases[1].km - loopCases[0].km).toBeCloseTo(stage.stats.loop.lengthKm, 1);
          expect(loopCases.every((c) => c.danger >= 1)).toBe(true);
        }
      }
    });

    test('le sens inverse garde la même boucle', () => {
      for (const { stages } of results) {
        const [stage] = stages;
        expect(stage.reverse.stats.loop.lengthKm).toBeCloseTo(stage.stats.loop.lengthKm, 1);
        expect(coordKey(stage.reverse.stats.loop.coord)).toBe(coordKey(stage.stats.loop.coord));
      }
    });

    test("le départ reste accessible et l'arrivée reste ouverte", () => {
      const keys = new Map(network.nodes.map((n, i) => [coordKey(n.coord), i]));
      for (const { stages } of results) {
        for (const stage of stages) {
          const stageNodes = new Set(
            stage.geometry.coordinates.map(coordKey).filter((k) => keys.has(k)).map((k) => keys.get(k))
          );
          expect(hasExit(network, keys.get(coordKey(stage.start)), stageNodes)).toBe(true);
          expect(hasExit(network, keys.get(coordKey(stage.finish)), stageNodes)).toBe(true);
        }
      }
    });

    test('devrait être reproductible avec la même graine', () => {
      const again = generateStages(network, { length: 'medium', seed: 1, loop: true });
      expect(again.stages[0].id).toBe(results[0].stages[0].id);
    });

    test('devrait varier les boucles selon la graine', () => {
      const loops = new Set(results.map(({ stages }) => `${coordKey(stages[0].stats.loop.coord)}|${stages[0].stats.loop.lengthKm}`));
      expect(loops.size).toBeGreaterThan(2);
    });

    test('sans boucle demandée, aucune boucle', () => {
      const { stages } = generateStages(network, { length: 'medium', seed: 1 });
      expect(stages[0].stats.loop).toBeNull();
      expect(stages[0].roadbook.some((c) => c.notes?.some((n) => n.startsWith('Boucle')))).toBe(false);
    });
  });

  describe('boucle avec portion commune', () => {
    const SEEDS = [1, 2, 3, 4];
    let results;
    beforeAll(() => {
      results = SEEDS.map((seed) => generateStages(network, { length: 'medium', seed, loop: 'shared' }));
    });

    test('devrait générer une portion et une boucle de bonnes longueurs', () => {
      const [minKm, maxKm] = LENGTH_PRESETS.medium;
      const [loopMin, loopMax] = LOOP_PRESETS.medium;
      const [sharedMin, sharedMax] = SHARED_PRESETS.medium;
      for (const { stages, relaxed } of results) {
        expect(stages.length).toBeGreaterThan(0);
        expect(relaxed).toBe(false);
        for (const stage of stages) {
          const { loop } = stage.stats;
          expect(loop.kind).toBe('shared');
          expect(stage.stats.lengthKm).toBeGreaterThanOrEqual(minKm);
          expect(stage.stats.lengthKm).toBeLessThanOrEqual(maxKm + 0.01);
          expect(loop.sharedKm).toBeGreaterThanOrEqual(sharedMin - 0.01);
          expect(loop.sharedKm).toBeLessThanOrEqual(sharedMax + 0.01);
          expect(loop.lengthKm).toBeGreaterThanOrEqual(loopMin - 0.01);
          expect(loop.lengthKm).toBeLessThanOrEqual(loopMax + 0.01);
          expect(loop.fromKm).toBeCloseTo(loop.sharedFromKm + loop.sharedKm, 1);
          expect(loop.sharedFromKm).toBeGreaterThanOrEqual(1);
        }
      }
    });

    test("la portion est parcourue deux fois dans le même sens, rien d'autre n'est repris", () => {
      for (const { stages } of results) {
        for (const stage of stages) {
          const c = stage.geometry.coordinates.map(coordKey);
          const pieces = c.slice(1).map((k, i) => `${c[i]}>${k}`).filter((p) => !p.startsWith(p.split('>')[1] + '>'));
          const counts = new Map();
          pieces.forEach((p) => counts.set(p, (counts.get(p) ?? 0) + 1));
          // Jamais de face-à-face : aucune portion dans les deux sens
          for (const p of counts.keys()) {
            const [a, b] = p.split('>');
            expect(counts.has(`${b}>${a}`)).toBe(false);
          }
          // Les morceaux repris deux fois forment exactement la portion commune
          const doubled = [...counts.entries()].filter(([, n]) => n === 2);
          expect([...counts.values()].every((n) => n <= 2)).toBe(true);
          const doubledKm = doubled.reduce((sum, [p]) => {
            const [a, b] = p.split('>').map((k) => k.split(',').map(Number));
            return sum + haversineKm(a, b);
          }, 0);
          expect(doubledKm).toBeCloseTo(stage.stats.loop.sharedKm, 1);
        }
      }
    });

    test('le roadbook signale les 4 passages, dans les deux sens', () => {
      for (const { stages } of results) {
        for (const stage of [stages[0], stages[0].reverse]) {
          const passes = stage.roadbook.filter((c) => c.notes?.some((n) => n.startsWith('Boucle')));
          expect(passes.map((c) => c.notes.find((n) => n.startsWith('Boucle')))).toEqual([
            expect.stringMatching(/entrée sur la portion commune/),
            expect.stringMatching(/départ de la boucle/),
            expect.stringMatching(/retour sur la portion commune/),
            expect.stringMatching(/sortie de la boucle/),
          ]);
          // A, B, A, B
          expect(coordKey(passes[2].coord)).toBe(coordKey(passes[0].coord));
          expect(coordKey(passes[3].coord)).toBe(coordKey(passes[1].coord));
          expect(passes[1].km - passes[0].km).toBeCloseTo(stage.stats.loop.sharedKm, 1);
          expect(passes[2].km - passes[1].km).toBeCloseTo(stage.stats.loop.lengthKm, 1);
        }
      }
    });

    test("le départ reste accessible et l'arrivée reste ouverte", () => {
      const keys = new Map(network.nodes.map((n, i) => [coordKey(n.coord), i]));
      for (const { stages } of results) {
        for (const stage of stages) {
          const stageNodes = new Set(stage.geometry.coordinates.map(coordKey).filter((k) => keys.has(k)).map((k) => keys.get(k)));
          expect(hasExit(network, keys.get(coordKey(stage.start)), stageNodes)).toBe(true);
          expect(hasExit(network, keys.get(coordKey(stage.finish)), stageNodes)).toBe(true);
        }
      }
    });

    test('loop: true reste une boucle par un carrefour (anciens liens)', () => {
      const { stages } = generateStages(network, { length: 'medium', seed: 1, loop: true });
      expect(stages[0].stats.loop.kind).toBe('junction');
    });
  });

  test("ne devrait rien proposer s'il n'existe aucun carrefour de 4 routes", () => {
    // Échelle : deux longues routes reliées par des barreaux, que des carrefours en T
    const segments = [];
    for (let i = 0; i < 8; i++) {
      const a = [CENTER.lon + i * STEP, CENTER.lat];
      const b = [CENTER.lon + (i + 1) * STEP, CENTER.lat];
      const c = [CENTER.lon + i * STEP, CENTER.lat + STEP];
      const d = [CENTER.lon + (i + 1) * STEP, CENTER.lat + STEP];
      segments.push(segment(wiggly(a, b)), segment(wiggly(c, d)));
      if (i % 2 === 0) segments.push(segment(wiggly(a, c)));
    }
    const ladder = buildNetwork(segments, CENTER);
    expect(loopHubs(ladder, preferencesFor(ladder, 'asphalt'))).toHaveLength(0);
    expect(generateStages(ladder, { length: 'short', seed: 1, loop: true }).stages).toHaveLength(0);
  });

  describe('carrefour décalé', () => {
    let offset;
    let net;
    beforeAll(() => {
      offset = offsetCrossroadSegments();
      net = buildNetwork(offset.segments, CENTER);
    });

    test("devrait servir de pivot (1er passage par un nœud, 2e par l'autre)", () => {
      const prefs = preferencesFor(net, 'asphalt');
      const keyOf = (n) => coordKey(net.nodes[n].coord);
      const pairs = loopHubs(net, prefs)
        .filter((h) => h.first !== h.second)
        .map((h) => [keyOf(h.first), keyOf(h.second)]);
      expect(pairs).toContainEqual([coordKey(offset.A), coordKey(offset.B)]);
      expect(pairs).toContainEqual([coordKey(offset.B), coordKey(offset.A)]);
    });

    test('le roadbook signale la boucle même si les deux passages sont sur deux nœuds voisins (et en sens inverse)', () => {
      const prefs = preferencesFor(net, 'asphalt');
      const nodeAt = (c) => net.nodes.findIndex((n) => coordKey(n.coord) === coordKey(c));
      const edgeBetween = (u, v) => net.nodes[u].edges.find((id) => {
        const e = net.edges[id];
        return (e.a === u && e.b === v) || (e.a === v && e.b === u);
      });
      // Ouest → A → nord → tour d'un pâté → retour par l'est sur B → sud
      const route = [gridNode(1, 3), gridNode(2, 3), offset.A, gridNode(3, 4), gridNode(4, 4), gridNode(4, 3), offset.B, gridNode(3, 2), gridNode(3, 1)].map(nodeAt);
      expect(route.every((n) => n >= 0)).toBe(true);
      const steps = route.slice(1).map((v, i) => {
        const id = edgeBetween(route[i], v);
        return { edge: id, forward: net.edges[id].a === route[i] };
      });
      const walk = {
        steps,
        lengthKm: steps.reduce((s, st) => s + net.edges[st.edge].lengthKm, 0),
        startNode: route[0],
        endNode: route.at(-1),
        visited: new Set(route),
        finishOk: true,
        loopSteps: { kind: 'junction', passes: [2, 6] }, // départs depuis A (1er passage) puis depuis B (2e passage)
      };
      const stage = describeStage(net, prefs, { walk, eval: evaluate(net, prefs, walk) });
      const loopCases = stage.roadbook.filter((c) => c.notes?.some((n) => n.startsWith('Boucle')));
      expect(loopCases.map((c) => c.notes.find((n) => n.startsWith('Boucle')))).toEqual([
        expect.stringMatching(/1er passage/),
        expect.stringMatching(/2e passage/),
      ]);
      expect(stage.stats.loop.lengthKm).toBeGreaterThan(3);

      const reversed = describeStage(net, prefs, reverseCandidate({ walk, eval: evaluate(net, prefs, walk) }));
      const revCases = reversed.roadbook.filter((c) => c.notes?.some((n) => n.startsWith('Boucle')));
      expect(revCases.map((c) => coordKey(c.coord))).toEqual([...loopCases].reverse().map((c) => coordKey(c.coord)));
      expect(reversed.stats.loop.lengthKm).toBeCloseTo(stage.stats.loop.lengthKm, 1);
    });
  });

  describe('géométrie', () => {
    test('compacité : ~0,8 pour un pâté de maisons carré, faible pour un aller-retour allongé', () => {
      const nodeAt = (c) => network.nodes.findIndex((n) => coordKey(n.coord) === coordKey(c));
      const stepsThrough = (pts) => {
        const ids = pts.map(nodeAt);
        return ids.slice(1).map((v, i) => {
          const id = network.nodes[ids[i]].edges.find((eid) => {
            const e = network.edges[eid];
            return (e.a === ids[i] && e.b === v) || (e.b === ids[i] && e.a === v);
          });
          return { edge: id, forward: network.edges[id].a === ids[i] };
        });
      };
      const square = stepsThrough([gridNode(2, 2), gridNode(3, 2), gridNode(3, 3), gridNode(2, 3), gridNode(2, 2)]);
      const thin = stepsThrough([gridNode(1, 2), gridNode(5, 2), gridNode(5, 3), gridNode(1, 3), gridNode(1, 2)].flatMap((p, i, a) => {
        if (i === 0) return [p];
        const [pi, pj] = [(p[0] - CENTER.lon) / STEP, (p[1] - CENTER.lat) / STEP].map(Math.round);
        const [qi, qj] = [(a[i - 1][0] - CENTER.lon) / STEP, (a[i - 1][1] - CENTER.lat) / STEP].map(Math.round);
        const n = Math.max(Math.abs(pi - qi), Math.abs(pj - qj));
        return Array.from({ length: n }, (_, k) => gridNode(qi + ((pi - qi) * (k + 1)) / n, qj + ((pj - qj) * (k + 1)) / n));
      }));
      expect(loopCompactness(network, square)).toBeGreaterThan(0.5);
      expect(loopCompactness(network, thin)).toBeLessThan(loopCompactness(network, square));
    });

    test('insidePolygon', () => {
      const sq = [[0, 0], [1, 0], [1, 1], [0, 1]];
      expect(insidePolygon([0.5, 0.5], sq)).toBe(true);
      expect(insidePolygon([1.5, 0.5], sq)).toBe(false);
    });
  });
});

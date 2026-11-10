const request = require('supertest');
const express = require('express');

jest.mock('../../services/geocoder', () => ({ geocode: jest.fn() }));
jest.mock('../../services/bdtopo', () => ({ fetchRoads: jest.fn() }));
// Pas d'écriture disque pendant les tests
jest.mock('../../services/cache', () => {
  const actual = jest.requireActual('../../services/cache');
  return { ...actual, DEFAULT_DISK_DIR: null };
});

const { fetchRoads } = require('../../services/bdtopo');
const generateRoutes = require('../../routes/generate');
const liaisonRoutes = require('../../routes/liaisons');
const { gridSegments, segment, wiggly, CENTER } = require('../fixtures/network');

describe('POST /api/liaisons', () => {
  let app;
  beforeAll(() => {
    app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/generate', generateRoutes);
    app.use('/api/liaisons', liaisonRoutes);
    fetchRoads.mockResolvedValue(gridSegments({ size: 9 }));
  });

  const asInput = (s) => ({ start: s.start, finish: s.finish, stop: s.stop, coordinates: s.geometry.coordinates.map(([lon, lat]) => [lon, lat]) });

  test("calcule les liaisons dans l'ordre demandé, sur le réseau de la génération", async () => {
    const gen = await request(app).post('/api/generate').send({ lat: CENTER.lat, lon: CENTER.lon, radiusKm: 10, seed: 2 });
    expect(gen.status).toBe(200);
    const stages = [gen.body.stage, ...gen.body.alternatives];
    const order = stages.map(asInput);

    const res = await request(app)
      .post('/api/liaisons')
      .send({ lat: CENTER.lat, lon: CENTER.lon, radiusKm: gen.body.radiusKm, stages: order });
    expect(res.status).toBe(200);
    expect(res.body.liaisons).toHaveLength(2);
    for (const l of res.body.liaisons) {
      expect(l.ok).toBe(true);
      expect(l.coordinates.at(-1)).toEqual(order[l.to].start);
    }
    expect(fetchRoads).toHaveBeenCalledTimes(1); // réseau réutilisé depuis le cache
  });

  test('recalcule une liaison impossible sur une zone élargie', async () => {
    // Le départ de la 2e spéciale n'est relié au reste que par une route située hors de la zone demandée
    const outside = [CENTER.lon + 0.12, CENTER.lat];
    const corner = [CENTER.lon + 0.08, CENTER.lat];
    fetchRoads.mockClear();
    fetchRoads.mockImplementation(async (lat, lon, radiusKm) =>
      radiusKm === 10 ? gridSegments({ size: 9 }) : [...gridSegments({ size: 9 }), segment(wiggly(corner, outside))]
    );
    const gen = await request(app).post('/api/generate').send({ lat: CENTER.lat + 1, lon: CENTER.lon, radiusKm: 10, seed: 2 });
    const stages = [gen.body.stage, ...gen.body.alternatives].map(asInput);
    const res = await request(app)
      .post('/api/liaisons')
      .send({ lat: CENTER.lat + 1, lon: CENTER.lon, radiusKm: 10, stages: [stages[0], { ...stages[1], start: outside }] });

    expect(res.status).toBe(200);
    const [liaison] = res.body.liaisons;
    expect(liaison.ok).toBe(true);
    expect(liaison.expandedKm).toBe(15);
    expect(liaison.coordinates.at(-1)).toEqual(outside);
    expect(fetchRoads.mock.calls.map((c) => c[2])).toEqual([10, 15]);
    fetchRoads.mockReset();
    fetchRoads.mockResolvedValue(gridSegments({ size: 9 }));
  });

  test.each([
    [{}, /lat et lon/],
    [{ lat: 44.5, lon: 6, radiusKm: 50, stages: [] }, /radiusKm/],
    [{ lat: 44.5, lon: 6, radiusKm: 10, stages: [{}] }, /entre 2 et/],
    [{ lat: 44.5, lon: 6, radiusKm: 10, stages: [{ start: [6, 44.5] }, { start: [6, 44.5] }] }, /Spéciale invalide/],
  ])('refuse une requête invalide %#', async (body, message) => {
    const res = await request(app).post('/api/liaisons').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });
});

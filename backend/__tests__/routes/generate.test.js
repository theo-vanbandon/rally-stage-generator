const request = require('supertest');
const express = require('express');

jest.mock('../../services/geocoder', () => ({ geocode: jest.fn() }));
jest.mock('../../services/bdtopo', () => ({ fetchRoads: jest.fn() }));
// Pas d'écriture disque pendant les tests
jest.mock('../../services/cache', () => {
  const actual = jest.requireActual('../../services/cache');
  return { ...actual, DEFAULT_DISK_DIR: null };
});

const { geocode } = require('../../services/geocoder');
const { fetchRoads } = require('../../services/bdtopo');
const generateRoutes = require('../../routes/generate');
const { parseRequest, searchRadii } = require('../../routes/generate');
const { gridSegments, CENTER } = require('../fixtures/network');

describe('Generate Routes', () => {
  let app;
  let lat = 44.5;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/generate', generateRoutes);
    jest.clearAllMocks();
    // Nouveau centre à chaque test pour ne pas réutiliser le cache du test précédent
    lat += 0.1;
    geocode.mockResolvedValue({ lat, lon: CENTER.lon, name: 'Gap', population: 41000 });
    // Un tableau neuf à chaque appel, comme le vrai service : la construction du graphe le consomme
    fetchRoads.mockImplementation(async () => gridSegments({ size: 7 }));
  });

  describe('parseRequest', () => {
    test('devrait appliquer les valeurs par défaut', () => {
      const params = parseRequest({ place: 'Gap' });
      expect(params).toEqual(expect.objectContaining({ radiusKm: 10, surface: 'asphalt', length: 'medium' }));
      expect(Number.isInteger(params.seed)).toBe(true);
    });

    test('devrait filtrer la liste des tracés à éviter', () => {
      const params = parseRequest({ place: 'Gap', avoid: ['abc', 42, 'x'.repeat(40), 'def'] });
      expect(params.avoid).toEqual(['abc', 'def']);
    });

    test('devrait essayer des rayons croissants plafonnés à 20 km', () => {
      expect(searchRadii(5)).toEqual([5, 10, 15]);
      expect(searchRadii(12)).toEqual([12, 17, 20]);
      expect(searchRadii(20)).toEqual([20]);
    });

    test("ne devrait activer la boucle que sur demande explicite", () => {
      expect(parseRequest({ place: 'Gap' }).loop).toBe(false);
      expect(parseRequest({ place: 'Gap', loop: true }).loop).toBe('junction');
      expect(parseRequest({ place: 'Gap', loop: 'shared' }).loop).toBe('shared');
      expect(parseRequest({ place: 'Gap', loop: 'oui' }).loop).toBe(false);
    });

    test('devrait accepter des coordonnées sans nom de ville', () => {
      expect(parseRequest({ lat: 44.5, lon: 6 })).toEqual(expect.objectContaining({ lat: 44.5, lon: 6 }));
    });
  });

  describe('POST /api/generate', () => {
    test('devrait retourner 400 si place est manquant', async () => {
      const response = await request(app).post('/api/generate').send({ postal: '75001', radiusKm: 10 });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('place is required');
    });

    test.each([
      [{ place: 'Gap', radiusKm: 50 }, /rayon/],
      [{ place: 'Gap', surface: 'neige' }, /surface/],
      [{ place: 'Gap', length: 'marathon' }, /length/],
    ])('devrait valider les paramètres %o', async (body, message) => {
      const response = await request(app).post('/api/generate').send(body);
      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(message);
    });

    test('devrait retourner 404 si la commune est inconnue', async () => {
      geocode.mockRejectedValue(new Error('Commune introuvable'));
      const response = await request(app).post('/api/generate').send({ place: 'Nulle-part' });
      expect(response.status).toBe(404);
      expect(response.body.ok).toBe(false);
    });

    test('devrait retourner 404 si aucune route trouvée', async () => {
      fetchRoads.mockResolvedValue([]);
      const response = await request(app).post('/api/generate').send({ place: 'Briançon', postal: '05100' });
      expect(response.status).toBe(404);
      expect(response.body.ok).toBe(false);
    });

    test('devrait élargir la zone quand le rayon demandé ne permet aucune spéciale', async () => {
      fetchRoads.mockResolvedValueOnce([]).mockResolvedValueOnce(gridSegments({ size: 7 }));
      const response = await request(app).post('/api/generate').send({ place: 'Chamonix', radiusKm: 10, seed: 1 });

      expect(response.status).toBe(200);
      expect(response.body.radiusKm).toBe(15);
      expect(response.body.expandedFrom).toBe(10);
    });

    test("devrait indiquer le dernier rayon réellement analysé quand l'élargissement bute sur une zone trop dense", async () => {
      fetchRoads
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(Object.assign(new Error('Zone trop dense'), { code: 'ZONE_TOO_LARGE' }));
      const response = await request(app).post('/api/generate').send({ place: 'Paris', radiusKm: 10 });

      expect(response.status).toBe(404);
      expect(response.body.error).toMatch(/dans 10 km/);
    });

    test('devrait refuser proprement une zone trop dense pour la mémoire du serveur', async () => {
      fetchRoads.mockRejectedValue(Object.assign(new Error('Zone trop dense pour être analysée'), { code: 'ZONE_TOO_LARGE' }));
      const response = await request(app).post('/api/generate').send({ place: 'Paris', radiusKm: 10 });

      expect(response.status).toBe(422);
      expect(response.body.error).toMatch(/trop dense/);
    });

    test('devrait retourner 502 si le service IGN est indisponible', async () => {
      fetchRoads.mockRejectedValue(new Error('Service IGN indisponible (timeout)'));
      const response = await request(app).post('/api/generate').send({ place: 'Gap' });
      expect(response.status).toBe(502);
    });

    test('devrait générer une spéciale avec alternatives', async () => {
      const response = await request(app)
        .post('/api/generate')
        .send({ place: 'Gap', postal: '05000', radiusKm: 10, seed: 42 });

      expect(response.status).toBe(200);
      expect(geocode).toHaveBeenCalledWith('Gap', '05000');
      expect(response.body.seed).toBe(42);
      expect(response.body.stage.geometry.type).toBe('LineString');
      expect(response.body.stage.stats.lengthKm).toBeGreaterThan(9);
      expect(response.body.alternatives.length).toBeGreaterThan(0);
      expect(response.body.meta.dataSource).toBe('fresh');
    });

    test('devrait générer une spéciale avec boucle sur demande', async () => {
      // Pâtés de ~4 km de tour : de quoi faire une boucle
      fetchRoads.mockImplementation(async () => gridSegments({ size: 9, step: 0.007, amplitude: 0.0006 }));
      const response = await request(app).post('/api/generate').send({ place: 'Laventie', seed: 3, loop: true });

      expect(response.status).toBe(200);
      expect(response.body.loop).toBe('junction');
      expect(response.body.stage.stats.loop.lengthKm).toBeGreaterThan(1);
      expect(response.body.stage.reverse.stats.loop).not.toBeNull();
    });

    test("devrait expliquer quand aucune boucle n'est possible", async () => {
      // Grille par défaut : pâtés de ~8 km de tour, trop grands pour une boucle
      const response = await request(app).post('/api/generate').send({ place: 'Sospel', radiusKm: 18, loop: true });

      expect(response.status).toBe(404);
      expect(response.body.error).toMatch(/avec boucle/);
    });

    test('devrait réutiliser le réseau en cache pour une nouvelle génération', async () => {
      await request(app).post('/api/generate').send({ place: 'Gap', seed: 1 });
      const second = await request(app).post('/api/generate').send({ place: 'Gap', seed: 2 });

      expect(fetchRoads).toHaveBeenCalledTimes(1);
      expect(second.body.meta.dataSource).toBe('memory');
    });

    test('ne devrait pas reproposer les tracés envoyés dans avoid', async () => {
      const first = await request(app).post('/api/generate').send({ place: 'Gap', seed: 5 });
      const seen = [first.body.stage, ...first.body.alternatives].map((s) => s.id);
      const second = await request(app).post('/api/generate').send({ place: 'Gap', seed: 5, avoid: seen });

      expect(second.body.exhausted).toBe(false);
      expect(seen).not.toContain(second.body.stage.id);
    });
  });
});

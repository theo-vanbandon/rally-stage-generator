const request = require('supertest');
const express = require('express');
const generateRoutes = require('../../routes/generate');

// Mock des services pour les tests unitaires
jest.mock('../../services/geocoder', () => ({
  geocode: jest.fn()
}));

jest.mock('../../services/overpass', () => ({
  queryOverpass: jest.fn()
}));

const { geocode } = require('../../services/geocoder');
const { queryOverpass } = require('../../services/overpass');

describe('Generate Routes', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/generate', generateRoutes);
    jest.clearAllMocks();
  });

  describe('POST /api/generate', () => {
    
    test('devrait retourner 400 si place est manquant', async () => {
      const response = await request(app)
        .post('/api/generate')
        .send({ postal: '75001', radiusKm: 10 });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('place is required');
    });

    test('devrait appeler geocode avec les bons paramètres', async () => {
      geocode.mockResolvedValue({ lat: 48.86, lon: 2.34 });
      queryOverpass.mockResolvedValue({ elements: [] });

      await request(app)
        .post('/api/generate')
        .send({ place: 'Paris', postal: '75001', radiusKm: 10 });
      
      expect(geocode).toHaveBeenCalledWith('Paris', '75001');
    });

    test('devrait retourner 404 si aucune route trouvée', async () => {
      geocode.mockResolvedValue({ lat: 48.86, lon: 2.34 });
      queryOverpass.mockResolvedValue({ elements: [] });

      const response = await request(app)
        .post('/api/generate')
        .send({ place: 'Paris', postal: '75001', radiusKm: 10 });
      
      expect(response.status).toBe(404);
      expect(response.body.ok).toBe(false);
    });
  });
});

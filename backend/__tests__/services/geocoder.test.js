const axios = require('axios');
const { geocode, normalize, pickCommune } = require('../../services/geocoder');

jest.mock('axios');

const commune = (nom, lon, lat, population = 1000) => ({
  nom,
  centre: { type: 'Point', coordinates: [lon, lat] },
  population,
});

describe('Geocoder Service', () => {
  beforeEach(() => jest.resetAllMocks());

  describe('normalize', () => {
    test('devrait ignorer accents, casse, tirets et abréviation de Saint', () => {
      expect(normalize('Saint-Étienne')).toBe(normalize('st etienne'));
      expect(normalize('La Bâtie-Vieille')).toBe('labatievieille');
    });
  });

  describe('pickCommune', () => {
    const communes = [commune('La Bâtie-Vieille', 6.15, 44.55), commune('Gap', 6.06, 44.58)];

    test('devrait choisir la commune au nom exact', () => {
      expect(pickCommune(communes, 'gap').nom).toBe('Gap');
    });

    test('devrait retourner null si aucun nom ne correspond', () => {
      expect(pickCommune(communes, 'Lille')).toBeNull();
    });
  });

  describe('geocode', () => {
    test('devrait utiliser geo.api.gouv.fr avec le code postal', async () => {
      axios.get.mockResolvedValueOnce({ data: [commune('La Bâtie-Vieille', 6.15, 44.55), commune('Gap', 6.0616, 44.5797, 41293)] });

      const result = await geocode('Gap', '05000');

      expect(axios.get).toHaveBeenCalledWith(
        'https://geo.api.gouv.fr/communes',
        expect.objectContaining({ params: expect.objectContaining({ codePostal: '05000' }) })
      );
      expect(result).toEqual({ lat: 44.5797, lon: 6.0616, name: 'Gap', population: 41293 });
    });

    test('devrait chercher par nom sans code postal', async () => {
      axios.get.mockResolvedValueOnce({ data: [commune('Lille', 3.0468, 50.6311)] });

      const result = await geocode('Lille');

      expect(axios.get.mock.calls[0][1].params).toEqual(expect.objectContaining({ nom: 'Lille' }));
      expect(result.name).toBe('Lille');
    });

    test('devrait basculer sur Nominatim si l\'API IGN est indisponible', async () => {
      axios.get
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce({ data: [{ lat: '44.56', lon: '6.08', name: 'Gap' }] });

      const result = await geocode('Gap', '05000');

      expect(axios.get.mock.calls[1][0]).toContain('nominatim');
      expect(result).toEqual({ lat: 44.56, lon: 6.08, name: 'Gap', population: null });
    });

    test('devrait rejeter une commune inconnue', async () => {
      axios.get.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });

      await expect(geocode('VilleQuiNExistePas', '00000')).rejects.toThrow(/aucune commune/);
    });
  });
});

const axios = require('axios');
const { fetchRoads, buildFilter, compactSegment } = require('../../services/bdtopo');

jest.mock('axios');

const feature = (props = {}, coords = [[6, 44, 500], [6.01, 44, -1000]]) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: coords },
  properties: {
    nature: 'Route à 1 chaussée',
    importance: '5',
    urbain: false,
    acces_vehicule_leger: 'Libre',
    sens_de_circulation: 'Double sens',
    position_par_rapport_au_sol: '0',
    prive: false,
    largeur_de_chaussee: 4,
    nombre_de_voies: 1,
    itineraire_vert: false,
    cpx_numero: 'D14',
    nom_collaboratif_gauche: null,
    ...props,
  },
});

describe('BD TOPO Service', () => {
  beforeEach(() => jest.resetAllMocks());

  describe('buildFilter', () => {
    test('devrait filtrer nature, importance et emprise (ordre lat,lon)', () => {
      const filter = buildFilter(44.5, 6, 10);
      expect(filter).toContain("nature IN ('Route à 1 chaussée'");
      expect(filter).toContain("'Bretelle'");
      expect(filter).not.toContain('importance'); // grands axes inclus : liaisons et intersections
      expect(filter).toMatch(/BBOX\(geometrie,44\.4\d+,5\.8\d+,44\.5\d+,6\.1\d+\)/);
    });
  });

  describe('compactSegment', () => {
    test('devrait convertir les propriétés IGN et marquer les altitudes inconnues', () => {
      const seg = compactSegment(feature());
      expect(seg).toEqual(
        expect.objectContaining({ nature: 'Route à 1 chaussée', importance: 5, urban: false, access: 'Libre', ref: 'D14', width: 4 })
      );
      expect(seg.coords).toEqual([[6, 44, 500], [6.01, 44, null]]);
    });

    test('devrait ignorer une géométrie dégénérée', () => {
      expect(compactSegment(feature({}, [[6, 44, 0]]))).toBeNull();
    });
  });

  describe('fetchRoads', () => {
    test('devrait récupérer toutes les pages', async () => {
      axios.get.mockImplementation((url, { params }) =>
        Promise.resolve({
          data: {
            numberMatched: 12000,
            features: Array.from({ length: params.STARTINDEX < 10000 ? 5000 : 2000 }, () => feature()),
          },
        })
      );

      const segments = await fetchRoads(44.5, 6, 10);

      expect(axios.get).toHaveBeenCalledTimes(3);
      expect(axios.get.mock.calls.map((c) => c[1].params.STARTINDEX)).toEqual([0, 5000, 10000]);
      expect(segments).toHaveLength(12000);
    });

    test('devrait refuser une zone trop vaste sans la télécharger', async () => {
      axios.get.mockResolvedValue({ data: { numberMatched: 400000, features: [feature()] } });
      await expect(fetchRoads(48.86, 2.35, 20)).rejects.toMatchObject({ code: 'ZONE_TOO_LARGE' });
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    test('devrait réessayer puis échouer proprement si l\'IGN ne répond pas', async () => {
      jest.useFakeTimers();
      axios.get.mockRejectedValue(new Error('ECONNRESET'));

      const promise = fetchRoads(44.5, 6, 10);
      const assertion = expect(promise).rejects.toThrow(/Service IGN indisponible/);
      await jest.runAllTimersAsync();
      await assertion;

      expect(axios.get).toHaveBeenCalledTimes(3);
      jest.useRealTimers();
    });
  });
});

import { exportGeoJSON, exportKML, exportGPX, stageFilename } from '../../services/exportService';
import { mockStage } from '../fixtures/stage';

global.URL.createObjectURL = jest.fn(() => 'mock-url');
global.URL.revokeObjectURL = jest.fn();

/** Lit le contenu du dernier Blob téléchargé */
const lastBlobText = () => {
  const blob = global.URL.createObjectURL.mock.calls.at(-1)[0];
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(blob);
  });
};

describe('Export Service', () => {
  let mockClick;
  let mockAnchor;

  beforeEach(() => {
    mockClick = jest.fn();
    mockAnchor = { href: '', download: '', click: mockClick };
    jest.spyOn(document, 'createElement').mockReturnValue(mockAnchor);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('stageFilename', () => {
    test('devrait produire un nom sans accents ni espaces', () => {
      expect(stageFilename(mockStage, 'Saint-Étienne-en-Dévoluy', 'gpx')).toBe('es-saint-etienne-en-devoluy-abc123.gpx');
    });
  });

  describe('exportGeoJSON', () => {
    test('devrait exporter le tracé et un point par case du roadbook', async () => {
      exportGeoJSON(mockStage, 'custom.geojson');

      expect(mockAnchor.download).toBe('custom.geojson');
      expect(mockClick).toHaveBeenCalled();
      const geojson = JSON.parse(await lastBlobText());
      expect(geojson.features).toHaveLength(6);
      expect(geojson.features[0].geometry.type).toBe('LineString');
      expect(geojson.features[2].properties).toEqual(
        expect.objectContaining({ name: 'Case 2 — km 0.85', case: 2, type: 'junction', partial: 0.85 })
      );
    });
  });

  describe('exportKML', () => {
    test('devrait exporter un tracé 3D', async () => {
      exportKML(mockStage);

      expect(mockAnchor.download).toBe('stage.kml');
      const kml = await lastBlobText();
      expect(kml).toContain('6.01,44.505,820');
      expect(kml).toContain('<name>Case 2 — km 0.85</name>');
    });
  });

  describe('exportGPX', () => {
    test('devrait inclure altitudes et waypoints', async () => {
      exportGPX(mockStage);

      expect(mockAnchor.download).toBe('stage.gpx');
      const gpx = await lastBlobText();
      expect(gpx).toContain('<ele>860</ele>');
      expect(gpx).toContain('<wpt lat="44.505" lon="6.01">');
      expect(gpx).toContain('<desc>À droite — D14 — Croisement route principale</desc>');
    });

    test('ne devrait rien exporter pour un tracé vide', () => {
      exportGPX({ ...mockStage, geometry: { type: 'LineString', coordinates: [] } });
      expect(mockClick).not.toHaveBeenCalled();
    });
  });
});

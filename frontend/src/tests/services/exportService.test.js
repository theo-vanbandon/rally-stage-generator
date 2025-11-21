import { exportGeoJSON, exportKML, exportGPX } from '../../services/exportService';

// Mock de URL.createObjectURL et document.createElement
global.URL.createObjectURL = jest.fn(() => 'mock-url');
global.URL.revokeObjectURL = jest.fn();

describe('Export Service', () => {
  let mockClick;
  let mockAnchor;

  beforeEach(() => {
    mockClick = jest.fn();
    mockAnchor = {
      href: '',
      download: '',
      click: mockClick
    };
    jest.spyOn(document, 'createElement').mockReturnValue(mockAnchor);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const sampleGeojson = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[2.35, 48.85], [2.36, 48.86]]
      }
    }]
  };

  describe('exportGeoJSON', () => {
    test('devrait créer un fichier avec le bon nom', () => {
      exportGeoJSON(sampleGeojson);
      
      expect(mockAnchor.download).toBe('stage.geojson');
      expect(mockClick).toHaveBeenCalled();
    });

    test('devrait permettre un nom personnalisé', () => {
      exportGeoJSON(sampleGeojson, 'custom.geojson');
      
      expect(mockAnchor.download).toBe('custom.geojson');
    });
  });

  describe('exportKML', () => {
    test('devrait créer un fichier KML', () => {
      exportKML(sampleGeojson);
      
      expect(mockAnchor.download).toBe('stage.kml');
      expect(mockClick).toHaveBeenCalled();
    });
  });

  describe('exportGPX', () => {
    test('devrait créer un fichier GPX', () => {
      exportGPX(sampleGeojson);
      
      expect(mockAnchor.download).toBe('stage.gpx');
      expect(mockClick).toHaveBeenCalled();
    });
  });
});

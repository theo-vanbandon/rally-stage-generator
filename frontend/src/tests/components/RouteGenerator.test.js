import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RouteGenerator from '../../components/RouteGenerator';
import { generateStage } from '../../services/api';
import { mockStage } from '../fixtures/stage';

// Leaflet ne fonctionne pas dans jsdom
jest.mock('../../components/MapView', () => ({
  __esModule: true,
  default: () => <div data-testid="map" />,
  SURFACE_STYLES: { paved: { color: 'red' }, gravel: { color: 'brown' }, dirt: { color: 'brown', dashArray: '7 6' } },
}));
jest.mock('../../services/api', () => ({
  generateStage: jest.fn(),
  pingBackend: jest.fn(),
  searchCommunes: jest.fn(() => Promise.resolve([])),
}));

const response = (ids, extra = {}) => ({
  ok: true,
  radiusKm: 5,
  expandedFrom: null,
  seed: 1,
  relaxed: false,
  exhausted: false,
  stage: { ...mockStage, id: ids[0] },
  alternatives: ids.slice(1).map((id) => ({ ...mockStage, id })),
  meta: { timings: { totalMs: 120 }, dataSource: 'memory', candidates: 300 },
  ...extra,
});

describe('RouteGenerator Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState(null, '', '/?name=Laventie&cp=62840&lat=50.6094&lon=2.7884&r=5&s=asphalt&l=medium&seed=1');
  });

  test('devrait envoyer les tracés déjà vus pour ne pas les reproposer', async () => {
    generateStage.mockResolvedValueOnce(response(['a', 'b', 'c'])).mockResolvedValueOnce(response(['d', 'e', 'f']));
    render(<RouteGenerator />);

    // Génération automatique depuis le lien
    await screen.findByText('Nouvelle spéciale');
    expect(generateStage.mock.calls[0][0].avoid).toEqual([]);

    fireEvent.click(screen.getByText('Nouvelle spéciale'));
    await waitFor(() => expect(generateStage).toHaveBeenCalledTimes(2));
    expect(generateStage.mock.calls[1][0].avoid).toEqual(['a', 'b', 'c']);
    expect(generateStage.mock.calls[1][0].seed).toBeUndefined();
  });

  test('devrait oublier les tracés vus quand un paramètre change', async () => {
    generateStage.mockResolvedValue(response(['a', 'b', 'c']));
    render(<RouteGenerator />);
    await screen.findByText('Nouvelle spéciale');

    fireEvent.click(screen.getByLabelText(/Courte/));
    fireEvent.click(screen.getByText('Nouvelle spéciale'));

    await waitFor(() => expect(generateStage).toHaveBeenCalledTimes(2));
    expect(generateStage.mock.calls[1][0]).toEqual(expect.objectContaining({ length: 'short', avoid: [] }));
  });

  test('devrait prévenir quand la zone est épuisée', async () => {
    generateStage.mockResolvedValueOnce(response(['a'], { exhausted: true }));
    render(<RouteGenerator />);

    expect(await screen.findByText(/Plus de spéciale vraiment différente/)).toBeInTheDocument();
  });

  test('devrait prévenir quand la zone manque de terre et afficher la légende', async () => {
    generateStage.mockResolvedValueOnce(response(['a'], { surfaceRelaxed: true }));
    render(<RouteGenerator />);

    expect(await screen.findByText(/Peu de pistes reliées/)).toBeInTheDocument();
    expect(screen.getByText(/20 % de terre/)).toBeInTheDocument();
    expect(screen.getByLabelText('Légende des revêtements')).toBeInTheDocument();
  });

  test('devrait signaler une zone élargie et caler le curseur dessus', async () => {
    generateStage.mockResolvedValueOnce(response(['a'], { radiusKm: 10, expandedFrom: 5 }));
    render(<RouteGenerator />);

    expect(await screen.findByText(/zone de recherche élargie à 10 km/)).toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveValue('10');
    expect(window.location.search).toContain('r=10');
  });
});

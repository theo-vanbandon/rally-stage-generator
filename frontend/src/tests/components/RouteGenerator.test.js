import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import RouteGenerator from '../../components/RouteGenerator';
import { generateStage } from '../../services/api';
import { exportStages } from '../../services/exportService';
import { mockStage } from '../fixtures/stage';

// Leaflet ne fonctionne pas dans jsdom : la carte est remplacée, ses props sont gardées pour les tests
const mockMapProps = [];
const lastMapProps = () => mockMapProps[mockMapProps.length - 1];
jest.mock('../../components/MapView', () => ({
  __esModule: true,
  default: (props) => {
    mockMapProps.push(props);
    return <div data-testid="map" />;
  },
  SURFACE_STYLES: { paved: { color: 'red' }, gravel: { color: 'brown' }, dirt: { color: 'brown', dashArray: '7 6' } },
}));
jest.mock('../../services/exportService', () => ({
  ...jest.requireActual('../../services/exportService'),
  exportStages: jest.fn(() => true),
}));
jest.mock('../../services/api', () => ({
  generateStage: jest.fn(),
  pingBackend: jest.fn(),
  searchCommunes: jest.fn(() => Promise.resolve([])),
}));

// Chaque tracé est livré avec son sens inverse (repérable ici par sa route)
const withReverse = (id) => ({ ...mockStage, id, reverse: { ...mockStage, id: `${id}-inverse`, roads: ['Route du retour'] } });

const response = (ids, extra = {}) => ({
  ok: true,
  radiusKm: 5,
  expandedFrom: null,
  seed: 1,
  relaxed: false,
  exhausted: false,
  stage: withReverse(ids[0]),
  alternatives: ids.slice(1).map(withReverse),
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

  test('cliquer une case du roadbook la surligne et la montre sur la carte', async () => {
    generateStage.mockResolvedValueOnce(response(['a']));
    render(<RouteGenerator />);
    const roadbook = await screen.findByRole('list', { name: 'Roadbook' });
    const rows = within(roadbook).getAllByRole('button');

    fireEvent.click(rows[1]);
    expect(rows[1]).toHaveAttribute('aria-current', 'true');
    expect(lastMapProps().focusedCase).toEqual(expect.objectContaining({ n: mockStage.roadbook[1].n, fly: true }));

    // Clic sur un point de la carte : la case correspondante est surlignée, sans déplacer la carte
    act(() => lastMapProps().onSelectCase(mockStage.roadbook[2]));
    expect(rows[2]).toHaveAttribute('aria-current', 'true');
    expect(rows[1]).not.toHaveAttribute('aria-current');
    expect(lastMapProps().focusedCase).toEqual(expect.objectContaining({ n: mockStage.roadbook[2].n, fly: false }));
  });

  describe('export', () => {
    const exportButton = (name) => screen.getByRole('button', { name });

    test('exporte par défaut le tracé affiché, dans son sens', async () => {
      generateStage.mockResolvedValueOnce(response(['a', 'b', 'c']));
      render(<RouteGenerator />);
      await screen.findByText('Nouvelle spéciale');
      fireEvent.click(screen.getByRole('tab', { name: /Tracé 2/ }));
      fireEvent.click(screen.getByRole('button', { name: /Inverser le sens/ }));

      fireEvent.click(exportButton('GPX'));
      const [format, items, , filename] = exportStages.mock.calls.at(-1);
      expect(format).toBe('gpx');
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual(expect.objectContaining({ label: 'Tracé 2', tag: 'T2', reversed: true }));
      expect(items[0].stage.id).toBe('b-inverse');
      expect(filename).toBe('es-laventie-b-inverse.gpx');
    });

    test('exporte plusieurs tracés, chacun dans son sens', async () => {
      generateStage.mockResolvedValueOnce(response(['a', 'b', 'c']));
      render(<RouteGenerator />);
      await screen.findByText('Nouvelle spéciale');
      fireEvent.click(screen.getByRole('button', { name: /Inverser le sens/ })); // tracé 1 à l'envers

      const picks = screen.getByRole('group', { name: 'Spéciales à exporter' });
      fireEvent.click(within(picks).getByLabelText(/Tracé 3/));
      fireEvent.click(exportButton('KML'));

      const [format, items, , filename] = exportStages.mock.calls.at(-1);
      expect(format).toBe('kml');
      expect(items.map((it) => [it.label, it.stage.id, it.reversed])).toEqual([
        ['Tracé 1', 'a-inverse', true],
        ['Tracé 3', 'c', false],
      ]);
      expect(filename).toBe('es-laventie-traces-1-3.kml');
    });

    test("désactive l'export quand aucune spéciale n'est cochée", async () => {
      generateStage.mockResolvedValueOnce(response(['a', 'b']));
      render(<RouteGenerator />);
      await screen.findByText('Nouvelle spéciale');
      fireEvent.click(within(screen.getByRole('group', { name: 'Spéciales à exporter' })).getByLabelText(/Tracé 1/));
      expect(exportButton('GPX')).toBeDisabled();
      expect(exportButton('GeoJSON')).toBeDisabled();
    });
  });

  describe('boucle', () => {
    const loopStage = (id, loop = { kind: 'junction', fromKm: 2.85, lengthKm: 3.32, coord: [2.8, 50.6] }) => ({
      ...withReverse(id),
      stats: { ...mockStage.stats, loop },
    });

    test("devrait demander une boucle par un carrefour et l'inscrire dans le lien", async () => {
      generateStage.mockResolvedValue(response(['a']));
      render(<RouteGenerator />);
      await screen.findByText('Nouvelle spéciale');
      expect(generateStage.mock.calls[0][0].loop).toBe(false);

      generateStage.mockResolvedValue(response(['b'], { stage: loopStage('b') }));
      fireEvent.click(screen.getByLabelText(/Carrefour/));
      fireEvent.click(screen.getByText('Nouvelle spéciale'));
      await waitFor(() => expect(generateStage).toHaveBeenCalledTimes(2));
      // Changer d'option repart de zéro : les tracés sans boucle déjà vus ne comptent pas
      expect(generateStage.mock.calls[1][0]).toEqual(expect.objectContaining({ loop: 'junction', avoid: [] }));
      expect(await screen.findByText(/Boucle de 3\.3 km/)).toBeInTheDocument();
      expect(window.location.search).toContain('b=1');
    });

    test('un lien partagé avec boucle la redemande', async () => {
      window.history.replaceState(null, '', '/?name=Laventie&cp=62840&lat=50.6094&lon=2.7884&r=5&s=asphalt&l=medium&b=1&seed=3');
      generateStage.mockResolvedValueOnce(response(['a'], { stage: loopStage('a') }));
      render(<RouteGenerator />);
      expect(await screen.findByText(/Boucle de 3\.3 km/)).toBeInTheDocument();
      expect(generateStage.mock.calls[0][0]).toEqual(expect.objectContaining({ loop: 'junction', seed: 3 }));
      expect(screen.getByLabelText(/Carrefour/)).toBeChecked();
    });

    test('devrait proposer la boucle avec portion commune (b=2 dans le lien)', async () => {
      window.history.replaceState(null, '', '/?name=Laventie&cp=62840&lat=50.6094&lon=2.7884&r=5&s=asphalt&l=medium&b=2&seed=3');
      const shared = { kind: 'shared', sharedFromKm: 2.1, sharedKm: 0.82, fromKm: 2.92, lengthKm: 3.4, coord: [2.8, 50.6] };
      generateStage.mockResolvedValueOnce(response(['a'], { stage: loopStage('a', shared) }));
      render(<RouteGenerator />);
      expect(await screen.findByText(/portion commune de 0\.8 km/)).toBeInTheDocument();
      expect(generateStage.mock.calls[0][0]).toEqual(expect.objectContaining({ loop: 'shared' }));
      expect(screen.getByLabelText(/Portion/)).toBeChecked();
      expect(window.location.search).toContain('b=2');
    });
  });

  describe('sens inverse', () => {
    test("devrait basculer le tracé affiché dans l'autre sens et revenir", async () => {
      generateStage.mockResolvedValueOnce(response(['a', 'b']));
      render(<RouteGenerator />);
      await screen.findByText('Nouvelle spéciale');
      expect(screen.queryByText(/Route du retour/)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Inverser le sens/ }));
      expect(screen.getByText(/Via Route du retour/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /revenir au sens d'origine/ })).toHaveAttribute('aria-pressed', 'true');
      expect(window.location.search).toContain('sens=1');

      fireEvent.click(screen.getByRole('button', { name: /revenir au sens d'origine/ }));
      expect(screen.queryByText(/Route du retour/)).not.toBeInTheDocument();
      expect(window.location.search).not.toContain('sens=');
    });

    test('chaque tracé garde son propre sens', async () => {
      generateStage.mockResolvedValueOnce(response(['a', 'b']));
      render(<RouteGenerator />);
      await screen.findByText('Nouvelle spéciale');

      fireEvent.click(screen.getByRole('button', { name: /Inverser le sens/ }));
      fireEvent.click(screen.getByRole('tab', { name: /Tracé 2/ }));
      // Le tracé 2 est dans son sens d'origine, le tracé 1 reste inversé
      expect(screen.queryByText(/Via Route du retour/)).not.toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Tracé 1/ })).toHaveTextContent('inverse');
      expect(window.location.search).toContain('t=2');
      expect(window.location.search).toContain('sens=1');

      fireEvent.click(screen.getByRole('tab', { name: /Tracé 1/ }));
      expect(screen.getByText(/Via Route du retour/)).toBeInTheDocument();
    });

    test('un lien partagé rouvre le sens de chaque tracé', async () => {
      window.history.replaceState(null, '', '/?name=Gap&cp=05000&lat=44.58&lon=6.06&r=12&s=asphalt&l=medium&seed=7&sens=1,3');
      generateStage.mockResolvedValueOnce(response(['a', 'b', 'c']));
      render(<RouteGenerator />);

      expect(await screen.findByText(/Via Route du retour/)).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Tracé 3/ })).toHaveTextContent('inverse');
      expect(screen.getByRole('tab', { name: /Tracé 2/ })).not.toHaveTextContent('inverse');
    });

    test('un lien partagé rouvre le bon tracé dans le bon sens', async () => {
      window.history.replaceState(null, '', '/?name=Gap&cp=05000&lat=44.58&lon=6.06&r=12&s=asphalt&l=medium&seed=7&t=2&sens=inverse');
      generateStage.mockResolvedValueOnce(response(['a', 'b', 'c']));
      render(<RouteGenerator />);

      expect(await screen.findByText(/Via Route du retour/)).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Tracé 2/ })).toHaveAttribute('aria-selected', 'true');
    });

    test("une nouvelle génération repart dans le sens d'origine, sur le premier tracé", async () => {
      generateStage.mockResolvedValue(response(['a', 'b']));
      render(<RouteGenerator />);
      await screen.findByText('Nouvelle spéciale');
      fireEvent.click(screen.getByRole('button', { name: /Inverser le sens/ }));

      fireEvent.click(screen.getByText('Nouvelle spéciale'));
      await waitFor(() => expect(screen.queryByText(/Route du retour/)).not.toBeInTheDocument());
      expect(screen.getByRole('tab', { name: /Tracé 1/ })).toHaveAttribute('aria-selected', 'true');
    });
  });

  test.each(['A5', 'A4'])("imprimer en %s applique ce format avant d'ouvrir l'impression", async (label) => {
    generateStage.mockResolvedValueOnce(response(['a']));
    let pageAtPrint = null;
    window.print = jest.fn(() => {
      pageAtPrint = document.querySelector('.roadbook-print style').textContent;
    });
    render(<RouteGenerator />);
    await screen.findByText('Nouvelle spéciale');

    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(pageAtPrint).toContain(`size: ${label} portrait`);
  });
});

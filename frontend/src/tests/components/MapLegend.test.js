import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MapLegend from '../../components/MapLegend';
import { mockStage } from '../fixtures/stage';

// Leaflet ne fonctionne pas dans jsdom : seules les couleurs de la carte sont utiles ici
jest.mock('../../components/MapView', () => ({
  __esModule: true,
  default: () => null,
  SURFACE_STYLES: { paved: { color: '#e53935' }, gravel: { color: '#6d4127' }, dirt: { color: '#6d4127', dashArray: '7 6' } },
  LIAISON_COLOR: '#8e24aa',
  LOOP_ARROW_COLOR: '#1565c0',
  ALTERNATIVE_COLOR: '#455a64',
  STOP_PATH_COLOR: '#263238',
}));

const asphalt = { ...mockStage, stats: { ...mockStage.stats, surfacePct: { paved: 100, gravel: 0, dirt: 0 } } };

describe('MapLegend', () => {
  test('montre la spéciale, les points et le point stop', () => {
    render(<MapLegend stage={asphalt} />);
    expect(screen.getByText('Spéciale affichée')).toBeInTheDocument();
    expect(screen.getByText('Départ')).toBeInTheDocument();
    expect(screen.getByText('Arrivée lancée')).toBeInTheDocument();
    expect(screen.getByText('Point stop')).toBeInTheDocument();
    expect(screen.getByText('Vers le point stop')).toBeInTheDocument();
    expect(screen.getByText(/Case du roadbook/)).toBeInTheDocument();
  });

  test("n'affiche que ce qui est sur la carte", () => {
    render(<MapLegend stage={asphalt} />);
    expect(screen.queryByText(/Autres? tracés?/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Liaison/)).not.toBeInTheDocument();
    expect(screen.queryByText('Zone de recherche')).not.toBeInTheDocument();
    expect(screen.queryByText(/Numéro d'ES/)).not.toBeInTheDocument();
    expect(screen.queryByText('Boucle')).not.toBeInTheDocument();
  });

  test('détaille les revêtements présents seulement', () => {
    // mockStage : 80 % asphalte, 20 % route empierrée, pas de chemin
    render(<MapLegend stage={mockStage} />);
    expect(screen.getByText('Spéciale : asphalte')).toBeInTheDocument();
    expect(screen.getByText('Spéciale : route empierrée')).toBeInTheDocument();
    expect(screen.queryByText('Spéciale : chemin de terre')).not.toBeInTheDocument();
    expect(screen.queryByText('Spéciale affichée')).not.toBeInTheDocument();
  });

  test('autres tracés, liaisons (propres et avec compromis), zone de recherche et ordre du rallye', () => {
    const liaisons = [{ warnings: [] }, { warnings: ["traverse l'ES1 à un carrefour"] }];
    render(<MapLegend stage={asphalt} otherStages={2} liaisons={liaisons} searchArea rallyOrder />);
    expect(screen.getByText('Autres tracés (cliquer pour les afficher)')).toBeInTheDocument();
    expect(screen.getByText('Liaison entre ES')).toBeInTheDocument();
    expect(screen.getByText('Liaison avec compromis (⚠)')).toBeInTheDocument();
    expect(screen.getByText('Zone de recherche')).toBeInTheDocument();
    expect(screen.getByText(/Numéro d'ES/)).toBeInTheDocument();
  });

  test('boucle par un carrefour ou avec portion commune', () => {
    const { rerender } = render(<MapLegend stage={{ ...asphalt, stats: { ...asphalt.stats, loop: { kind: 'junction' } } }} />);
    expect(screen.getByText('Carrefour passé 2 fois')).toBeInTheDocument();
    expect(screen.getByText('Sens de la boucle')).toBeInTheDocument();
    rerender(<MapLegend stage={{ ...asphalt, stats: { ...asphalt.stats, loop: { kind: 'shared' } } }} />);
    expect(screen.getByText('Portion parcourue 2 fois')).toBeInTheDocument();
    expect(screen.queryByText('Carrefour passé 2 fois')).not.toBeInTheDocument();
  });

  test('se replie et se déplie', () => {
    render(<MapLegend stage={asphalt} />);
    const toggle = screen.getByRole('button', { name: /Légende/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Départ')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText('Départ')).toBeInTheDocument();
  });
});

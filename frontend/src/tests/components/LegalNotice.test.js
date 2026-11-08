import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RouteGenerator from '../../components/RouteGenerator';

jest.mock('../../components/MapView', () => ({
  __esModule: true,
  default: () => <div data-testid="map" />,
  SURFACE_STYLES: { paved: { color: 'red' }, gravel: { color: 'brown' }, dirt: { color: 'brown' } },
}));
jest.mock('../../services/api', () => ({
  generateStage: jest.fn(),
  pingBackend: jest.fn(),
  searchCommunes: jest.fn(() => Promise.resolve([])),
}));

describe('Mentions légales', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));

  test("s'ouvrent depuis le lien du pied de page avec les informations obligatoires", () => {
    render(<RouteGenerator />);
    fireEvent.click(screen.getByRole('button', { name: 'Mentions légales' }));

    const dialog = screen.getByRole('dialog', { name: 'Mentions légales' });
    expect(dialog).toHaveTextContent('édité à titre non professionnel par Théo Vanbandon, responsable de la publication');
    expect(dialog).not.toHaveTextContent('anonym');
    expect(dialog).not.toHaveTextContent('adresse IP');
    expect(dialog).toHaveTextContent('Render Inc. - 525 Brannan Street, Suite 300, San Francisco');
    expect(dialog).toHaveTextContent('Licence Ouverte Etalab 2.0');
    expect(dialog).toHaveTextContent('contributeurs OpenStreetMap');
    expect(dialog).toHaveTextContent('Code de la route');
    expect(dialog).toHaveTextContent('Aucun compte, aucun cookie');
    expect(screen.getAllByRole('link', { name: 'theo.vanbandon@gmail.com' })[0]).toHaveAttribute(
      'href',
      'mailto:theo.vanbandon@gmail.com'
    );
    expect(window.location.hash).toBe('#mentions-legales');
  });

  test('se ferment avec le bouton ou la touche Échap', () => {
    render(<RouteGenerator />);
    fireEvent.click(screen.getByRole('button', { name: 'Mentions légales' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.location.hash).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Mentions légales' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test("s'ouvrent directement avec l'adresse #mentions-legales", () => {
    window.history.replaceState(null, '', '/#mentions-legales');
    render(<RouteGenerator />);
    expect(screen.getByRole('dialog', { name: 'Mentions légales' })).toBeInTheDocument();
  });
});

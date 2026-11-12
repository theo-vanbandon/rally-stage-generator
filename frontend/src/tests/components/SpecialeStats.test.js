import React from 'react';
import { render, screen } from '@testing-library/react';
import SpecialeStats, { twistLabel } from '../../components/SpecialeStats/SpecialeStats';
import { mockStage } from '../fixtures/stage';

describe('SpecialeStats Component', () => {
  const { stats } = mockStage;

  test('devrait afficher la longueur', () => {
    render(<SpecialeStats stats={stats} />);
    expect(screen.getByText('12.50 km')).toBeInTheDocument();
  });

  test('devrait qualifier la sinuosité', () => {
    render(<SpecialeStats stats={stats} />);
    expect(screen.getByText(/Très sinueuse/)).toBeInTheDocument();
    expect(screen.getByText('690°/km')).toBeInTheDocument();
  });

  test('devrait afficher le dénivelé et la pente', () => {
    render(<SpecialeStats stats={stats} />);
    expect(screen.getByText('+60 / −0 m')).toBeInTheDocument();
    expect(screen.getByText('8.5 %')).toBeInTheDocument();
  });

  test('devrait détailler le revêtement', () => {
    render(<SpecialeStats stats={stats} />);
    expect(screen.getByText('Mixte')).toBeInTheDocument();
    expect(screen.getByText('80 %')).toBeInTheDocument();
    expect(screen.getByText('asphalte')).toBeInTheDocument();
    expect(screen.getByText('20 %')).toBeInTheDocument();
    expect(screen.getByText('terre')).toBeInTheDocument();
    expect(screen.queryByText('chemin')).not.toBeInTheDocument();
  });

  test('devrait afficher un revêtement unique sans barre ni « Mixte »', () => {
    const { container } = render(<SpecialeStats stats={{ ...stats, surfacePct: { paved: 100, gravel: 0, dirt: 0 } }} />);
    expect(screen.queryByText('Mixte')).not.toBeInTheDocument();
    expect(screen.getByText('asphalte')).toBeInTheDocument();
    expect(screen.getByText('100 %')).toBeInTheDocument();
    expect(container.querySelector('.surface-bar')).toBeNull();
  });

  test('devrait masquer les altitudes si absentes', () => {
    render(<SpecialeStats stats={{ ...stats, elevation: null }} />);
    expect(screen.queryByText('Dénivelé')).not.toBeInTheDocument();
  });

  test('devrait afficher la boucle seulement si la spéciale en a une', () => {
    const { rerender } = render(<SpecialeStats stats={stats} />);
    expect(screen.queryByText('Boucle')).not.toBeInTheDocument();
    rerender(<SpecialeStats stats={{ ...stats, loop: { fromKm: 2.85, lengthKm: 3.32, coord: [2.8, 50.6] } }} />);
    expect(screen.getByText('Boucle')).toBeInTheDocument();
    expect(screen.getByText('3.3 km')).toBeInTheDocument();
    expect(screen.getByText('dès le km 2.9')).toBeInTheDocument();
    rerender(<SpecialeStats stats={{ ...stats, loop: { kind: 'shared', sharedFromKm: 2, sharedKm: 0.82, fromKm: 2.82, lengthKm: 3.4, coord: [2.8, 50.6] } }} />);
    expect(screen.getByText('+ portion commune 0.8 km × 2')).toBeInTheDocument();
  });

  test('devrait centrer la dernière case seulement si elle est seule sur sa ligne', () => {
    const { container, rerender } = render(<SpecialeStats stats={{ ...stats, urbanPct: 4 }} />);
    expect(screen.getByText('Traversée de hameau')).toBeInTheDocument();
    expect(container.querySelectorAll('.speciale-stats .stat')).toHaveLength(8);
    rerender(<SpecialeStats stats={{ ...stats, urbanPct: 0 }} />);
    expect(container.querySelectorAll('.speciale-stats .stat')).toHaveLength(7);
  });

  test('ne devrait rien afficher si stats est null', () => {
    const { container } = render(<SpecialeStats stats={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test.each([
    [700, 'Très sinueuse'],
    [500, 'Sinueuse'],
    [300, 'Roulante'],
    [150, 'Rapide'],
  ])('twistLabel(%i) = %s', (value, label) => {
    expect(twistLabel(value)).toBe(label);
  });
});

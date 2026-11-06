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
    expect(screen.getByText('80 % asphalte · 20 % terre')).toBeInTheDocument();
  });

  test('devrait masquer les altitudes si absentes', () => {
    render(<SpecialeStats stats={{ ...stats, elevation: null }} />);
    expect(screen.queryByText('Dénivelé')).not.toBeInTheDocument();
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

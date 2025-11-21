import React from 'react';
import { render, screen } from '@testing-library/react';
import SpecialeStats from '../../components/SpecialeStats';

describe('SpecialeStats Component', () => {
  
  const mockStats = {
    length: '12.50',
    intersections: 8,
    avgDistanceBetweenPK: '1.56',
    elevation: {
      min: 250,
      max: 450,
      gain: 320,
      loss: 280
    },
    avgSlope: '4.5'
  };

  test('devrait afficher le titre', () => {
    render(<SpecialeStats stats={mockStats} />);
    
    expect(screen.getByText(/Statistiques de la spéciale/)).toBeInTheDocument();
  });

  test('devrait afficher la longueur', () => {
    render(<SpecialeStats stats={mockStats} />);
    
    expect(screen.getByText(/Longueur/)).toBeInTheDocument();
  });

  test('devrait afficher le nombre d\'intersections', () => {
    render(<SpecialeStats stats={mockStats} />);
    
    expect(screen.getByText(/Nombre d'intersections/)).toBeInTheDocument();
  });

  test('devrait afficher les altitudes', () => {
    render(<SpecialeStats stats={mockStats} />);
    
    expect(screen.getByText(/Altitude minimale/)).toBeInTheDocument();
    expect(screen.getByText(/Altitude maximale/)).toBeInTheDocument();
  });

  test('devrait afficher le dénivelé', () => {
    render(<SpecialeStats stats={mockStats} />);
    
    expect(screen.getByText(/Dénivelé positif/)).toBeInTheDocument();
    expect(screen.getByText(/Dénivelé négatif/)).toBeInTheDocument();
  });

  test('devrait afficher la pente moyenne', () => {
    render(<SpecialeStats stats={mockStats} />);
    
    expect(screen.getByText(/Pente moyenne/)).toBeInTheDocument();
  });

  test('ne devrait rien afficher si stats est null', () => {
    render(<SpecialeStats stats={null} />);
    
    expect(screen.queryByText(/Statistiques/)).not.toBeInTheDocument();
  });
});

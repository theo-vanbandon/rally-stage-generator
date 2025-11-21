import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

// Mock des composants qui utilisent Leaflet
jest.mock('./components/RouteGenerator', () => {
  return function MockRouteGenerator() {
    return <div data-testid="route-generator">RouteGenerator Mock</div>;
  };
});

describe('App Component', () => {
  test('devrait rendre sans erreur', () => {
    render(<App />);
    expect(screen.getByTestId('route-generator')).toBeInTheDocument();
  });
});

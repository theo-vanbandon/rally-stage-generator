import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import Roadbook from '../../components/Roadbook';
import RoadbookPrint from '../../components/RoadbookPrint';
import { mockStage } from '../fixtures/stage';

describe('Roadbook Component', () => {
  test('devrait afficher une case par point avec kilométrages total et partiel', () => {
    render(<Roadbook roadbook={mockStage.roadbook} />);
    const rows = screen.getAllByRole('button');

    expect(rows).toHaveLength(5);
    expect(within(rows[1]).getByText('0.85')).toBeInTheDocument();
    expect(within(rows[2]).getByText('+0.35')).toBeInTheDocument();
    expect(within(rows[0]).queryByText(/^\+/)).not.toBeInTheDocument(); // pas de partiel sur la case 1
  });

  test('devrait afficher dangers, route et observations', () => {
    render(<Roadbook roadbook={mockStage.roadbook} />);
    const junction = screen.getAllByRole('button')[1];

    expect(within(junction).getByText('!', { exact: false })).toBeInTheDocument();
    expect(within(junction).getByText('D14')).toBeInTheDocument();
    expect(within(junction).getByText('Croisement route principale')).toBeInTheDocument();
  });

  test('devrait dessiner les tulipes et les symboles des cases spéciales', () => {
    const { container } = render(<Roadbook roadbook={mockStage.roadbook} />);
    expect(container.querySelectorAll('svg.tulip')).toHaveLength(3); // départ, carrefour, arrivée
    expect(screen.getByText('STOP')).toBeInTheDocument();
    expect(screen.getByText('TERRE')).toBeInTheDocument();
  });

  test('devrait signaler la case cliquée', () => {
    const onSelect = jest.fn();
    render(<Roadbook roadbook={mockStage.roadbook} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Arrivée lancée'));
    expect(onSelect).toHaveBeenCalledWith(mockStage.roadbook[3]);
  });
});

describe('RoadbookPrint Component', () => {
  test("devrait afficher l'en-tête de l'épreuve et toutes les cases", () => {
    const { container } = render(<RoadbookPrint stage={mockStage} esNumber="3" esName="Laventie" />);

    expect(screen.getByText('ES 3')).toBeInTheDocument();
    expect(screen.getByText('Laventie')).toBeInTheDocument();
    expect(screen.getByText(/12.50 km · Mixte \(20 % terre\)/)).toBeInTheDocument();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(5);
  });

  test.each([
    ['a5', 'A5 portrait', '72'],
    ['a4', 'A4 portrait', '104'],
  ])('format %s : page %s et tulipes adaptées', (format, page, tulipSize) => {
    const { container } = render(<RoadbookPrint stage={mockStage} esNumber="1" format={format} />);
    expect(container.querySelector('style').textContent).toContain(`size: ${page}`);
    expect(container.querySelector('.roadbook-print')).toHaveClass(`format-${format}`);
    expect(container.querySelector('svg.tulip')).toHaveAttribute('width', tulipSize);
  });
});

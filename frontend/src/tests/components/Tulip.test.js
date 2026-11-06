import React from 'react';
import { render } from '@testing-library/react';
import Tulip from '../../components/Tulip';

const curvedExit = [[0.05, 0.3], [0.2, 0.55], [0.45, 0.7], [0.75, 0.75], [1, 0.75]];

describe('Tulip Component', () => {
  test("devrait dessiner la géométrie réelle des routes (virage arrondi)", () => {
    const { container } = render(
      <Tulip
        tulip={{
          entry: 'road',
          entryPath: [[0, -0.5], [0, -1]],
          exit: 55,
          exitKind: 'road',
          exitPath: curvedExit,
          others: [{ angle: 0, kind: 'road', path: [[0, 0.5], [0, 1]] }],
        }}
      />
    );
    const polylines = container.querySelectorAll('polyline');
    expect(polylines).toHaveLength(3); // autre route, arrivée, sortie
    // La sortie passe par tous les points du virage (pas un simple trait droit)
    const exitPoints = polylines[2].getAttribute('points').split(' ');
    expect(exitPoints.length).toBe(curvedExit.length + 1);
    // Le point d'arrivée est au bout de la route d'arrivée, en bas
    const dot = container.querySelector('circle');
    expect(Number(dot.getAttribute('cy'))).toBeGreaterThan(90);
  });

  test('devrait orienter la flèche selon la fin de la route', () => {
    const { container } = render(
      <Tulip tulip={{ entry: 'road', entryPath: [[0, -1]], exit: 55, exitPath: curvedExit, others: [] }} />
    );
    const head = container.querySelector('polygon').getAttribute('points').split(' ').map((p) => p.split(',').map(Number));
    // La route finit plein est : la pointe est à droite de la base de la flèche
    const [tip, left, right] = head;
    expect(tip[0]).toBeGreaterThan((left[0] + right[0]) / 2);
  });

  test("devrait dessiner une route principale en double trait et une piste en pointillés", () => {
    const { container } = render(
      <Tulip
        tulip={{
          entry: 'road',
          exit: 0,
          others: [
            { angle: 90, kind: 'major', path: [[1, 0]] },
            { angle: -90, kind: 'track', path: [[-1, 0]] },
          ],
        }}
      />
    );
    expect(container.querySelectorAll('.tulip-major-outer')).toHaveLength(1);
    expect(container.querySelectorAll('.tulip-track')).toHaveLength(1);
  });

  test('devrait rester compatible avec une tulipe sans géométrie (angles seuls)', () => {
    const { container } = render(<Tulip tulip={{ entry: 'road', exit: 90, others: [{ angle: -90, kind: 'road' }] }} />);
    expect(container.querySelectorAll('polyline').length).toBe(3);
  });

  test("au départ : pas de route d'arrivée, un point au centre", () => {
    const { container } = render(<Tulip tulip={{ entry: null, exit: 0, exitPath: [[0, 1]], others: [] }} />);
    const dot = container.querySelector('circle');
    expect(Number(dot.getAttribute('cy'))).toBe(56);
  });
});

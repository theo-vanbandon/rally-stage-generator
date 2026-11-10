import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import StageTabs, { moveItem, dropPosition, clampToRail } from '../../components/StageTabs';

const stage = (id, km) => ({ id, stats: { lengthKm: km } });
const stages = [stage('a', 11.6), stage('b', 13.1), stage('c', 11.8)];

describe('StageTabs', () => {
  describe('calculs du glisser-déposer', () => {
    test('moveItem déplace un élément, les autres glissent', () => {
      expect(moveItem([0, 1, 2], 0, 2)).toEqual([1, 2, 0]);
      expect(moveItem([0, 1, 2], 2, 0)).toEqual([2, 0, 1]);
      expect(moveItem([0, 1, 2], 1, 1)).toEqual([0, 1, 2]);
    });

    test("le rail : l'onglet ne sort jamais de la barre", () => {
      const rail = { left: 0, right: 300 };
      const tab = { left: 100, right: 200 };
      expect(clampToRail(-500, tab, rail)).toBe(-100);
      expect(clampToRail(500, tab, rail)).toBe(100);
      expect(clampToRail(30, tab, rail)).toBe(30);
    });

    test("la position d'arrivée dépend du bord de l'onglet glissé", () => {
      const rects = [0, 100, 200].map((left) => ({ left, width: 96 }));
      expect(dropPosition(rects, 0, 40)).toBe(0); // le bord droit n'a pas atteint le milieu du voisin
      expect(dropPosition(rects, 0, 60)).toBe(1); // il l'a dépassé
      expect(dropPosition(rects, 0, 200)).toBe(2); // bout du rail : dernière place
      expect(dropPosition(rects, 1, 0)).toBe(1); // pas bougé
      expect(dropPosition(rects, 2, -200)).toBe(0);
    });

    test('les bouts du rail restent atteignables avec des onglets de largeurs différentes', () => {
      // 3e onglet plus large (texte « · inverse ») : collé au bord gauche, il prend bien la 1re place
      const rects = [
        { left: 0, width: 90 },
        { left: 96, width: 90 },
        { left: 192, width: 110 },
      ];
      const rail = { left: 0, right: 302 };
      const dx = clampToRail(-1000, { left: 192, right: 302 }, rail);
      expect(dropPosition(rects, 2, dx)).toBe(0);
      // 1er onglet plus étroit poussé au bout à droite : dernière place
      expect(dropPosition(rects, 0, clampToRail(1000, { left: 0, right: 90 }, rail))).toBe(2);
    });
  });

  test("affiche les tracés dans l'ordre du rallye, avec leur numéro d'ES", () => {
    render(<StageTabs stages={stages} order={[1, 0, 2]} selectedIndex={0} reversedTraces={[2]} onSelect={() => {}} onReorder={() => {}} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['ES1Tracé 213.1 km', 'ES2Tracé 111.6 km', 'ES3Tracé 311.8 km · inverse']);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
  });

  test('un clic sélectionne le tracé', () => {
    const onSelect = jest.fn();
    render(<StageTabs stages={stages} order={[1, 0, 2]} selectedIndex={0} reversedTraces={[]} onSelect={onSelect} onReorder={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: /Tracé 3/ }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  test('Alt + flèches déplace un onglet, sans sortir du rail', () => {
    const onReorder = jest.fn();
    render(<StageTabs stages={stages} order={[0, 1, 2]} selectedIndex={0} reversedTraces={[]} onSelect={() => {}} onReorder={onReorder} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: /Tracé 1/ }), { key: 'ArrowRight', altKey: true });
    expect(onReorder).toHaveBeenLastCalledWith([1, 0, 2]);
    fireEvent.keyDown(screen.getByRole('tab', { name: /Tracé 1/ }), { key: 'ArrowLeft', altKey: true });
    expect(onReorder).toHaveBeenCalledTimes(1); // déjà en tête
    fireEvent.keyDown(screen.getByRole('tab', { name: /Tracé 3/ }), { key: 'ArrowRight', altKey: true });
    expect(onReorder).toHaveBeenCalledTimes(1); // déjà en queue
    fireEvent.keyDown(screen.getByRole('tab', { name: /Tracé 3/ }), { key: 'ArrowRight' });
    expect(onReorder).toHaveBeenCalledTimes(1); // sans Alt : rien
  });
});

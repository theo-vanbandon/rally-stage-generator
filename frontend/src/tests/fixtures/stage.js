/**
 * Spéciale au format renvoyé par POST /api/generate
 */
export const mockStage = {
  id: 'abc123',
  score: 0.9,
  geometry: {
    type: 'LineString',
    coordinates: [
      [6.0, 44.5, 800],
      [6.01, 44.505, 820],
      [6.02, 44.51, 860],
    ],
  },
  start: [6.0, 44.5],
  finish: [6.02, 44.51],
  roads: ['D14', 'Route de Rambaud'],
  surfaces: [
    { surface: 'paved', from: 0, to: 1, km: 0 },
    { surface: 'gravel', from: 1, to: 2, km: 0.85 },
  ],
  stop: { coord: [6.025, 44.512], path: [[6.02, 44.51], [6.025, 44.512]], distanceKm: 0.45 },
  roadbook: [
    {
      n: 1, type: 'start', km: 0, partial: 0, coord: [6.0, 44.5], direction: 'CH — Départ ES', angle: 0,
      road: 'D14', notes: ['Départ sur asphalte'], danger: 0,
      tulip: { entry: null, exit: 0, exitKind: 'road', others: [{ angle: 90, kind: 'road' }] },
    },
    {
      n: 2, type: 'junction', km: 0.85, partial: 0.85, coord: [6.01, 44.505], direction: 'À droite', angle: 85,
      road: 'D14', notes: ['Croisement route principale'], danger: 1,
      tulip: { entry: 'road', exit: 85, exitKind: 'road', others: [{ angle: 0, kind: 'major' }] },
    },
    {
      n: 3, type: 'surface', km: 1.2, partial: 0.35, coord: [6.015, 44.507], direction: 'Début terre (route empierrée)',
      angle: 0, road: null, notes: [], danger: 1, tulip: null,
    },
    {
      n: 4, type: 'finish', km: 12.5, partial: 11.3, coord: [6.02, 44.51], direction: 'Arrivée lancée', angle: 0,
      road: null, notes: ['Fin du chronométrage'], danger: 0,
      tulip: { entry: 'road', exit: -30, exitKind: 'road', others: [] },
    },
    {
      n: 5, type: 'stop', km: 12.95, partial: 0.45, coord: [6.025, 44.512], direction: 'Point stop', angle: 0,
      road: null, notes: ['Pointage du temps — arrêt obligatoire'], danger: 0, tulip: null,
    },
  ],
  stats: {
    lengthKm: 12.5,
    twistDegPerKm: 690,
    straightSharePct: 3,
    longestStraightKm: 0.32,
    junctions: 2,
    urbanPct: 0,
    surfacePct: { paved: 80, gravel: 20, dirt: 0 },
    elevation: {
      min: 800,
      max: 860,
      gain: 60,
      loss: 0,
      maxSlopePct: 8.5,
      profile: [
        [0, 800],
        [0.5, 820],
        [1, 860],
      ],
    },
  },
};

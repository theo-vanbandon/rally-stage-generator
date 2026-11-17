import { buildRoadbookPdf, pdfText, roadbookFilename, surfaceSummary } from '../../services/roadbookPdf';
import { mockStage } from '../fixtures/stage';

const roundaboutCase = {
  n: 2, type: 'junction', km: 1.2, partial: 1.2, coord: [6.05, 44.55], direction: 'Rond-point — 2e sortie', angle: 20, road: 'D945', notes: ["Traversée de l'ES1 : point de traversée à organiser"], danger: 1,
  tulip: { entry: 'road', entryPath: null, exit: 20, exitKind: 'road', exitPath: null, roundabout: true, others: [{ angle: 100, kind: 'major', path: null }] },
};
const liaison = {
  from: 0, to: 1, ok: true, km: 10, warnings: ['demi-tour après le point stop'], coordinates: [[6, 44.5], [6.1, 44.6]],
  roadbook: [
    { n: 1, type: 'stop', km: 0, partial: 0, coord: [6, 44.5], direction: 'Point stop ES1 — départ liaison', angle: 0, road: null, notes: [], danger: 0, tulip: null },
    roundaboutCase,
    { n: 3, type: 'start', km: 10, partial: 8.8, coord: [6.1, 44.6], direction: 'CH — Départ ES2', angle: 0, road: null, notes: [], danger: 0, tulip: null },
  ],
};
const items = [
  { kind: 'stage', number: 1, name: 'Mont des Cats', stage: mockStage, reversed: false },
  { kind: 'liaison', number: 1, from: 1, to: 2, liaison, minutes: 15, speed: 40 },
  { kind: 'stage', number: 2, name: 'ES2', stage: mockStage, reversed: true },
];
const pdfSource = (doc) => doc.output();

describe('Roadbook PDF', () => {
  test.each([
    ['a5', 148, 210],
    ['a4', 210, 297],
  ])('format %s : page de garde puis une page par épreuve', async (format, w, h) => {
    const doc = await buildRoadbookPdf({ format, rallyName: 'Rallye des Routes du Nord', hostTown: 'Merville', items });
    expect(doc.getNumberOfPages()).toBe(4);
    expect(Math.round(doc.internal.pageSize.getWidth())).toBe(w);
    expect(Math.round(doc.internal.pageSize.getHeight())).toBe(h);
  });

  test('textes : rallye, ville, noms des spéciales, liaison et temps imparti, cases', async () => {
    const src = pdfSource(await buildRoadbookPdf({ format: 'a5', rallyName: 'Rallye des Routes du Nord', hostTown: 'Merville', items }));
    for (const text of ['Rallye des Routes du Nord', 'Merville', 'Mont des Cats', 'Liaison ES1 » ES2', 'temps imparti 15 min', 'Rond-point - 2e sortie', 'CH - Départ ES2', 'sens inverse', 'STOP']) {
      expect(src).toContain(text);
    }
  });

  test("une longue spéciale continue sur plusieurs pages, avec l'en-tête répété", async () => {
    const long = { ...mockStage, roadbook: Array.from({ length: 30 }, (_, i) => ({ ...mockStage.roadbook[1], n: i + 1, km: i * 0.4 })) };
    const doc = await buildRoadbookPdf({ format: 'a5', items: [{ kind: 'stage', number: 1, name: 'ES1', stage: long, reversed: false }] });
    expect(doc.getNumberOfPages()).toBeGreaterThan(3);
    expect(pdfSource(doc)).toContain(String.raw`(ES1 \(suite\))`);
  });

  test('pdfText : seuls des caractères Latin-1 (sinon la ligne devient illisible)', () => {
    expect(pdfText('Rond-point — 2e sortie → ES2 · œuvre ’ ≈ 3 km')).toBe('Rond-point - 2e sortie » ES2 · oeuvre \' ~ 3 km');
    expect(pdfText(null)).toBe('');
  });

  test('nom du fichier et résumé du revêtement', () => {
    expect(roadbookFilename('Rallye des Routes du Nord', 'Merville')).toBe('roadbook-rallye-des-routes-du-nord.pdf');
    expect(roadbookFilename('', 'Saint-Étienne')).toBe('roadbook-saint-etienne.pdf');
    expect(roadbookFilename('', '')).toBe('roadbook-rallye.pdf');
    expect(surfaceSummary({ paved: 80, gravel: 20, dirt: 0 })).toBe('Mixte (20 % terre)');
  });
});

import {
  buildGPX,
  buildKML,
  buildGeoJSON,
  exportStages,
  exportFilename,
  stageFilename,
} from '../../services/exportService';
import { mockStage } from '../fixtures/stage';

global.URL.createObjectURL = jest.fn(() => 'mock-url');
global.URL.revokeObjectURL = jest.fn();

/** Lit les fichiers d'une archive ZIP (sans compression) : [{ name, content }] */
const readZip = async (blob) => {
  const buffer = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsArrayBuffer(blob);
  });
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const files = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const name = decoder.decode(new Uint8Array(buffer, offset + 30, nameLength));
    const content = decoder.decode(new Uint8Array(buffer, offset + 30 + nameLength, size));
    files.push({ name, content, crc: view.getUint32(offset + 14, true) });
    offset += 30 + nameLength + size;
  }
  return files;
};

/** Lit le contenu du dernier Blob téléchargé */
const lastBlobText = () => {
  const blob = global.URL.createObjectURL.mock.calls.at(-1)[0];
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(blob);
  });
};

const one = [{ stage: mockStage, label: 'Tracé 1', tag: 'T1' }];
const two = [
  { stage: mockStage, label: 'Tracé 1', tag: 'T1' },
  { stage: { ...mockStage, id: 'def456' }, label: 'Tracé 3', tag: 'T3', reversed: true },
];
const count = (text, needle) => text.split(needle).length - 1;

const junction = (n, km, coord, direction, road, note) => ({
  n, type: 'junction', km, partial: 0, coord, direction, angle: 0, road, notes: [note], danger: 1, tulip: null,
});
const [startCase, , , finishCase, stopCase] = mockStage.roadbook;

// Boucle par un carrefour : deux passages au même endroit
const loopStage = {
  ...mockStage,
  stats: { ...mockStage.stats, loop: { kind: 'junction', fromKm: 2.85, lengthKm: 3.32, coord: [6.012, 44.506] } },
  roadbook: [
    startCase,
    junction(2, 2.85, [6.012, 44.506], 'À gauche', 'R DES FRENES', 'Boucle : 1er passage — entrée dans la boucle'),
    junction(3, 6.17, [6.012, 44.506], 'Tout droit', 'D10', 'Boucle : 2e passage — sortie de la boucle'),
    finishCase,
    stopCase,
  ],
};

// Boucle avec portion commune : A, B, A, B
const A = [6.011, 44.505];
const B = [6.013, 44.507];
const sharedStage = {
  ...mockStage,
  stats: { ...mockStage.stats, loop: { kind: 'shared', sharedFromKm: 1.44, sharedKm: 1.2, fromKm: 2.64, lengthKm: 2.1, coord: B } },
  roadbook: [
    startCase,
    junction(2, 1.44, A, 'À droite', 'D10', 'Boucle : entrée sur la portion commune (1er passage)'),
    junction(3, 2.64, B, 'À gauche', 'CHE MAZINGUE', 'Boucle : fin de la portion commune — départ de la boucle'),
    junction(4, 4.74, A, 'À gauche', 'D10', 'Boucle : retour sur la portion commune (2e passage)'),
    junction(5, 5.94, B, 'Tout droit', 'R DU PONT', 'Boucle : fin de la portion commune — sortie de la boucle'),
    finishCase,
    stopCase,
  ],
};

describe('Export Service', () => {
  describe('GPX', () => {
    test("devrait exporter départ, arrivée et point stop, avec l'altitude, et rien d'autre", () => {
      const gpx = buildGPX(one);
      expect(count(gpx, '<wpt ')).toBe(3);
      expect(gpx).toMatch(/<wpt lat="44.5" lon="6">\s*<ele>800<\/ele>\s*<name>Départ — km 0.00<\/name>/);
      expect(gpx).toContain('<name>Arrivée — km 12.50</name>');
      expect(gpx).toContain('<name>Point stop — km 12.95</name>');
      expect(gpx).toContain('<sym>Flag, Green</sym>');
      expect(gpx).toContain('<sym>Flag, Red</sym>');
      expect(gpx).toContain('<sym>Flag, Blue</sym>');
      expect(gpx).not.toContain('Case 2');
    });

    test("une seule trace par spéciale : pas de liaison qui déplacerait le drapeau d'arrivée sur le point stop", () => {
      const gpx = buildGPX(one);
      expect(count(gpx, '<trk>')).toBe(1);
      expect(gpx).not.toContain('point stop</name>\n    <type>');
      expect(gpx).toContain('<ele>860</ele>');
      expect(gpx).toContain('<name>Tracé 1 — 12.50 km</name>');
      // La trace finit sur l'arrivée
      const lastPoint = gpx.slice(gpx.lastIndexOf('<trkpt'));
      expect(lastPoint).toContain('lat="44.51" lon="6.02"');
    });

    test('boucle par un carrefour : un seul waypoint qui décrit les deux passages', () => {
      const gpx = buildGPX([{ stage: loopStage, label: 'Tracé 1', tag: 'T1' }]);
      expect(count(gpx, '<sym>Crossing</sym>')).toBe(1);
      expect(gpx).toContain('<name>Boucle — carrefour de la boucle (2 passages)</name>');
      expect(gpx).toContain(
        '<desc>1er passage, km 2.85 : à gauche vers R DES FRENES (entrée dans la boucle)\n' +
          '2e passage, km 6.17 : tout droit vers D10 (sortie de la boucle)</desc>'
      );
    });

    test('portion commune : un waypoint au début et un à la fin de la portion, chacun avec ses deux passages', () => {
      const gpx = buildGPX([{ stage: sharedStage, label: 'Tracé 1', tag: 'T1' }]);
      expect(count(gpx, '<sym>Crossing</sym>')).toBe(2);
      expect(gpx).toContain('<name>Boucle — début de la portion commune (2 passages)</name>');
      expect(gpx).toContain('<name>Boucle — fin de la portion commune (2 passages)</name>');
      expect(gpx).toContain(
        '1er passage, km 1.44 : à droite vers D10 (entrée sur la portion commune)\n' +
          '2e passage, km 4.74 : à gauche vers D10 (retour sur la portion commune)'
      );
      expect(gpx).toContain(
        '1er passage, km 2.64 : à gauche vers CHE MAZINGUE (fin de la portion commune — départ de la boucle)\n' +
          '2e passage, km 5.94 : tout droit vers R DU PONT (fin de la portion commune — sortie de la boucle)'
      );
      // Waypoints dans l'ordre du parcours
      const names = [...gpx.matchAll(/<wpt[^>]*>\s*(?:<ele>[^<]*<\/ele>\s*)?<name>([^<]*)<\/name>/g)].map((m) => m[1]);
      expect(names).toEqual([
        'Départ — km 0.00',
        'Boucle — début de la portion commune (2 passages)',
        'Boucle — fin de la portion commune (2 passages)',
        'Arrivée — km 12.50',
        'Point stop — km 12.95',
      ]);
    });

    test('plusieurs spéciales : une trace chacune, waypoints préfixés, sens indiqué', () => {
      const gpx = buildGPX(two, { title: 'Gap — Tracé 1 — Tracé 3' });
      expect(count(gpx, '<trk>')).toBe(2);
      expect(gpx).toContain('<name>T1 Départ — km 0.00</name>');
      expect(gpx).toContain('<name>T3 Arrivée — km 12.50</name>');
      expect(gpx).toContain('<name>Tracé 3 — 12.50 km (sens inverse)</name>');
      expect(gpx).toContain('<name>Gap — Tracé 1 — Tracé 3</name>');
    });

    test('devrait ignorer un tracé vide', () => {
      expect(buildGPX([{ ...one[0], stage: { ...mockStage, geometry: { type: 'LineString', coordinates: [] } } }])).toBeNull();
    });
  });

  describe('KML', () => {
    test('un dossier par spéciale, une couleur par tracé, des icônes par type de point', () => {
      const kml = buildKML(two);
      expect(count(kml, '<Folder>')).toBe(2);
      expect(kml).toContain('<Style id="stage0"><LineStyle><color>ff3539e5</color>');
      expect(kml).toContain('<Style id="stage1"><LineStyle><color>ffe5881e</color>');
      expect(kml).toContain('paddle/go.png');
      expect(kml).toContain('<styleUrl>#start</styleUrl>');
      expect(kml).toContain('<styleUrl>#stop</styleUrl>');
      expect(kml).toContain('<Data name="Km"><value>12.50</value></Data>');
      expect(kml).toContain('6.01,44.505,820');
      expect(kml).toContain('vers le point stop'); // la liaison reste dessinée dans Google Earth
    });

    test('boucle : les deux passages sur deux lignes', () => {
      const kml = buildKML([{ stage: loopStage, label: 'Tracé 1', tag: 'T1' }]);
      expect(kml).toContain('(entrée dans la boucle)&lt;br&gt;2e passage');
      expect(kml).toContain('<Data name="Passage 2"><value>2e passage, km 6.17 : tout droit vers D10 (sortie de la boucle)</value></Data>');
    });
  });

  describe('GeoJSON', () => {
    test('trace, liaison et waypoints avec styles', () => {
      const { features } = JSON.parse(buildGeoJSON(one));
      expect(features.map((f) => f.properties.kind)).toEqual(['stage', 'liaison', 'waypoint', 'waypoint', 'waypoint']);
      expect(features[0].properties).toEqual(expect.objectContaining({ stroke: '#e53935', lengthKm: 12.5, stage: 'Tracé 1' }));
      expect(features[0].properties.elevation.profile).toBeUndefined();
      const start = features.find((f) => f.properties.role === 'start');
      expect(start.properties).toEqual(expect.objectContaining({ name: 'Départ — km 0.00', 'marker-color': '#2e7d32', 'marker-size': 'large' }));
    });

    test('boucle : passages détaillés', () => {
      const { features } = JSON.parse(buildGeoJSON([{ stage: loopStage, label: 'Tracé 1', tag: 'T1' }]));
      const loop = features.find((f) => f.properties.role === 'loop');
      expect(loop.properties.passes).toEqual([
        expect.objectContaining({ km: 2.85, direction: 'À gauche', road: 'R DES FRENES' }),
        expect.objectContaining({ km: 6.17, direction: 'Tout droit', road: 'D10' }),
      ]);
      expect(features.filter((f) => f.properties.kind === 'stage').map((f) => f.properties.reversed)).toEqual([false]);
    });
  });

  test.each([
    ['GPX', buildGPX],
    ['KML', buildKML],
  ])('le %s produit est du XML valide, même avec des caractères spéciaux', (_, build) => {
    const tricky = { ...loopStage, roads: ['Route des <Crêtes> & "Cols"'] };
    const xml = build([{ stage: tricky, label: "Tracé 1 l'Écureuil", tag: 'T1' }, two[1]]);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  });

  describe('exportStages', () => {
    let mockAnchor;
    beforeEach(() => {
      mockAnchor = { href: '', download: '', click: jest.fn() };
      jest.spyOn(document, 'createElement').mockReturnValue(mockAnchor);
    });
    afterEach(() => jest.restoreAllMocks());

    test('KML : un seul fichier pour toutes les spéciales choisies', async () => {
      expect(exportStages('kml', two, {}, 'es-gap-traces-1-3.kml')).toBe(true);
      expect(mockAnchor.download).toBe('es-gap-traces-1-3.kml');
      expect(mockAnchor.click).toHaveBeenCalledTimes(1);
      expect(count(await lastBlobText(), '<Folder>')).toBe(2);
    });

    test("GPX de plusieurs spéciales : une archive avec un fichier par spéciale, une seule trace par fichier", async () => {
      expect(exportStages('gpx', two, { placeName: 'Gap' }, 'es-gap-traces-1-3-gpx.zip')).toBe(true);
      expect(mockAnchor.download).toBe('es-gap-traces-1-3-gpx.zip');
      expect(mockAnchor.click).toHaveBeenCalledTimes(1);
      const blob = global.URL.createObjectURL.mock.calls.at(-1)[0];
      expect(blob.type).toBe('application/zip');
      const files = await readZip(blob);
      expect(files.map((f) => f.name)).toEqual(['es-gap-trace-1.gpx', 'es-gap-trace-3.gpx']);
      for (const f of files) {
        expect(count(f.content, '<trk>')).toBe(1);
        expect(count(f.content, '<wpt ')).toBe(3);
        expect(f.content).not.toMatch(/<name>T\d /); // un fichier = une spéciale : pas de préfixe
        expect(new DOMParser().parseFromString(f.content, 'application/xml').getElementsByTagName('parsererror')).toHaveLength(0);
      }
      expect(files[0].content).toContain('<name>Gap — Tracé 1</name>');
      expect(files[1].content).toContain('(sens inverse)');
    });

    test('GPX d\'une seule spéciale : un simple fichier .gpx', async () => {
      exportStages('gpx', one, { placeName: 'Gap' }, 'es-gap-abc123.gpx');
      const blob = global.URL.createObjectURL.mock.calls.at(-1)[0];
      expect(blob.type).toBe('application/gpx+xml');
      expect(count(await lastBlobText(), '<trk>')).toBe(1);
    });

    test('ne devrait rien télécharger sans tracé', () => {
      expect(exportStages('kml', [], {}, 'x.kml')).toBe(false);
      expect(mockAnchor.click).not.toHaveBeenCalled();
    });
  });

  describe('noms de fichier', () => {
    test('devrait produire un nom sans accents ni espaces', () => {
      expect(stageFilename(mockStage, 'Saint-Étienne-en-Dévoluy', 'gpx')).toBe('es-saint-etienne-en-devoluy-abc123.gpx');
    });

    test('une spéciale : son identifiant ; plusieurs : les numéros des tracés', () => {
      expect(exportFilename(one, 'Gap', 'kml')).toBe('es-gap-abc123.kml');
      expect(exportFilename(two, 'Gap', 'geojson')).toBe('es-gap-traces-1-3.geojson');
      expect(exportFilename(two, 'Gap', 'gpx')).toBe('es-gap-traces-1-3-gpx.zip');
    });
  });
});

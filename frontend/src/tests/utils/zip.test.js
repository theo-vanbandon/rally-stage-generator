import { createZip, crc32 } from '../../utils/zip';

const bytesOf = (blob) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.readAsArrayBuffer(blob);
  });

describe('ZIP', () => {
  test('CRC-32 conforme', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  test("devrait produire une archive lisible : en-têtes, répertoire central et fin d'archive", async () => {
    const zip = createZip(
      [
        { name: 'a.gpx', content: 'Départ' },
        { name: 'b.gpx', content: 'Arrivée' },
      ],
      new Date(2026, 10, 10, 12, 30, 0)
    );
    const bytes = await bytesOf(zip);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    // Fin d'archive : 2 fichiers, répertoire central juste avant
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const centralOffset = view.getUint32(end + 16, true);
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
    // Contenu UTF-8 et CRC du premier fichier
    const data = new TextEncoder().encode('Départ');
    expect(view.getUint32(14, true)).toBe(crc32(data));
    expect(view.getUint32(18, true)).toBe(data.length);
    expect(new TextDecoder().decode(bytes.slice(30 + 5, 30 + 5 + data.length))).toBe('Départ');
  });
});

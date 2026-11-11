const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TtlCache } = require('../../services/cache');

describe('TtlCache', () => {
  test('devrait mutualiser deux calculs simultanés de la même clé', async () => {
    const cache = new TtlCache({ maxEntries: 5, ttlMs: 1000 });
    const compute = jest.fn(() => new Promise((resolve) => setTimeout(() => resolve(42), 10)));

    const [a, b] = await Promise.all([cache.getOrCompute('k', compute), cache.getOrCompute('k', compute)]);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(a.value).toBe(42);
    expect(b.value).toBe(42);
    expect((await cache.getOrCompute('k', compute)).source).toBe('memory');
  });

  test('devrait évincer l\'entrée la moins récemment utilisée', () => {
    const cache = new TtlCache({ maxEntries: 2, ttlMs: 1000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
  });

  test('devrait libérer les entrées les plus anciennes au-delà du poids maximal', () => {
    const cache = new TtlCache({ maxEntries: 10, ttlMs: 60000, maxWeight: 100, weigh: (v) => v.size });
    cache.set('a', { size: 40 });
    cache.set('b', { size: 40 });
    cache.get('a'); // a redevient la plus récente
    cache.set('c', { size: 40 }); // 120 > 100 : b, la moins récemment utilisée, part
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toEqual({ size: 40 });
    expect(cache.get('c')).toEqual({ size: 40 });
    expect(cache.totalWeight()).toBe(80);
  });

  test('devrait toujours garder la dernière entrée, même plus lourde que le maximum', () => {
    const cache = new TtlCache({ maxEntries: 10, ttlMs: 60000, maxWeight: 100, weigh: (v) => v.size });
    cache.set('a', { size: 30 });
    cache.set('énorme', { size: 500 });
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('énorme')).toEqual({ size: 500 });
  });

  test("shrinkTo libère les plus anciennes jusqu'au poids demandé", () => {
    const cache = new TtlCache({ maxEntries: 10, ttlMs: 60000, maxWeight: 1000, weigh: (v) => v.size });
    ['a', 'b', 'c'].forEach((k) => cache.set(k, { size: 40 }));
    cache.shrinkTo(50);
    expect([...cache.entries.keys()]).toEqual(['c']);
    cache.shrinkTo(0);
    expect(cache.entries.size).toBe(0);
  });

  test('devrait expirer les entrées', () => {
    const cache = new TtlCache({ maxEntries: 2, ttlMs: 0 });
    cache.set('a', 1);
    expect(cache.get('a')).toBeUndefined();
  });

  test('devrait relire le cache disque après redémarrage', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsg-cache-'));
    const first = new TtlCache({ maxEntries: 0, ttlMs: 60000, diskDir: dir });
    await first.getOrCompute('zone', () => ({ roads: [1, 2] }), { persist: true });

    const second = new TtlCache({ maxEntries: 0, ttlMs: 60000, diskDir: dir });
    const compute = jest.fn();
    const result = await second.getOrCompute('zone', compute, { persist: true });

    expect(compute).not.toHaveBeenCalled();
    expect(result).toEqual({ value: { roads: [1, 2] }, source: 'disk' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('ne devrait pas garder en cache un calcul en échec', async () => {
    const cache = new TtlCache({ maxEntries: 2, ttlMs: 1000 });
    await expect(cache.getOrCompute('k', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect((await cache.getOrCompute('k', () => 7)).value).toBe(7);
  });

  describe('pruneDisk', () => {
    let dir;
    const write = (name, kb, ageMs = 0) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, Buffer.alloc(kb * 1024));
      const t = new Date(Date.now() - ageMs);
      fs.utimesSync(file, t, t);
    };

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsg-prune-'));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    test("devrait supprimer les fichiers expirés et ceux d'une ancienne version", () => {
      write('v2_recent.json.gz', 1);
      write('v2_vieux.json.gz', 1, 8 * 24 * 3600 * 1000);
      write('v1_ancien_format.json.gz', 1);
      const cache = new TtlCache({ maxEntries: 0, ttlMs: 7 * 24 * 3600 * 1000, diskDir: dir, diskPrefix: 'v2_' });

      expect(cache.pruneDisk().removed).toBe(2);
      expect(fs.readdirSync(dir)).toEqual(['v2_recent.json.gz']);
    });

    test('devrait supprimer les zones les plus anciennes au-delà de la taille max', () => {
      write('v2_a.json.gz', 100, 3000);
      write('v2_b.json.gz', 100, 2000);
      write('v2_c.json.gz', 100, 1000);
      const cache = new TtlCache({ maxEntries: 0, ttlMs: 60000, diskDir: dir, diskPrefix: 'v2_', maxDiskBytes: 250 * 1024 });

      cache.pruneDisk();
      expect(fs.readdirSync(dir).sort()).toEqual(['v2_b.json.gz', 'v2_c.json.gz']);
    });
  });
});

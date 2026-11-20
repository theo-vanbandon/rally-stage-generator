import { randomCommune, RANDOM_POPULATION } from '../../services/api';

const commune = (nom, population, extra = {}) => ({
  nom,
  population,
  codesPostaux: ['15160'],
  codeDepartement: '15',
  centre: { type: 'Point', coordinates: [2.96, 45.23] },
  ...extra,
});
const reply = (body, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) });

describe('randomCommune', () => {
  afterEach(() => {
    delete global.fetch;
  });

  test("tire une commune rurale d'un département (jamais une ville ni un hameau minuscule)", async () => {
    global.fetch = jest.fn(() => reply([commune('Aurillac', 25000), commune('Allanche', 773), commune('Hameau', 40), commune('Sans centre', 900, { centre: null })]));
    const drawn = await randomCommune({ random: () => 0.5 });
    expect(drawn).toEqual({ name: 'Allanche', postal: '15160', department: '15', lon: 2.96, lat: 45.23, population: 773 });
    expect(global.fetch.mock.calls[0][0]).toMatch(/^https:\/\/geo\.api\.gouv\.fr\/departements\/\w{2}\/communes\?/);
    expect(drawn.population).toBeGreaterThanOrEqual(RANDOM_POPULATION[0]);
    expect(drawn.population).toBeLessThanOrEqual(RANDOM_POPULATION[1]);
  });

  test('ne tire jamais Paris ni la petite couronne', async () => {
    global.fetch = jest.fn(() => reply([commune('Allanche', 773)]));
    for (let i = 0; i < 100; i++) await randomCommune({ random: () => i / 100 });
    const departments = global.fetch.mock.calls.map(([url]) => url.match(/departements\/(\w+)\//)[1]);
    expect(departments.some((d) => ['75', '92', '93', '94', '20'].includes(d))).toBe(false);
    expect(departments).toEqual(expect.arrayContaining(['01', '2A', '2B', '95']));
  });

  test('réessaie un autre département si le premier ne donne rien, puis abandonne avec un message clair', async () => {
    global.fetch = jest.fn().mockReturnValueOnce(reply([], false)).mockReturnValueOnce(reply([commune('Allanche', 773)]));
    expect((await randomCommune()).name).toBe('Allanche');

    global.fetch = jest.fn(() => Promise.reject(new Error('réseau')));
    await expect(randomCommune()).rejects.toThrow(/Tirage au sort impossible/);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});

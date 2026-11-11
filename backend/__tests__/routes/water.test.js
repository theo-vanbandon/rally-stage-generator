const { parseWaterRequest } = require('../../routes/water');

describe('POST /api/water : validation', () => {
  test.each([
    [{}, /entre 1 et 6/],
    [{ stages: [] }, /entre 1 et 6/],
    [{ stages: [{ coordinates: [[6, 44.5]] }] }, /coordinates/],
    [{ stages: [{ coordinates: [[6, 44.5], ['x', 44.6]] }] }, /coordinates/],
  ])('refuse une requête invalide %#', (body, message) => {
    expect(() => parseWaterRequest(body)).toThrow(message);
  });

  test("accepte jusqu'à 6 spéciales", () => {
    const stage = { coordinates: [[6, 44.5], [6.01, 44.51]] };
    expect(parseWaterRequest({ stages: [stage, stage, stage] })).toHaveLength(3);
  });
});

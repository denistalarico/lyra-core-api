import { parseCsatScore } from './leadflow-csat.service';

describe('parseCsatScore', () => {
  it.each(['1', '2', '3', '4', '5'])('accepts the CSAT score %s', (value) => {
    expect(parseCsatScore(value)).toBe(Number(value));
  });

  it.each(['0', '6', '10', 'nota 5', '5!', '', ' 4 5 '])(
    'rejects non-canonical answer %p',
    (value) => {
      expect(parseCsatScore(value)).toBeNull();
    },
  );
});

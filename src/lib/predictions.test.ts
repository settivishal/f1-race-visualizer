import { describe, expect, it } from 'vitest';
import { parseCsv, predictionProblems, type PredictionRow } from './predictions';

const entryList = new Map([['2026-singapore', new Set(['VER', 'NOR', 'LEC'])]]);
const row = (driver_code: string, win_probability: number, race_slug = '2026-singapore'): PredictionRow =>
  ({ race_slug, driver_code, win_probability, model_version: 'lgbm-v1' });

describe('predictionProblems', () => {
  it('passes a race that sums to 1 within float error', () => {
    expect(predictionProblems([row('VER', 0.5), row('NOR', 0.3), row('LEC', 0.2 + 1e-9)], entryList)).toEqual([]);
  });

  it('refuses a race that does not sum to 1', () => {
    expect(predictionProblems([row('VER', 0.5), row('NOR', 0.3)], entryList))
      .toEqual(['2026-singapore (lgbm-v1): probabilities sum to 0.8, not 1']);
  });

  it('refuses a driver the model was never given', () => {
    expect(predictionProblems([row('VER', 0.5), row('HAM', 0.5)], entryList))
      .toEqual(['2026-singapore (lgbm-v1): HAM is not on the entry list']);
  });

  it('refuses a driver listed twice', () => {
    expect(predictionProblems([row('VER', 0.5), row('VER', 0.5)], entryList))
      .toEqual(['2026-singapore (lgbm-v1): VER appears twice']);
  });

  it('refuses a race with no feature rows', () => {
    expect(predictionProblems([row('VER', 1, '2026-austin')], entryList))
      .toEqual(['2026-austin (lgbm-v1): no rows for this race in features.csv']);
  });

  it('sums each model version on its own', () => {
    const v2 = (code: string, p: number) => ({ ...row(code, p), model_version: 'lgbm-v2' });
    expect(predictionProblems([row('VER', 1), v2('NOR', 1)], entryList)).toEqual([]);
  });
});

describe('parseCsv', () => {
  it('keys cells by header and keeps blanks as empty strings', () => {
    expect(parseCsv('a,b,c\n1,,3\n')).toEqual([{ a: '1', b: '', c: '3' }]);
  });
});

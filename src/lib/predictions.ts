import { z } from 'zod';

/**
 * The checks scripts/import-predictions.ts runs before it writes anything:
 * the model's output against the feature rows it was given.
 */

export const PredictionRowSchema = z.object({
  race_slug: z.string().min(1),
  driver_code: z.string().min(1),
  win_probability: z.coerce.number().min(0).max(1),
  model_version: z.string().min(1),
});
export type PredictionRow = z.infer<typeof PredictionRowSchema>;

/** How far a race's probabilities may sum from 1, for float error only. */
export const SUM_TOLERANCE = 1e-6;

/**
 * Header-keyed records from a CSV with no quoted cells. Both files in the
 * hand-off are written without quoting: features.csv by `toCsv`, which refuses
 * a cell that would need it, and predictions.csv holds slugs, codes and numbers.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const keys = header.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(keys.map((key, index) => [key, cells[index] ?? '']));
  });
}

/**
 * Every problem in the file, not the first: a Saturday-night run should be
 * fixed in one pass. The entry list is the race's rows in features.csv, which
 * is exactly the field the model saw.
 */
export function predictionProblems(
  rows: PredictionRow[],
  entryList: Map<string, Set<string>>,
): string[] {
  const problems: string[] = [];
  const groups = new Map<string, PredictionRow[]>();
  for (const row of rows) {
    const key = `${row.race_slug} (${row.model_version})`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  for (const [key, group] of groups) {
    const entrants = entryList.get(group[0].race_slug);
    if (!entrants) {
      problems.push(`${key}: no rows for this race in features.csv`);
      continue;
    }
    const sum = group.reduce((total, row) => total + row.win_probability, 0);
    if (Math.abs(sum - 1) > SUM_TOLERANCE) {
      problems.push(`${key}: probabilities sum to ${sum}, not 1`);
    }
    const seen = new Set<string>();
    for (const { driver_code: code } of group) {
      if (!entrants.has(code)) problems.push(`${key}: ${code} is not on the entry list`);
      if (seen.has(code)) problems.push(`${key}: ${code} appears twice`);
      seen.add(code);
    }
  }
  return problems;
}

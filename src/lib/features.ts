/**
 * The pure half of `scripts/build-features.ts`: race rows in, model rows out.
 *
 * Everything that decides what the model may see lives here, away from the
 * database, so the two rules that matter can be tested directly. A race's form
 * is built only from races before it. And the grid never reaches a model
 * column, because Ergast publishes the grid with the race result and the model
 * runs on Saturday night. See docs/ml-prediction-plan.md.
 */

/** How many earlier races a form value averages over. */
export const FORM_WINDOW = 5;

/**
 * Every Ergast constructor id from 2018 onward, mapped to the team it is today,
 * so that a rebrand keeps its form history. Identity entries are listed too:
 * an id missing from this map is a failure, not a team with no past, and a new
 * team (Cadillac in 2026) is added here by hand.
 */
const LINEAGE: Record<string, string> = {
  mercedes: 'mercedes',
  ferrari: 'ferrari',
  red_bull: 'red_bull',
  mclaren: 'mclaren',
  williams: 'williams',
  haas: 'haas',
  cadillac: 'cadillac',
  renault: 'alpine',
  alpine: 'alpine',
  toro_rosso: 'rb',
  alphatauri: 'rb',
  rb: 'rb',
  force_india: 'aston_martin',
  racing_point: 'aston_martin',
  aston_martin: 'aston_martin',
  sauber: 'audi',
  alfa: 'audi',
  audi: 'audi',
};

/**
 * The lineage key for a team. There is no fallback to the name: a name match
 * would quietly give a renamed team an empty history, and the builder exits on
 * this error instead.
 */
export function lineageOf(team: { name: string; ergastConstructorId: string | null }): string {
  const id = team.ergastConstructorId;
  if (!id) {
    throw new Error(`Team "${team.name}" has no ergast_constructor_id, so it has no lineage.`);
  }
  const key = LINEAGE[id];
  if (!key) {
    throw new Error(`Team "${team.name}" (${id}) is not in the lineage map in src/lib/features.ts.`);
  }
  return key;
}

export type Entry = {
  driverCode: string;
  /** From `lineageOf`. */
  teamKey: string;
  qualiPosition: number | null;
  /** The same weekend's sprint, which runs before the Saturday-night publish. */
  sprintFinishPosition: number | null;
  /** Null when not classified, and always null for the upcoming race. */
  finalPosition: number | null;
  /** Analysis only. Never a model column. */
  gridPosition: number | null;
};

export type RaceInput = {
  slug: string;
  season: number;
  round: number;
  date: Date;
  circuitId: string | null;
  /** Not yet run: it gets features but no labels, and adds nothing to form. */
  upcoming: boolean;
  entries: Entry[];
};

export const ID_COLUMNS = ['race_slug', 'season', 'round', 'date', 'driver_code'] as const;
export const MODEL_COLUMNS = [
  'circuit_id',
  'team_key',
  'quali_position',
  'field_size',
  'driver_form',
  'constructor_form',
  'sprint_finish_position',
] as const;
export const LABEL_COLUMNS = ['classified', 'finished_p1'] as const;
/** Exported for analysis; the ml/ README says to drop these before training. */
export const ANALYSIS_COLUMNS = ['analysis_grid_position'] as const;
export const COLUMNS = [...ID_COLUMNS, ...MODEL_COLUMNS, ...LABEL_COLUMNS, ...ANALYSIS_COLUMNS];

type Cell = string | number | boolean | null;
export type FeatureRow = Record<(typeof COLUMNS)[number], Cell>;

/**
 * Finishing position as a share of the field, so 2nd of 20 and 2nd of 22 are
 * comparable. A driver who was not classified counts as last.
 */
// ponytail: a DNF scores as last whatever caused it; split mechanical from driver error if the model wants it.
export function normalisedFinish(finalPosition: number | null, fieldSize: number): number {
  return finalPosition === null ? 1 : finalPosition / fieldSize;
}

/** Mean of the last FORM_WINDOW values, or NaN with no history. Never 0. */
function form(history: number[] | undefined): number {
  if (!history?.length) return NaN;
  const recent = history.slice(-FORM_WINDOW);
  return recent.reduce((sum, value) => sum + value, 0) / recent.length;
}

function push(map: Map<string, number[]>, key: string, value: number) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * One row per driver per race, in date order. A race reads form before its own
 * result is added, so nothing from it or after it can leak into its features.
 */
export function buildFeatureRows(races: RaceInput[]): FeatureRow[] {
  const ordered = [...races].sort((a, b) => a.date.getTime() - b.date.getTime());
  const driverHistory = new Map<string, number[]>();
  const teamHistory = new Map<string, number[]>();
  const rows: FeatureRow[] = [];

  for (const race of ordered) {
    const fieldSize = race.entries.length;

    for (const entry of race.entries) {
      rows.push({
        race_slug: race.slug,
        season: race.season,
        round: race.round,
        date: race.date.toISOString().slice(0, 10),
        driver_code: entry.driverCode,
        circuit_id: race.circuitId,
        team_key: entry.teamKey,
        quali_position: entry.qualiPosition,
        field_size: fieldSize,
        driver_form: form(driverHistory.get(entry.driverCode)),
        constructor_form: form(teamHistory.get(entry.teamKey)),
        sprint_finish_position: entry.sprintFinishPosition,
        classified: race.upcoming ? null : entry.finalPosition !== null,
        finished_p1: race.upcoming ? null : entry.finalPosition === 1,
        analysis_grid_position: entry.gridPosition,
      });
    }

    if (race.upcoming) continue;

    // Only now, after every row of this race is written.
    const teamScores = new Map<string, number[]>();
    for (const entry of race.entries) {
      const score = normalisedFinish(entry.finalPosition, fieldSize);
      push(driverHistory, entry.driverCode, score);
      push(teamScores, entry.teamKey, score);
    }
    // A team's form is one value per race, the mean of its cars, so a race
    // counts the same for a team whichever of its drivers finished.
    for (const [team, scores] of teamScores) {
      push(teamHistory, team, scores.reduce((sum, value) => sum + value, 0) / scores.length);
    }
  }

  return rows;
}

/**
 * The Saturday run's guard. No qualifying at all means Ergast has not caught up:
 * fail, and the run is retried later. A short list is normal: a driver who sets
 * no time is not listed, and waiting would never fill the gap. So the race is
 * predicted for the drivers who are listed, and the rest are returned for the
 * script to name in a warning.
 */
export function missingFromQualifying(
  slug: string,
  qualifiedCodes: string[],
  lastFieldCodes: string[],
): string[] {
  if (qualifiedCodes.length === 0) {
    throw new Error(`${slug}: no qualifying from Ergast yet; retry later.`);
  }
  return lastFieldCodes.filter((code) => !qualifiedCodes.includes(code));
}

/** Empty for null and NaN, so pandas reads both as missing. 1/0 for booleans. */
export function toCsv(rows: FeatureRow[]): string {
  const cell = (value: Cell) => {
    if (value === null || (typeof value === 'number' && Number.isNaN(value))) return '';
    if (typeof value === 'boolean') return value ? '1' : '0';
    const text = String(value);
    if (/[",\n]/.test(text)) throw new Error(`CSV cell needs quoting, which this writer does not do: ${text}`);
    return text;
  };
  return [COLUMNS.join(','), ...rows.map((row) => COLUMNS.map((column) => cell(row[column])).join(','))].join('\n') + '\n';
}

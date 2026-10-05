import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { and, between, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import {
  buildFeatureRows, lineageOf, missingFromQualifying, toCsv,
  type Entry, type RaceInput,
} from '@/lib/features';
import { ergastRaceOn, fetchSeasonQualifying, type ErgastQualifyingRace } from '@/lib/ingest/ergast';

const { drivers, driverTeamAssignments, meetings, raceResults, races, teamSeasons, teams } = schema;

const OUT = 'ml/data/features.csv';

/**
 * Writes the model's training rows, and optionally the upcoming race's, to
 * ml/data/features.csv. Plan: docs/ml-prediction-plan.md.
 *
 *   pnpm tsx scripts/build-features.ts [--from 2018] [--to 2026] [--upcoming <slug>]
 *
 * Reads only. Develop against dev (.env); the real CSV comes from production
 * (--env-file=.env.prod), because only production has every season and the
 * cron's latest races.
 *
 * Two queries: every result of a completed race in range, and the upcoming
 * race. Qualifying and the circuit come from Ergast, matched to our races by
 * date, never by round: the 2026 Sepang race is round 16 there and 18 here.
 * meetings.circuit_id is not used because OpenF1 imports never set it.
 *
 * Any failure exits non-zero before the file is written, so a CSV on disk is
 * always a complete one.
 */
async function main() {
  const arg = (name: string) => {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? undefined : process.argv[index + 1];
  };
  const from = Number(arg('from') ?? 2018);
  const to = Number(arg('to') ?? new Date().getUTCFullYear());
  const upcomingSlug = arg('upcoming');
  const warnings: string[] = [];
  const db = getDb();

  const rows = await db
    .select({
      slug: races.slug,
      type: races.type,
      date: races.date,
      season: meetings.seasonYear,
      round: meetings.round,
      meetingId: meetings.id,
      driverCode: drivers.code,
      finalPosition: raceResults.finalPosition,
      gridPosition: raceResults.gridPosition,
      teamName: teams.name,
      ergastConstructorId: teams.ergastConstructorId,
    })
    .from(raceResults)
    .innerJoin(races, eq(races.id, raceResults.raceId))
    .innerJoin(meetings, eq(meetings.id, races.meetingId))
    .innerJoin(driverTeamAssignments, eq(driverTeamAssignments.id, raceResults.assignmentId))
    .innerJoin(drivers, eq(drivers.id, driverTeamAssignments.driverId))
    .innerJoin(teamSeasons, eq(teamSeasons.id, driverTeamAssignments.teamSeasonId))
    .innerJoin(teams, eq(teams.id, teamSeasons.teamId))
    .where(and(eq(races.status, 'COMPLETED'), between(meetings.seasonYear, from, to)));

  const upcoming = upcomingSlug ? await findUpcoming(upcomingSlug) : undefined;

  // One Ergast read per season, keyed by date (UTC, as ours is).
  const seasons = new Set(rows.map((row) => row.season));
  if (upcoming) seasons.add(upcoming.season);
  const qualifyingByDate = new Map<string, ErgastQualifyingRace>();
  for (const season of [...seasons].sort()) {
    for (const race of await fetchSeasonQualifying(season)) qualifyingByDate.set(race.date, race);
  }

  // Sprints only feed the same weekend's grand prix.
  const sprintFinish = new Map<string, Map<string, number | null>>();
  for (const row of rows.filter((r) => r.type === 'SPRINT')) {
    const byCode = sprintFinish.get(row.meetingId) ?? new Map<string, number | null>();
    byCode.set(row.driverCode, row.finalPosition);
    sprintFinish.set(row.meetingId, byCode);
  }

  const inputs = new Map<string, RaceInput>();
  for (const row of rows.filter((r) => r.type === 'GRAND_PRIX')) {
    let race = inputs.get(row.slug);
    if (!race) {
      const qualifying = ergastRaceOn(row.date, qualifyingByDate);
      if (!qualifying) warnings.push(`${row.slug}: no Ergast qualifying on ${day(row.date)}; quali and circuit left blank`);
      race = {
        slug: row.slug,
        season: row.season,
        round: row.round,
        date: row.date,
        circuitId: qualifying?.Circuit.circuitId ?? null,
        upcoming: false,
        entries: [],
      };
      inputs.set(row.slug, race);
    }
    race.entries.push({
      driverCode: row.driverCode,
      teamKey: lineageOf({ name: row.teamName, ergastConstructorId: row.ergastConstructorId }),
      qualiPosition: null,
      sprintFinishPosition: sprintFinish.get(row.meetingId)?.get(row.driverCode) ?? null,
      finalPosition: row.finalPosition,
      gridPosition: row.gridPosition,
    });
  }

  // Qualifying positions, by driver code. Read `position`, never the array
  // index: Ergast rows on a page boundary arrive out of order.
  for (const race of inputs.values()) {
    const qualifying = ergastRaceOn(race.date, qualifyingByDate);
    if (!qualifying) continue;
    const entrants = new Map(race.entries.map((entry) => [entry.driverCode, entry]));
    for (const result of qualifying.QualifyingResults) {
      const entry = result.Driver.code ? entrants.get(result.Driver.code) : undefined;
      if (entry) entry.qualiPosition = result.position;
      else warnings.push(`${race.slug}: qualifier ${result.Driver.code ?? result.Driver.driverId} is not among our entrants`);
    }
  }

  const all = [...inputs.values()];
  if (upcoming) all.push(upcomingInput(upcoming, qualifyingByDate, sprintFinish, all, warnings));

  const featureRows = buildFeatureRows(all);
  mkdirSync('ml/data', { recursive: true });
  writeFileSync(OUT, toCsv(featureRows));

  for (const warning of warnings) console.log(`warning: ${warning}`);
  console.log(`${all.length} races, ${featureRows.length} rows → ${OUT}`);
  process.exit(0);
}

const day = (date: Date) => date.toISOString().slice(0, 10);

async function findUpcoming(slug: string) {
  const [race] = await getDb()
    .select({
      slug: races.slug,
      type: races.type,
      status: races.status,
      date: races.date,
      season: meetings.seasonYear,
      round: meetings.round,
      meetingId: meetings.id,
    })
    .from(races)
    .innerJoin(meetings, eq(meetings.id, races.meetingId))
    .where(eq(races.slug, slug));
  if (!race) throw new Error(`--upcoming ${slug}: no such race.`);
  if (race.type !== 'GRAND_PRIX' || race.status !== 'SCHEDULED') {
    throw new Error(`--upcoming ${slug}: must be a SCHEDULED grand prix, is a ${race.status} ${race.type}.`);
  }
  return race;
}

/**
 * The upcoming race's entry list is its qualifying list, and its teams come
 * from that list too: our lineup for a race is only written once it has run.
 */
function upcomingInput(
  race: Awaited<ReturnType<typeof findUpcoming>>,
  qualifyingByDate: Map<string, ErgastQualifyingRace>,
  sprintFinish: Map<string, Map<string, number | null>>,
  past: RaceInput[],
  warnings: string[],
): RaceInput {
  const qualifying = ergastRaceOn(race.date, qualifyingByDate);
  const results = qualifying?.QualifyingResults ?? [];

  const lastField = past
    .filter((r) => r.date < race.date)
    .sort((a, b) => b.date.getTime() - a.date.getTime())[0];
  const missing = missingFromQualifying(
    race.slug,
    results.flatMap((result) => result.Driver.code ?? []),
    lastField?.entries.map((entry) => entry.driverCode) ?? [],
  );
  if (missing.length > 0) {
    warnings.push(`${race.slug}: not in qualifying, so not predicted: ${missing.join(', ')}`);
  }

  const entries: Entry[] = results.map((result) => {
    const code = result.Driver.code;
    if (!code) throw new Error(`${race.slug}: qualifier ${result.Driver.driverId} has no driver code.`);
    return {
      driverCode: code,
      teamKey: lineageOf({ name: result.Constructor.name, ergastConstructorId: result.Constructor.constructorId }),
      qualiPosition: result.position,
      sprintFinishPosition: sprintFinish.get(race.meetingId)?.get(code) ?? null,
      finalPosition: null,
      gridPosition: null,
    };
  });

  return {
    slug: race.slug,
    season: race.season,
    round: race.round,
    date: race.date,
    circuitId: qualifying?.Circuit.circuitId ?? null,
    upcoming: true,
    entries,
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

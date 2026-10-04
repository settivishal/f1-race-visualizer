import 'dotenv/config';
import { eq, max } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { OPENF1_TEAM_IDS } from '@/lib/ingest/transform';

const { teams, teamSeasons } = schema;

/**
 * One-off: gives every team its Ergast constructor id, and merges team rows
 * that turn out to be one team.
 *
 *   pnpm tsx scripts/merge-teams.ts            prints what it would do
 *   pnpm tsx scripts/merge-teams.ts --apply    does it, in one transaction
 *
 * Until the ingest learned OpenF1's team names, only the archive import set the
 * id, so every team whose OpenF1 name differs from Ergast's had none, and the
 * RB to Racing Bulls rebrand became two teams. The row kept is the one with the
 * newest season, so the team shows under its current name; the others' seasons
 * move onto it and the rows are deleted. A season both rows raced breaks the
 * team_seasons unique index, which rolls the whole run back.
 */
async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  const rows = await db
    .select({
      id: teams.id,
      name: teams.name,
      ergastConstructorId: teams.ergastConstructorId,
      newest: max(teamSeasons.seasonYear),
    })
    .from(teams)
    .leftJoin(teamSeasons, eq(teamSeasons.teamId, teams.id))
    .groupBy(teams.id);

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.ergastConstructorId ?? OPENF1_TEAM_IDS[row.name];
    if (!key) {
      console.log(`no id known for "${row.name}"; add it to OPENF1_TEAM_IDS`);
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const merges: { from: (typeof rows)[number]; into: (typeof rows)[number] }[] = [];
  const fills: { team: (typeof rows)[number]; id: string }[] = [];
  for (const [id, group] of groups) {
    const [keep, ...rest] = group.sort((a, b) => (b.newest ?? 0) - (a.newest ?? 0));
    for (const from of rest) merges.push({ from, into: keep });
    if (!keep.ergastConstructorId) fills.push({ team: keep, id });
  }

  for (const { from, into } of merges) console.log(`merge "${from.name}" into "${into.name}"`);
  for (const { team, id } of fills) console.log(`set "${team.name}" ergast_constructor_id = ${id}`);
  if (merges.length + fills.length === 0) console.log('nothing to do');

  if (!apply) {
    console.log('\ndry run; pass --apply to write');
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    // Merges first: a row being deleted may hold the id the kept row needs.
    for (const { from, into } of merges) {
      await tx.update(teamSeasons).set({ teamId: into.id }).where(eq(teamSeasons.teamId, from.id));
      await tx.delete(teams).where(eq(teams.id, from.id));
    }
    for (const { team, id } of fills) {
      await tx.update(teams).set({ ergastConstructorId: id, updatedAt: new Date() }).where(eq(teams.id, team.id));
    }
  });
  console.log('\napplied');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

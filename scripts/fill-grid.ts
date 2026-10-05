import 'dotenv/config';
import { getDb } from '@/db';
import { fillGrids } from '@/lib/ingest/grid';

/**
 * Fills the starting grid of every OpenF1-imported grand prix of a season from
 * Ergast. Only blank cells; safe to re-run.
 *
 *   pnpm tsx scripts/fill-grid.ts 2025
 *   pnpm tsx --env-file=.env.prod scripts/fill-grid.ts 2025    production
 *
 * The cron does the same for the last fortnight, so this is for the seasons
 * imported before the grid was filled at all.
 */
async function main() {
  const season = Number(process.argv[2]);
  if (!Number.isInteger(season)) {
    console.error('usage: tsx scripts/fill-grid.ts <season>');
    process.exit(1);
  }
  const { filled, warnings } = await fillGrids(getDb(), season);
  for (const warning of warnings) console.log(`warning: ${warning}`);
  console.log(`${season}: ${filled} grid position(s) filled`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

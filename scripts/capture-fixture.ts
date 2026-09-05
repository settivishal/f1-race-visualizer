import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  fetchDrivers, fetchLaps, fetchPits, fetchPositions,
  fetchRaceControl, fetchSessionResults, fetchWeather,
} from '@/lib/ingest/openf1';

/**
 * Saves one session's raw payloads as a fixture.
 *
 * The design's rule is that fixtures come from the races that actually broke,
 * so when the backfill fails on a race, capture it here and the failure becomes
 * a permanent regression test.
 *
 *   pnpm tsx scripts/capture-fixture.ts <sessionKey> <name>
 */
async function main() {
  const [sessionKey, name] = process.argv.slice(2);
  if (!sessionKey || !name) {
    console.error('usage: tsx scripts/capture-fixture.ts <sessionKey> <name>');
    process.exit(1);
  }

  const key = Number(sessionKey);
  const dir = join('src/lib/ingest/__fixtures__', name);
  await mkdir(dir, { recursive: true });

  const parts = {
    drivers: await fetchDrivers(key),
    laps: await fetchLaps(key),
    positions: await fetchPositions(key),
    pits: await fetchPits(key),
    raceControl: await fetchRaceControl(key),
    results: await fetchSessionResults(key),
    weather: await fetchWeather(key),
  };

  for (const [part, rows] of Object.entries(parts)) {
    await writeFile(join(dir, `${part}.json`), JSON.stringify(rows, null, 0) + '\n');
    console.log(`${name}/${part}.json  ${rows.length} rows`);
  }
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });

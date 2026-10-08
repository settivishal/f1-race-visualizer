import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { linkCircuits } from '@/lib/ingest/circuits';
import { fetchSeasonCircuits } from '@/lib/ingest/ergast';

/**
 * Creates the circuit rows for every season in the database, then fills the
 * three facts Ergast does not publish: length, turn count and the year of the
 * first world-championship grand prix there.
 *
 *   pnpm tsx scripts/seed-circuits.ts
 *
 * The creation half exists because circuits used to arrive only as a side
 * effect of an Ergast race import — so a database holding only OpenF1 seasons
 * had no circuits at all, and `/circuits/[id]` could not build, since
 * generateStaticParams may not return an empty list under Cache Components.
 * A circuit is a place, not a race, and should not depend on which races have
 * been backfilled.
 *
 * These are static facts about physical places, which is the one kind of data
 * that genuinely does not need an API — a circuit's length changes when it is
 * resurfaced, roughly once a decade, and the change is a news event.
 *
 * This replaces `lib/circuit-data.ts`, which held the same numbers keyed by
 * *country* and invented a fallback — 15 turns, 5.0 km, first held in 1950 —
 * for anything it did not recognise. That was survivable while the site knew
 * one season. With an archive it is not: Hockenheim, Sochi and Paul Ricard are
 * all inside the 2018 window, and all three would have rendered those invented
 * numbers as though they were facts. Anything missing here stays null, and the
 * page shows nothing rather than something wrong.
 *
 * Keyed by Ergast's circuit id, which is stable and which the ingest already
 * stores, rather than by a country that hosts two races some years.
 */
const CIRCUIT_FACTS: Record<string, { lengthKm: number; turns: number; firstGrandPrix: number }> = {
  albert_park: { lengthKm: 5.278, turns: 14, firstGrandPrix: 1996 },
  americas: { lengthKm: 5.513, turns: 20, firstGrandPrix: 2012 },
  bahrain: { lengthKm: 5.412, turns: 15, firstGrandPrix: 2004 },
  baku: { lengthKm: 6.003, turns: 20, firstGrandPrix: 2016 },
  catalunya: { lengthKm: 4.657, turns: 14, firstGrandPrix: 1991 },
  hungaroring: { lengthKm: 4.381, turns: 14, firstGrandPrix: 1986 },
  imola: { lengthKm: 4.909, turns: 19, firstGrandPrix: 1980 },
  interlagos: { lengthKm: 4.309, turns: 15, firstGrandPrix: 1973 },
  jeddah: { lengthKm: 6.174, turns: 27, firstGrandPrix: 2021 },
  losail: { lengthKm: 5.419, turns: 16, firstGrandPrix: 2021 },
  marina_bay: { lengthKm: 4.94, turns: 19, firstGrandPrix: 2008 },
  miami: { lengthKm: 5.412, turns: 19, firstGrandPrix: 2022 },
  monaco: { lengthKm: 3.337, turns: 19, firstGrandPrix: 1950 },
  monza: { lengthKm: 5.793, turns: 11, firstGrandPrix: 1950 },
  red_bull_ring: { lengthKm: 4.318, turns: 10, firstGrandPrix: 1970 },
  rodriguez: { lengthKm: 4.304, turns: 17, firstGrandPrix: 1963 },
  shanghai: { lengthKm: 5.451, turns: 16, firstGrandPrix: 2004 },
  silverstone: { lengthKm: 5.891, turns: 18, firstGrandPrix: 1950 },
  spa: { lengthKm: 7.004, turns: 19, firstGrandPrix: 1950 },
  suzuka: { lengthKm: 5.807, turns: 18, firstGrandPrix: 1987 },
  vegas: { lengthKm: 6.201, turns: 17, firstGrandPrix: 2023 },
  villeneuve: { lengthKm: 4.361, turns: 14, firstGrandPrix: 1978 },
  yas_marina: { lengthKm: 5.281, turns: 16, firstGrandPrix: 2009 },
  zandvoort: { lengthKm: 4.259, turns: 14, firstGrandPrix: 1952 },

  // Circuits inside the 2018-2022 window that the 2025 calendar does not visit.
  // These are the ones the old country-keyed table could not have held at all.
  hockenheimring: { lengthKm: 4.574, turns: 17, firstGrandPrix: 1970 },
  ricard: { lengthKm: 5.842, turns: 15, firstGrandPrix: 1971 },
  sochi: { lengthKm: 5.848, turns: 18, firstGrandPrix: 2014 },
  portimao: { lengthKm: 4.653, turns: 15, firstGrandPrix: 2020 },
  mugello: { lengthKm: 5.245, turns: 15, firstGrandPrix: 2020 },
  istanbul: { lengthKm: 5.338, turns: 14, firstGrandPrix: 2005 },
  nurburgring: { lengthKm: 5.148, turns: 15, firstGrandPrix: 1951 },
  sakhir: { lengthKm: 3.543, turns: 11, firstGrandPrix: 2020 },
  sepang: { lengthKm: 5.543, turns: 15, firstGrandPrix: 1999 },
  // Madring is deliberately absent. Madrid's first grand prix is 2026 and its
  // published length and corner count changed more than once during
  // construction; a number here would be a guess rendered as a fact, which is
  // the exact failure lib/circuit-data.ts existed to cause. It stays null and
  // the page shows nothing until someone confirms it.
  jeddah_corniche: { lengthKm: 6.174, turns: 27, firstGrandPrix: 2021 },
};

async function main() {
  const db = getDb();

  // Only the seasons already imported: fetching every circuit Ergast knows
  // would list places this database has no race for.
  const seasons = await db.select({ year: schema.seasons.year }).from(schema.seasons);
  console.log(`${seasons.length} season(s) in the database\n`);

  let created = 0;
  for (const { year } of seasons) {
    const circuits = await fetchSeasonCircuits(year);
    for (const circuit of circuits) {
      const values = {
        ergastCircuitId: circuit.circuitId,
        name: circuit.circuitName,
        locality: circuit.Location.locality ?? null,
        country: circuit.Location.country ?? null,
        latitude: circuit.Location.lat ? Number(circuit.Location.lat) : null,
        longitude: circuit.Location.long ? Number(circuit.Location.long) : null,
      };
      // Upsert, so this is safe to re-run and so a season that shares a circuit
      // with an earlier one refreshes it rather than colliding.
      await db.insert(schema.circuits).values(values).onConflictDoUpdate({
        target: schema.circuits.ergastCircuitId,
        set: { ...values, updatedAt: new Date() },
      });
      created++;
    }
    // OpenF1's meetings (2023 on) arrive with no circuit; this links them.
    const { linked, warnings } = await linkCircuits(db, year);
    console.log(`${year}: ${circuits.length} circuit(s), ${linked} meeting(s) linked`);
    for (const warning of warnings) console.log(`  ${warning}`);
  }

  const rows = await db.select().from(schema.circuits);

  let filled = 0;
  let unknown = 0;

  for (const circuit of rows) {
    const facts = CIRCUIT_FACTS[circuit.ergastCircuitId];
    if (!facts) {
      // Named rather than silently skipped: an unrecognised circuit is a page
      // that will render without its dimensions, and someone should decide
      // whether to add it here.
      console.log(`no facts for ${circuit.ergastCircuitId} (${circuit.name}) — left null`);
      unknown++;
      continue;
    }

    await db.update(schema.circuits).set(facts).where(eq(schema.circuits.id, circuit.id));
    filled++;
  }

  console.log(`\n${created} circuit row(s) written, ${filled} filled, ${unknown} left null, ${rows.length} total`);
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });

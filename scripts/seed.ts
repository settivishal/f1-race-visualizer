import 'dotenv/config';
import { getDb } from '@/db';
import { seasons, teams, drivers, teamSeasons, driverTeamAssignments } from '@/db/schema';

const SEASON = 2025;

// The 2025 grid. Reference data only — races come from the ingest, never from here.
const GRID = [
  { team: 'McLaren',          color: '#FF8000', lineup: [['NOR', 'Lando Norris', 4, 'GBR'], ['PIA', 'Oscar Piastri', 81, 'AUS']] },
  { team: 'Ferrari',          color: '#E8002D', lineup: [['LEC', 'Charles Leclerc', 16, 'MON'], ['HAM', 'Lewis Hamilton', 44, 'GBR']] },
  { team: 'Red Bull Racing',  color: '#3671C6', lineup: [['VER', 'Max Verstappen', 1, 'NED'], ['TSU', 'Yuki Tsunoda', 22, 'JPN']] },
  { team: 'Mercedes',         color: '#27F4D2', lineup: [['RUS', 'George Russell', 63, 'GBR'], ['ANT', 'Kimi Antonelli', 12, 'ITA']] },
  { team: 'Aston Martin',     color: '#229971', lineup: [['ALO', 'Fernando Alonso', 14, 'ESP'], ['STR', 'Lance Stroll', 18, 'CAN']] },
  { team: 'Alpine',           color: '#FF87BC', lineup: [['GAS', 'Pierre Gasly', 10, 'FRA'], ['COL', 'Franco Colapinto', 43, 'ARG']] },
  { team: 'Haas',             color: '#B6BABD', lineup: [['OCO', 'Esteban Ocon', 31, 'FRA'], ['BEA', 'Oliver Bearman', 87, 'GBR']] },
  { team: 'Racing Bulls',     color: '#6692FF', lineup: [['HAD', 'Isack Hadjar', 6, 'FRA'], ['LAW', 'Liam Lawson', 30, 'NZL']] },
  { team: 'Williams',         color: '#64C4FF', lineup: [['ALB', 'Alexander Albon', 23, 'THA'], ['SAI', 'Carlos Sainz', 55, 'ESP']] },
  { team: 'Kick Sauber',      color: '#52E252', lineup: [['HUL', 'Nico Hulkenberg', 27, 'GER'], ['BOR', 'Gabriel Bortoleto', 5, 'BRA']] },
] as const;

// Every write is an upsert on a unique key, so re-running changes no row counts.
async function seed() {
  const db = getDb();

  await db.insert(seasons).values({ year: SEASON }).onConflictDoNothing();

  for (const { team, color, lineup } of GRID) {
    const [teamRow] = await db.insert(teams)
      .values({ name: team, color })
      .onConflictDoUpdate({ target: teams.name, set: { color, updatedAt: new Date() } })
      .returning();

    const [teamSeason] = await db.insert(teamSeasons)
      .values({ seasonYear: SEASON, teamId: teamRow.id, color })
      .onConflictDoUpdate({ target: [teamSeasons.seasonYear, teamSeasons.teamId], set: { color } })
      .returning();

    for (const [code, name, number, country] of lineup) {
      const [driverRow] = await db.insert(drivers)
        .values({ code, name, number, country })
        .onConflictDoUpdate({ target: drivers.code, set: { name, number, country, updatedAt: new Date() } })
        .returning();

      await db.insert(driverTeamAssignments)
        .values({ teamSeasonId: teamSeason.id, driverId: driverRow.id })
        .onConflictDoNothing();
    }
  }

  console.log(`seeded ${SEASON}: ${GRID.length} teams, ${GRID.length * 2} drivers`);
}

seed().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });

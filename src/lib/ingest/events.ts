import { isRacingStop } from '@/lib/pit-stops';
import type { EventRow, PitStopRow, PositionRow } from './types';

/**
 * What both transforms derive the same way, whichever upstream the race came
 * from. Pure, like the transforms themselves.
 */

export const slugify = (value: string) =>
  value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** A stop as both upstreams can state it: who, which lap, how long in seconds. */
export type Stop = { driverNumber: number; lap: number; seconds: number | null };

/**
 * Pit stops as rows. The duration is stored in milliseconds because upstream's
 * seconds are a float and a stop is compared at the hundredth — an integer of
 * milliseconds compares exactly, which a float does not.
 *
 * Two stops by the same driver on the same lap cannot both be stored (the
 * unique key is race + driver + lap) and do not happen in a green-flag race;
 * the later one wins, which is the one that finished the sequence.
 */
export function pitStopRows(stops: Stop[]): PitStopRow[] {
  const byKey = new Map<string, PitStopRow>();
  for (const stop of stops) {
    byKey.set(`${stop.driverNumber}:${stop.lap}`, {
      driverNumber: stop.driverNumber,
      lap: stop.lap,
      durationMs: stop.seconds === null ? null : Math.round(stop.seconds * 1000),
    });
  }
  return [...byKey.values()].sort((a, b) => a.lap - b.lap || a.driverNumber - b.driverNumber);
}

/**
 * One event per racing stop. A stop too long to be one — the field sat in the
 * pit lane under a red flag — is left out: the rows keep it verbatim, but
 * narrating "1846.2s in the pit lane" twenty times says nothing about the race
 * being suspended. See lib/pit-stops.ts.
 */
export function pitStopEvents(stops: Stop[]): EventRow[] {
  return stops
    .filter((stop) => stop.seconds === null || isRacingStop(stop.seconds * 1000))
    .map((stop): EventRow => ({
      lap: stop.lap,
      driverNumber: stop.driverNumber,
      type: 'PIT_STOP',
      details: stop.seconds === null ? 'Pit stop' : `${stop.seconds.toFixed(1)}s in the pit lane`,
    }));
}

/**
 * A place gained between one lap and the next. Derived from the position rows
 * rather than from the sample stream, so an overtake means what the replay
 * shows — the running order changed between two laps a viewer can scrub to.
 */
export function buildOvertakes(positions: PositionRow[]): EventRow[] {
  const byDriver = new Map<number, PositionRow[]>();
  for (const row of positions) {
    const list = byDriver.get(row.driverNumber);
    if (list) list.push(row);
    else byDriver.set(row.driverNumber, [row]);
  }

  const events: EventRow[] = [];
  for (const [driverNumber, rows] of byDriver) {
    rows.sort((a, b) => a.lap - b.lap);
    for (let i = 1; i < rows.length; i++) {
      const gained = rows[i - 1].position - rows[i].position;
      if (gained <= 0) continue;
      events.push({
        lap: rows[i].lap,
        driverNumber,
        type: 'OVERTAKE',
        details: `P${rows[i - 1].position} to P${rows[i].position}`,
      });
    }
  }
  return events;
}

export const byLapThenType = (a: EventRow, b: EventRow) => a.lap - b.lap || a.type.localeCompare(b.type);

import type { RaceReplayFieldsFragment, RaceReplayQuery } from '@/graphql/generated/graphql';

/**
 * The shape the replay components consume.
 *
 * Every type here is derived from the generated fragment with TypeScript
 * utility types rather than written out by hand. That matters: if a resolver
 * drops a field, the change propagates here and fails the build, which is the
 * whole reason the payload is a fragment rather than the hand-written
 * `RaceVisualization` type v1 threaded through seven components.
 *
 * Two narrowings happen at this boundary, both because the schema is honest
 * about things the renderer cannot draw:
 *
 * `ReplayDriver.driver` and `.team` are nullable, because a position row can
 * reference an assignment whose driver is missing. There is nothing to render
 * for such an entry — no name, no colour, no line on the chart — so it is
 * dropped once here rather than guarded at every use.
 */

type RawEntry = RaceReplayFieldsFragment['drivers'][number];

export type ReplayPosition = RawEntry['positions'][number];

export type ReplayEntry = Omit<RawEntry, 'driver' | 'team'> & {
  driver: NonNullable<RawEntry['driver']>;
  // `color` is non-null here where the schema has it nullable, because
  // toReplayView fills it. The renderer strokes a line with it on every frame;
  // there is no sensible "no colour" branch, only a default.
  team: Omit<NonNullable<RawEntry['team']>, 'color'> & { color: string };
};

export type ReplayEvent = RaceReplayFieldsFragment['events'][number];
export type ReplaySummary = RaceReplayFieldsFragment['summary'];

type RaceNode = NonNullable<RaceReplayQuery['race']>;

/** Race metadata the chart header draws, flattened out of `meeting`. */
export type ReplayRace = {
  name: string;
  season: number;
  round: number;
  country: string;
  circuitName: string | null;
  weather: string | null;
  laps: number;
};

export type ReplayView = {
  race: ReplayRace;
  laps: number[];
  summary: ReplaySummary;
  drivers: ReplayEntry[];
  events: ReplayEvent[];
};

/** Colour for a team row that has none. Grey reads as "unknown", not as a team. */
const FALLBACK_TEAM_COLOR = '#8892a0';

export function toReplayView(race: RaceNode): ReplayView {
  const drivers: ReplayEntry[] = race.replay.drivers
    .filter((entry): entry is RawEntry & { driver: NonNullable<RawEntry['driver']> } =>
      entry.driver !== null,
    )
    .map((entry) => ({
      ...entry,
      driver: entry.driver,
      // A team with no colour still has a name and still belongs on the chart,
      // so this fills the one field the renderer cannot do without.
      team: entry.team ?? { id: `unknown-${entry.driver.id}`, name: 'Unknown', color: null },
    }))
    .map((entry) => ({
      ...entry,
      team: { ...entry.team, color: entry.team.color ?? FALLBACK_TEAM_COLOR },
    }));

  return {
    race: {
      name: race.meeting?.name ?? race.slug,
      season: race.meeting?.season ?? 0,
      round: race.meeting?.round ?? 0,
      country: race.meeting?.country ?? '',
      circuitName: race.meeting?.circuitName ?? null,
      weather: race.meeting?.weather ?? null,
      laps: race.laps,
    },
    laps: race.replay.laps,
    summary: race.replay.summary,
    drivers,
    events: race.replay.events,
  };
}

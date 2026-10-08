import type { ReplayEntry, ReplayEvent, ReplayPosition } from "./types";

export type ReplayEventKind =
  | "pit"
  | "dnf"
  | "dns"
  | "dnq"
  | "dsq"
  | "yellow"
  | "double-yellow"
  | "red-flag"
  | "safety-car"
  | "virtual-safety-car"
  | "penalty"
  | "green"
  | "chequered"
  | "overtake"
  | "fastest-lap"
  | "other";

export type RaceControlStatus =
  | "green"
  | "yellow"
  | "double-yellow"
  | "red-flag"
  | "safety-car"
  | "virtual-safety-car"
  | "chequered";

export type ReplayRaceControl = {
  status: RaceControlStatus;
  label: string;
  details: string | null;
};

const GREEN_FLAG_PATTERN = /\b(green|restart|resume|clear)\b/i;

export function classifyReplayEvent(
  event: Pick<ReplayEvent, "type" | "details">,
): ReplayEventKind {
  const haystack = `${event.type} ${event.details}`.toLowerCase();

  if (haystack.includes("double yellow")) {
    return "double-yellow";
  }

  if (haystack.includes("virtual safety") || haystack.includes("vsc")) {
    return "virtual-safety-car";
  }

  if (haystack.includes("safety car")) {
    return "safety-car";
  }

  if (haystack.includes("red flag")) {
    return "red-flag";
  }

  if (haystack.includes("chequered") || haystack.includes("checker")) {
    return "chequered";
  }

  if (GREEN_FLAG_PATTERN.test(haystack)) {
    return "green";
  }

  if (haystack.includes("yellow")) {
    return "yellow";
  }

  if (haystack.includes("dnq")) {
    return "dnq";
  }

  if (haystack.includes("dsq") || haystack.includes("disqual")) {
    return "dsq";
  }

  if (haystack.includes("dns")) {
    return "dns";
  }

  if (haystack.includes("dnf") || haystack.includes("retired") || haystack.includes("ret")) {
    return "dnf";
  }

  if (haystack.includes("pit")) {
    return "pit";
  }

  if (haystack.includes("penalt")) {
    return "penalty";
  }

  // Both are archive event types — Ergast files an OVERTAKE per position change
  // and a FASTEST_LAP per race. Neither carries a keyword in its details
  // ("P17 to P16"), so without matching the type they fell through to "other"
  // and drew as grey markers on the canvas.
  if (haystack.includes("fastest")) {
    return "fastest-lap";
  }

  if (haystack.includes("overtake")) {
    return "overtake";
  }

  return "other";
}

/**
 * How each kind of event is drawn: the chip's styling, and the marker's fill.
 *
 * One table rather than two switches over the same union in the same order.
 * The pairings are not symmetrical and that is deliberate — a retirement is a
 * red chip but a double-yellow marker, and an overtake has a colour with no
 * chip — so a table also makes the odd ones visible instead of hiding them
 * eleven cases apart.
 *
 * `tone` carries the shared treatment and the modifier names the signal; both
 * are defined in globals.css, derived from the `--flag-*` tokens with
 * color-mix. This used to return raw Tailwind palette classes with a
 * hand-written `dark:` variant on each — eighteen spellings for nine signals,
 * none of which applied, because the `dark` variant was gated on a class
 * nothing ever set. The colour is a `var()` reference rather than a hex
 * literal so a marker and its chip cannot drift apart, and so both follow the
 * theme.
 *
 * See docs/decisions.md, "Flag colours are tokens, not palette classes".
 */
const NEUTRAL = { tone: "tone tone-neutral", color: "var(--muted)" };

// Retirements are a red chip but a grey marker: their race is over. Orange
// would sit beside the safety car and VSC in the timeline key, and it used to
// be the double yellow's exact colour.
const EVENT_STYLE: Record<ReplayEventKind, { tone: string; color: string }> = {
  pit: { tone: "tone tone-pit", color: "var(--flag-pit)" },
  dnf: { tone: "tone tone-red", color: "var(--flag-chequered)" },
  dns: { tone: "tone tone-red", color: "var(--flag-chequered)" },
  dnq: { tone: "tone tone-red", color: "var(--flag-chequered)" },
  dsq: { tone: "tone tone-red", color: "var(--flag-chequered)" },
  yellow: { tone: "tone tone-yellow", color: "var(--flag-yellow)" },
  "double-yellow": { tone: "tone tone-double-yellow", color: "var(--flag-double-yellow)" },
  "red-flag": { tone: "tone tone-red", color: "var(--flag-red)" },
  "safety-car": { tone: "tone tone-safety-car", color: "var(--flag-safety-car)" },
  "virtual-safety-car": { tone: "tone tone-vsc", color: "var(--flag-vsc)" },
  penalty: { tone: "tone tone-penalty", color: "var(--flag-penalty)" },
  green: { tone: "tone tone-green", color: "var(--flag-green)" },
  chequered: { tone: "tone tone-chequered", color: "var(--flag-chequered)" },
  // No chip of their own: both appear on the chart, not in the race control
  // strip, so they take the neutral tone and a colour that is not a flag.
  overtake: { tone: NEUTRAL.tone, color: "var(--accent)" },
  "fastest-lap": { tone: NEUTRAL.tone, color: "var(--timing-best)" },
  other: NEUTRAL,
};

export function getReplayEventTone(kind: ReplayEventKind) {
  return (EVENT_STYLE[kind] ?? NEUTRAL).tone;
}

export function getReplayEventMarkerColor(kind: ReplayEventKind) {
  return (EVENT_STYLE[kind] ?? NEUTRAL).color;
}

/**
 * The VSC marker is drawn as an outline: a lighter safety car, same family.
 * Its colour alone is a near-identical orange, so the shape carries the
 * difference — which also holds for a reader who can't tell the two apart.
 */
export function isHollowMarker(kind: ReplayEventKind) {
  return kind === "virtual-safety-car";
}

/** The race's state when nothing has been flagged. */
export const GREEN_FLAG: ReplayRaceControl = { status: "green", label: "Green Flag", details: null };

export function buildRaceControlByLap(
  laps: number[],
  events: ReplayEvent[],
): Map<number, ReplayRaceControl> {
  const sortedEvents = [...events].sort((left, right) => left.lap - right.lap);
  const result = new Map<number, ReplayRaceControl>();
  let eventIndex = 0;
  let current: ReplayRaceControl = GREEN_FLAG;
  let clearsAfter: ReplayRaceControl | null = null;

  for (const lap of laps) {
    while (eventIndex < sortedEvents.length && sortedEvents[eventIndex]?.lap === lap) {
      const event = sortedEvents[eventIndex];
      const kind = classifyReplayEvent(event);

      if (kind === "yellow") {
        current = { status: "yellow", label: "Yellow Flag", details: event.details };
      } else if (kind === "double-yellow") {
        current = { status: "double-yellow", label: "Double Yellow", details: event.details };
      } else if (kind === "red-flag") {
        current = { status: "red-flag", label: "Red Flag", details: event.details };
      } else if (kind === "safety-car") {
        current = { status: "safety-car", label: "Safety Car", details: event.details };
      } else if (kind === "virtual-safety-car") {
        current = {
          status: "virtual-safety-car",
          label: "Virtual Safety Car",
          details: event.details,
        };
      } else if (kind === "green") {
        // Race control clears the track on the last lap behind the safety
        // car, so the racing starts on the lap after.
        clearsAfter = { status: "green", label: "Green Flag", details: event.details };
      } else if (kind === "chequered") {
        current = { status: "chequered", label: "Chequered Flag", details: event.details };
      }

      eventIndex += 1;
    }

    result.set(lap, current);
    if (clearsAfter) {
      current = clearsAfter;
      clearsAfter = null;
    }
  }

  return result;
}


export function getDriverPointForLap(
  positions: ReplayPosition[],
  lap: number,
) {
  let candidate = positions[0];

  for (const entry of positions) {
    if (entry.lap === lap) {
      return entry;
    }

    if (entry.lap < lap) {
      candidate = entry;
    }
  }

  return candidate ?? null;
}

/**
 * The index of the lap closest to `lap`, or 0 when there is nothing to match.
 * Lives here rather than in the player so it is reachable from a plain unit
 * test — vitest runs `.test.ts` without a DOM.
 */
export function nearestLapIndex(laps: number[], lap: number | undefined): number {
  if (lap == null || laps.length === 0) return 0;
  let best = 0;
  for (let i = 1; i < laps.length; i++) {
    if (Math.abs(laps[i] - lap) < Math.abs(laps[best] - lap)) best = i;
  }
  return best;
}

/**
 * A sentence naming the laps upstream never published for this race, or null
 * when the record is complete.
 *
 * Both inputs are already in the replay payload — `laps` is the sparse set of
 * laps that have rows, `totalLaps` is the race distance — so the notice costs
 * no extra field on the schema. The gap is real and upstream: a race can be
 * missing a range in the middle, or stop short of its final lap, and a replay
 * that skips them silently reads as our bug rather than a hole in the source.
 */
export function describeMissingLaps(laps: number[], totalLaps: number): string | null {
  if (laps.length === 0 || totalLaps <= 0) return null;

  const present = new Set(laps);
  const lastPresent = Math.max(...laps);
  const ranges: string[] = [];
  let gapStart: number | null = null;

  for (let lap = 1; lap <= lastPresent; lap++) {
    if (!present.has(lap)) {
      gapStart ??= lap;
      continue;
    }
    if (gapStart !== null) {
      ranges.push(gapStart === lap - 1 ? `lap ${gapStart}` : `laps ${gapStart}–${lap - 1}`);
      gapStart = null;
    }
  }

  const sentences: string[] = [];

  if (ranges.length > 0) {
    sentences.push(
      `Lap data for ${ranges.join(", ")} was never published, so the replay jumps over it.`,
    );
  }

  if (lastPresent < totalLaps) {
    sentences.push(
      `The record stops at lap ${lastPresent} of ${totalLaps} — the final laps were not published, so the replay ends before the flag.`,
    );
  }

  return sentences.length > 0 ? sentences.join(" ") : null;
}

/**
 * The same entries with the focused one last.
 *
 * SVG has no z-index — paint order is the only thing that puts one line over
 * another — so a focused driver drawn in the middle of the list sits under
 * every faint line after it. Returns the list unchanged when nothing is
 * focused, or when the focused driver has no entry in it, which happens on a
 * lap that has no row for them.
 */
/**
 * Smoothstep, for the position channel only.
 *
 * A lap's worth of linear interpolation makes twenty cars drift down straight
 * diagonals; easing the ends makes a position swap read as a car pulling out
 * and settling back in. It must not touch the x channel — x is time, and a
 * chart whose playhead eases is a chart that disagrees with its own scrubber.
 */
export function easeLapProgress(progress: number) {
  const p = Math.min(1, Math.max(0, progress));
  return p * p * (3 - 2 * p);
}

export function withFocusLast<T extends { entry: { driver: { id: string } } }>(
  frames: T[],
  focusedDriverId: string | null,
): T[] {
  if (focusedDriverId == null) return frames;

  const focused = frames.filter((frame) => frame.entry.driver.id === focusedDriverId);
  if (focused.length === 0) return frames;

  return [...frames.filter((frame) => frame.entry.driver.id !== focusedDriverId), ...focused];
}

/**
 * The lap each car stopped on, for cars the events never retire.
 *
 * A retirement that was still classified — Hamilton three laps from the end of
 * Abu Dhabi 2022, Norris after the Spielberg 2024 collision — is a finisher in
 * the results, so neither upstream gives it a retirement event. Its rows just
 * end, and the chart held its badge on the last position it had while the field
 * moved through it: two badges on one row for the rest of the race.
 *
 * A car is taken as stopped on its last lap once another car holds that
 * position on a later lap. A lapped finisher whose rows end a lap or two early
 * is not: only the cars ahead of it have later rows, and none of them is in its
 * place.
 */
export function inferredRetirementLaps(drivers: { driver: { id: string }; positions: ReplayPosition[] }[]) {
  const held = new Map<number, Set<number>>();
  for (const { positions } of drivers) {
    for (const { lap, position } of positions) {
      held.set(lap, (held.get(lap) ?? new Set()).add(position));
    }
  }

  const result = new Map<string, number>();
  for (const { driver, positions } of drivers) {
    const last = positions[positions.length - 1];
    if (!last) continue;
    for (const [lap, taken] of held) {
      if (lap > last.lap && taken.has(last.position)) {
        result.set(driver.id, last.lap);
        break;
      }
    }
  }
  return result;
}

function isRetirementKind(event: ReplayEvent) {
  const kind = classifyReplayEvent(event);
  return kind === "dnf" || kind === "dns" || kind === "dnq" || kind === "dsq";
}

/**
 * Each retired car's retirement: the earliest retirement event, else the lap
 * it stopped on. The chart and the timing tower both read this, so a car leaves
 * the running order in both at the same lap.
 */
export function getRetirementLapByDriver(events: ReplayEvent[], drivers: ReplayEntry[]) {
  const result = new Map<string, ReplayEvent>();

  for (const event of events) {
    if (!event.driver || !isRetirementKind(event)) {
      continue;
    }

    const existing = result.get(event.driver.id);
    if (!existing || event.lap < existing.lap) {
      result.set(event.driver.id, event);
    }
  }

  // A car that stopped without a retirement event (see inferredRetirementLaps)
  // is drawn the same way, so its badge leaves instead of sitting on the car
  // that took its place. Not for the story panel: it lists what the upstreams
  // reported, and this is an inference.
  for (const [driverId, lap] of inferredRetirementLaps(drivers)) {
    const entry = drivers.find((candidate) => candidate.driver.id === driverId);
    if (!entry || result.has(driverId)) continue;
    result.set(driverId, { lap, type: "RETIREMENT", details: "Stopped", driver: entry.driver });
  }

  return result;
}

/**
 * The tower's order: running cars by position, then retired cars, the latest
 * retirement first, as a classification lists them. A retired car keeps the
 * last position it held, which the car behind has since taken, so sorting on
 * position alone printed two cars in one place for the rest of the race.
 */
export function compareTowerRows(
  a: { position: number; retiredLap: number | null },
  b: { position: number; retiredLap: number | null },
) {
  if (a.retiredLap === null || b.retiredLap === null) {
    if (a.retiredLap !== b.retiredLap) return a.retiredLap === null ? -1 : 1;
    return a.position - b.position;
  }
  return b.retiredLap - a.retiredLap || a.position - b.position;
}

import { classifyReplayEvent, type ReplayEventKind } from "./replay-state";
import type { ReplayEntry, ReplayEvent, ReplayView } from "./types";

/**
 * The race, as a list of moments worth stopping at.
 *
 * Pure and React-free so the wording can be tested without rendering anything.
 * Two sources feed it: the events upstream published, and position swings
 * derived from the lap-by-lap order — a driver who gains two or more places
 * between consecutive recorded laps did something, even where no event row says
 * so.
 */

export type StoryKind = "control" | "strategy" | "overtake";

export type StoryMoment = {
  id: string;
  lap: number;
  /** Prose: "Safety car", "NOR pits", "HUL retires". Never a raw enum. */
  title: string;
  description: string;
  kind: StoryKind;
  /** The classified event kind, for colour. Derived moments have no event. */
  eventKind: ReplayEventKind;
  /** Places gained, on a moment derived from the lap order. */
  places?: number;
  /** The driver it is about, where there is one. */
  driverId?: string;
};

/**
 * A title someone would say out loud.
 *
 * The old version rendered `${event.type} on lap ${event.lap}`, which put
 * `RETIREMENT on lap 4` on screen. Everything here routes through
 * `classifyReplayEvent`, which already resolves fifteen kinds out of the type
 * and the free-text details — so a red flag recorded as type OTHER with
 * "Red flag" in its details still reads as a red flag.
 *
 * The lap is deliberately not in the string: it is rendered as its own element
 * beside the title, and splicing it in would repeat it.
 */
export function describeMoment(kind: ReplayEventKind, driverCode: string | null): string {
  switch (kind) {
    case "safety-car":
      return "Safety car";
    case "virtual-safety-car":
      return "Virtual safety car";
    case "red-flag":
      return "Red flag";
    case "yellow":
      return "Yellow flag";
    case "double-yellow":
      return "Double yellow";
    case "green":
      return "Green flag";
    case "chequered":
      return "Chequered flag";
    case "pit":
      return driverCode ? `${driverCode} pits` : "Pit stop";
    case "dnf":
      return driverCode ? `${driverCode} retires` : "Retirement";
    case "dns":
      return driverCode ? `${driverCode} does not start` : "Did not start";
    case "dnq":
      return driverCode ? `${driverCode} did not qualify` : "Did not qualify";
    case "dsq":
      return driverCode ? `${driverCode} disqualified` : "Disqualification";
    case "penalty":
      return driverCode ? `${driverCode} penalised` : "Penalty";
    case "fastest-lap":
      return driverCode ? `${driverCode} sets the fastest lap` : "Fastest lap";
    case "overtake":
      return driverCode ? `${driverCode} moves up` : "Position change";
    default:
      return driverCode ? `${driverCode}` : "Race control";
  }
}

// Strategy and race control are different questions about a race, and the
// filter chips are the reason to tell them apart.
function storyKindOf(eventKind: ReplayEventKind): StoryKind {
  if (eventKind === "pit") return "strategy";
  // An overtake filed by the archive belongs with the position swings derived
  // from lap order, not with race control.
  if (eventKind === "overtake") return "overtake";
  return "control";
}

const gainKey = (driverId: string, lap: number) => `${driverId}-${lap}`;

function fromEvent(event: ReplayEvent, index: number): StoryMoment {
  const eventKind = classifyReplayEvent(event);
  const code = event.driver?.code ?? null;

  return {
    // The schema exposes no event id. Lap, type and ordinal identify a row
    // just as well and need no new field.
    id: `event-${event.lap}-${event.type}-${index}`,
    lap: event.lap,
    title: describeMoment(eventKind, code),
    description: event.driver ? `${event.driver.name} — ${event.details}` : event.details,
    kind: storyKindOf(eventKind),
    eventKind,
    driverId: event.driver?.id,
  };
}

/** Two places in one recorded lap. Below that is traffic, not a move. */
const GAIN_THRESHOLD = 2;

function fromPositions(entry: ReplayEntry): StoryMoment[] {
  const moments: StoryMoment[] = [];

  for (let index = 1; index < entry.positions.length; index += 1) {
    const previous = entry.positions[index - 1];
    const current = entry.positions[index];
    if (!previous || !current) continue;

    const gained = previous.position - current.position;
    if (gained < GAIN_THRESHOLD) continue;

    moments.push({
      id: `gain-${entry.driver.id}-${current.lap}`,
      lap: current.lap,
      title: `${entry.driver.code} gains ${gained} place${gained === 1 ? "" : "s"}`,
      description: `${entry.driver.name} moves from P${previous.position} to P${current.position}.`,
      kind: "overtake",
      eventKind: "overtake",
      places: gained,
      driverId: entry.driver.id,
    });
  }

  return moments;
}

export function buildStoryMoments(visualization: ReplayView): StoryMoment[] {
  const gains: StoryMoment[] = [];
  // The archive files an OVERTAKE per position change, and the lap order gives
  // the same move again with the places counted. Where both describe one driver
  // on one lap, the derived one wins: "COL gains 2 places" says more than
  // "COL moves up", and showing both puts the same fact on the timeline twice.
  const derived = new Set<string>();

  for (const entry of visualization.drivers) {
    for (const moment of fromPositions(entry)) {
      gains.push(moment);
      derived.add(gainKey(entry.driver.id, moment.lap));
    }
  }

  const events = visualization.events
    .map(fromEvent)
    .filter((moment, index) => {
      const event = visualization.events[index];
      if (moment.eventKind !== "overtake" || !event.driver) return true;
      return !derived.has(gainKey(event.driver.id, moment.lap));
    });

  return [...events, ...gains]
    .sort((left, right) => left.lap - right.lap || left.title.localeCompare(right.title))
    // Upstream repeats a race-control message on consecutive rows often enough
    // that the same sentence would otherwise appear twice on one lap.
    .filter((moment, index, moments) => {
      const previous = moments[index - 1];
      return !previous || previous.title !== moment.title || previous.lap !== moment.lap;
    });
}

export type Significance = "major" | "minor";

/** A gain worth a marker of its own, once single-place changes are set aside. */
const MAJOR_GAIN = 3;

/**
 * Whether a moment earns a marker by default.
 *
 * The archive files an OVERTAKE per position change, so a normal race carries
 * well over a hundred of them — 186 on the 53 laps of Japan 2024. Drawing them
 * all put the chart behind a curtain of dashed lines and packed the timeline
 * into one unbroken band. They are not wrong, they are just not all worth a
 * person's attention at once, and the filters still bring them back.
 *
 * Shared by the timeline and the canvas so the two cannot disagree about what
 * the notable moments of a race were.
 */
export function significanceOf(moment: StoryMoment): Significance {
  // Derived gains are checked first: they carry eventKind "overtake" too, for
  // colour, and would otherwise all be dismissed as minor before being counted.
  if (moment.places !== undefined) {
    return moment.places >= MAJOR_GAIN ? "major" : "minor";
  }

  // An archive OVERTAKE row: one position, no places counted.
  if (moment.eventKind === "overtake") return "minor";

  return "major";
}

/** The last moment at or before the current lap — what the replay is showing. */
export function activeMomentAt(moments: StoryMoment[], lap: number): StoryMoment | null {
  let active: StoryMoment | null = null;
  for (const moment of moments) {
    if (moment.lap > lap) break;
    active = moment;
  }
  return active;
}

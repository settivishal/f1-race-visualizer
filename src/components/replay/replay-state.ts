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

export type DriverReplayState = {
  driverId: string;
  isLapped: boolean;
  lapsDown: number;
  isBackmarker: boolean;
  isRetired: boolean;
  statusLabel: string | null;
  gapLabel: string | null;
};

const LAP_DOWN_PATTERN = /(\d+)\s*(?:lap|laps)/i;
const RETIRED_PATTERN = /\b(dnf|dns|dnq|dsq|ret|retired)\b/i;
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

  if (haystack.includes("penalt")) {
    return "penalty";
  }

  return "other";
}

export function getReplayEventTone(kind: ReplayEventKind) {
  switch (kind) {
    case "pit":
      return "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-500/20 dark:bg-sky-950/20 dark:text-sky-200";
    case "dnf":
    case "dns":
    case "dnq":
    case "dsq":
    case "red-flag":
      return "border-red-200 bg-red-50 text-red-950 dark:border-red-500/20 dark:bg-red-950/20 dark:text-red-200";
    case "yellow":
    case "double-yellow":
      return "border-yellow-200 bg-yellow-50 text-yellow-950 dark:border-yellow-500/20 dark:bg-yellow-950/20 dark:text-yellow-200";
    case "safety-car":
    case "virtual-safety-car":
      return "border-orange-200 bg-orange-50 text-orange-950 dark:border-orange-500/20 dark:bg-orange-950/20 dark:text-orange-200";
    case "penalty":
      return "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-500/20 dark:bg-rose-950/20 dark:text-rose-200";
    case "green":
      return "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-500/20 dark:bg-emerald-950/20 dark:text-emerald-200";
    case "chequered":
      return "border-zinc-300 bg-zinc-100 text-zinc-950 dark:border-zinc-500/20 dark:bg-zinc-950/30 dark:text-zinc-200";
    default:
      return "border-line bg-panel text-foreground";
  }
}

export function getReplayEventMarkerColor(kind: ReplayEventKind) {
  switch (kind) {
    case "pit":
      return "#38bdf8";
    case "dnf":
    case "dns":
    case "dnq":
    case "dsq":
      return "#f59e0b";
    case "yellow":
    case "double-yellow":
      return "#facc15";
    case "red-flag":
      return "#fb7185";
    case "safety-car":
    case "virtual-safety-car":
      return "#fb923c";
    case "penalty":
      return "#f43f5e";
    case "green":
      return "#4ade80";
    case "chequered":
      return "#d4d4d8";
    default:
      return "#f8f2e8";
  }
}

export function buildRaceControlByLap(
  laps: number[],
  events: ReplayEvent[],
): Map<number, ReplayRaceControl> {
  const sortedEvents = [...events].sort((left, right) => left.lap - right.lap);
  const result = new Map<number, ReplayRaceControl>();
  let eventIndex = 0;
  let current: ReplayRaceControl = {
    status: "green",
    label: "Green Flag",
    details: null,
  };

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
        current = { status: "green", label: "Green Flag", details: event.details };
      } else if (kind === "chequered") {
        current = { status: "chequered", label: "Chequered Flag", details: event.details };
      }

      eventIndex += 1;
    }

    result.set(lap, current);
  }

  return result;
}

export function getRaceControlTone(status: RaceControlStatus) {
  switch (status) {
    case "yellow":
    case "double-yellow":
      return "border-yellow-200 bg-yellow-50 text-yellow-900";
    case "red-flag":
      return "border-red-200 bg-red-50 text-red-900";
    case "safety-car":
    case "virtual-safety-car":
      return "border-orange-200 bg-orange-50 text-orange-900";
    case "chequered":
      return "border-zinc-300 bg-zinc-100 text-zinc-900";
    default:
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
}

export function buildDriverReplayState(
  drivers: ReplayEntry[],
  lap: number,
): Map<string, DriverReplayState> {
  const states = new Map<string, DriverReplayState>();

  for (const entry of drivers) {
    const currentPoint = getDriverPointForLap(entry.positions, lap);
    const gap = currentPoint?.gap ?? null;
    const lapsDownMatch = gap ? gap.match(LAP_DOWN_PATTERN) : null;
    const lapsDown = lapsDownMatch ? Number(lapsDownMatch[1]) || 0 : 0;
    const isRetired = gap ? RETIRED_PATTERN.test(gap) : false;
    const isLapped = lapsDown > 0;
    
    let gapSeconds = 0;
    if (gap && gap.endsWith('s')) {
      const match = gap.match(/\+?(\d+\.\d+)s?/);
      if (match) gapSeconds = parseFloat(match[1]);
    }
    
    // A driver is a backmarker if they are lapped or significantly far behind (e.g. > 60s)
    const isBackmarker = !isRetired && (isLapped || gapSeconds > 60);

    let statusLabel: string | null = null;
    if (isRetired) {
      statusLabel = "Retired";
    } else if (isLapped) {
      statusLabel = `${lapsDown} lap${lapsDown === 1 ? "" : "s"} down`;
    } else if (isBackmarker) {
      statusLabel = "Backmarker";
    }

    states.set(entry.driver.id, {
      driverId: entry.driver.id,
      isLapped,
      lapsDown,
      isBackmarker,
      isRetired,
      statusLabel,
      gapLabel: gap,
    });
  }

  return states;
}

export function summarizeDriverReplayState(states: Map<string, DriverReplayState>) {
  let lappedCount = 0;
  let backmarkerCount = 0;
  let retiredCount = 0;

  for (const state of states.values()) {
    if (state.isLapped) {
      lappedCount += 1;
    }
    if (state.isBackmarker) {
      backmarkerCount += 1;
    }
    if (state.isRetired) {
      retiredCount += 1;
    }
  }

  return {
    lappedCount,
    backmarkerCount,
    retiredCount,
  };
}

function getDriverPointForLap(
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

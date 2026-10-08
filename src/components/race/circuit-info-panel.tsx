import Link from "next/link";
import { Card } from "@/components/ui/card";

export type CircuitFacts = {
  ergastId: string;
  name: string;
  locality: string | null;
  country: string | null;
  lengthKm: number | null;
  turns: number | null;
  firstGrandPrix: number | null;
};

/**
 * The circuit, from the database.
 *
 * This used to read `lib/circuit-data.ts`: a table keyed by country, with a
 * fallback that returned 15 turns, 5.0 km and "first held in 1950" for anything
 * it did not recognise. One season made that survivable. An archive does not —
 * Hockenheim, Sochi and Paul Ricard are all inside the 2018 window, and every
 * one of them would have rendered invented numbers as facts.
 *
 * So every figure here is optional, and a missing one is simply absent. The
 * race distance is computed from laps × length only when the length is known,
 * because a distance derived from a guessed length is a guess with a decimal
 * point on it.
 */
export function CircuitInfoPanel({
  circuit,
  circuitName,
  country,
  laps,
}: {
  circuit: CircuitFacts | null;
  /** The name on the meeting, used when no circuit row is linked yet. */
  circuitName: string | null;
  country: string | null;
  laps: number;
}) {
  const name = circuit?.name ?? circuitName ?? "Circuit";
  const place = [circuit?.locality, circuit?.country ?? country].filter(Boolean).join(", ");

  const facts: { label: string; value: string }[] = [];
  if (circuit?.lengthKm != null) {
    facts.push({ label: "Length", value: `${circuit.lengthKm.toFixed(3)} km` });
  }
  if (circuit?.turns != null) facts.push({ label: "Turns", value: String(circuit.turns) });
  // `laps` is 0 until a race has run. A "0" and a "0.0 km" race distance are
  // not facts about the race, so a race still to come shows neither.
  if (laps > 0) facts.push({ label: "Laps", value: String(laps) });
  if (circuit?.lengthKm != null && laps > 0) {
    facts.push({
      label: "Race distance",
      value: `${(circuit.lengthKm * laps).toFixed(1)} km`,
    });
  }
  if (circuit?.firstGrandPrix != null) {
    facts.push({ label: "First grand prix", value: String(circuit.firstGrandPrix) });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-eyebrow font-bold uppercase text-accent">Circuit</p>
          <h2 className="type-section-title mt-2">{name}</h2>
          {place ? <p className="mt-1 text-sm text-muted">{place}</p> : null}
        </div>
        {circuit ? (
          <Link
            href={`/circuits/${circuit.ergastId}`}
            className="rounded-sm text-eyebrow font-semibold uppercase text-muted transition-colors hover:text-foreground"
          >
            Every race here →
          </Link>
        ) : null}
      </div>

      {facts.length > 0 ? (
        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-[11px] uppercase tracking-wider text-muted">{fact.label}</dt>
              <dd className="font-heading mt-1 text-xl tracking-wide">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/* Only on a race that has run, where the missing figures are a gap in
          what we hold. Before the race there is nothing more to say. */}
      {circuit === null && laps > 0 ? (
        <p className="mt-5 text-sm text-muted">
          Track length and turns aren&rsquo;t on record for this circuit yet.
        </p>
      ) : null}
    </Card>
  );
}

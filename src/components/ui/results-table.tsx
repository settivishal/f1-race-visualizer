import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';

/**
 * The one shape for a ranked table: the race classification and both
 * championship tables. The top three stand in a strip of their own, everyone
 * else is a tight row — team colour bar, driver code, name — so a phone reads
 * it without scrolling sideways.
 */

export type Place = {
  position: number;
  title: string;
  subtitle?: string;
  color: string | null;
  code?: string;
  points: number;
  note?: ReactNode;
  mark?: ReactNode;
  /** Points as a share of the leader's, 0–1. Drawn as a bar when given. */
  share?: number;
};

/** Cell padding, shared so every table lines up with the strip above it. */
export const FIRST = 'tabular py-2 pl-4 pr-2 text-muted sm:pl-6';
export const CELL = 'py-2 pr-3';
export const LAST = 'tabular py-2 pr-4 text-right sm:pr-6';

export function ResultsTable({
  caption,
  columns,
  top,
  children,
}: {
  caption: string;
  columns: { label: string; className?: string; srOnly?: boolean }[];
  top?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="mt-4 overflow-hidden p-0">
      {top}
      {/* Fixed layout, so the columns sit where the header puts them rather
          than wherever the longest name pushes them. */}
      <table className="w-full table-fixed text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-eyebrow uppercase text-muted">
            {columns.map((column, index) => (
              <th
                key={column.label}
                scope="col"
                className={`font-semibold ${
                  index === 0
                    ? 'w-12 py-2.5 pl-4 pr-2 sm:w-16 sm:pl-6'
                    : index === columns.length - 1
                      ? 'w-14 py-2.5 pr-4 text-right sm:w-20 sm:pr-6'
                      : 'py-2.5 pr-3'
                } ${column.className ?? ''}`}
              >
                {column.srOnly ? <span className="sr-only">{column.label}</span> : column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </Card>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return (
    <tr className="border-b border-line/60 transition-colors last:border-0 hover:bg-panel-strong/50">
      {children}
    </tr>
  );
}

/** A count where zero is the common case: a quiet dot, so the few that aren't stand out. */
export function Count({ value }: { value: number }) {
  return value === 0 ? <span className="text-subtle">·</span> : <>{value}</>;
}

/** How far a row is from the leader, as a bar in its team's colour. */
export function ShareBar({ share, color }: { share: number; color: string | null }) {
  return (
    <span className="block h-1 w-full rounded-full bg-line" aria-hidden>
      <span
        className="block h-1 rounded-full"
        style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%`, backgroundColor: color ?? 'var(--muted)' }}
      />
    </span>
  );
}

/**
 * The team bar, the code and the name. On a phone the code alone carries the
 * row; the full name joins it from `sm` up.
 */
export function Entrant({
  code,
  name,
  color,
  mark,
  large = false,
}: {
  code?: string;
  name: string;
  color: string | null;
  mark?: ReactNode;
  large?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className={`${large ? 'h-5' : 'h-3.5'} w-[3px] shrink-0 rounded-full`}
        style={{ backgroundColor: color ?? 'var(--muted)' }}
      />
      {code ? (
        <span
          className={`font-mono font-semibold ${
            large ? 'text-sm text-muted' : 'text-xs text-foreground sm:text-muted'
          }`}
        >
          {code}
        </span>
      ) : null}
      <span
        className={`truncate font-medium ${large ? 'text-lg' : ''} ${
          code && !large ? 'hidden sm:inline' : ''
        }`}
      >
        {name}
      </span>
      {mark}
    </span>
  );
}

/**
 * A team's colour as a top edge and a faint wash down from it — a little
 * stronger for whoever leads. Every card that belongs to a team wears this.
 */
export function teamWash(color: string | null, lead = false) {
  const tint = color ?? 'var(--muted)';
  return {
    borderTop: `2px solid ${tint}`,
    backgroundImage: `linear-gradient(to bottom, color-mix(in oklab, ${tint} ${
      lead ? 22 : 12
    }%, transparent), transparent 75%)`,
  };
}

/** P2, P1, P3 left to right on a desktop, the way a podium stands. */
const ORDER: Record<number, string> = { 1: 'sm:order-2', 2: 'sm:order-1', 3: 'sm:order-3' };

/**
 * Each place wears its team: a top edge and a faint wash in the team colour,
 * a little stronger for the leader. The points sit beside the numeral, since
 * they are what the place was won with.
 */
export function TopThree({ places, label, leadLabel }: { places: Place[]; label: string; leadLabel: ReactNode }) {
  return (
    <ol
      aria-label={label}
      className="grid divide-y divide-line border-b border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0"
    >
      {places.map((place) => {
        const lead = place.position === 1;
        return (
          <li
            key={place.code ?? place.title}
            className={`px-5 py-4 sm:px-6 sm:py-5 ${ORDER[place.position] ?? ''}`}
            style={teamWash(place.color, lead)}
          >
            <span className="flex h-4 items-center gap-1.5 text-eyebrow font-semibold uppercase text-muted">
              {lead ? leadLabel : null}
            </span>
            <span className="mt-1 flex items-end justify-between gap-3">
              <span
                className={`tabular font-heading text-5xl font-light leading-none sm:text-6xl ${
                  lead ? 'text-foreground' : 'text-subtle'
                }`}
              >
                {place.position}
              </span>
              <span className="tabular font-heading text-2xl font-semibold leading-none">
                {place.points}
                <span className="ml-1 text-sm font-medium text-muted">pts</span>
              </span>
            </span>
            <span className="mt-4 block">
              <Entrant code={place.code} name={place.title} color={place.color} mark={place.mark} large />
            </span>
            {place.subtitle ? (
              <span className="mt-0.5 block pl-[11px] text-sm text-muted">{place.subtitle}</span>
            ) : null}
            {place.note ? (
              <span className="mt-2 block pl-[11px] text-sm text-muted">{place.note}</span>
            ) : null}
            {place.share !== undefined ? (
              <span className="mt-3 block pl-[11px]">
                <ShareBar share={place.share} color={place.color} />
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

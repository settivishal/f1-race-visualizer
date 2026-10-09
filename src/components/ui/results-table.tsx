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
  stat: ReactNode;
  note?: ReactNode;
  mark?: ReactNode;
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
  columns: { label: string; className?: string }[];
  top?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="mt-4 overflow-hidden p-0">
      {top}
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-eyebrow uppercase text-muted">
            {columns.map((column, index) => (
              <th
                key={column.label}
                scope="col"
                className={`font-semibold ${
                  index === 0 ? 'w-12 py-2.5 pl-4 pr-2 sm:w-16 sm:pl-6' : index === columns.length - 1 ? 'w-14 py-2.5 pr-4 text-right sm:pr-6' : 'py-2.5 pr-3'
                } ${column.className ?? ''}`}
              >
                {column.label}
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
  return <tr className="border-b border-line/60 last:border-0">{children}</tr>;
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

/** P2, P1, P3 left to right on a desktop, the way a podium stands. */
const ORDER: Record<number, string> = { 1: 'sm:order-2', 2: 'sm:order-1', 3: 'sm:order-3' };

export function TopThree({ places, label, leadLabel }: { places: Place[]; label: string; leadLabel: ReactNode }) {
  return (
    <ol
      aria-label={label}
      className="grid divide-y divide-line border-b border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0"
    >
      {places.map((place) => {
        const lead = place.position === 1;
        return (
          // A row on a phone, number beside the name; a column on a desktop.
          <li
            key={place.code ?? place.title}
            className={`grid grid-cols-[3rem_1fr] items-center gap-x-3 px-5 py-4 sm:flex sm:flex-col sm:items-stretch sm:px-6 sm:py-6 ${
              ORDER[place.position] ?? ''
            }`}
          >
            <span className="col-start-2 flex h-4 items-center gap-1.5 text-eyebrow font-semibold uppercase text-muted empty:hidden sm:empty:flex">
              {lead ? leadLabel : null}
            </span>
            <span
              className={`tabular row-span-4 row-start-1 font-heading text-5xl font-light leading-none sm:mt-1 sm:text-6xl ${
                lead ? 'text-foreground' : 'text-subtle'
              }`}
            >
              {place.position}
            </span>
            <span className="col-start-2 sm:mt-5">
              <Entrant code={place.code} name={place.title} color={place.color} mark={place.mark} large />
            </span>
            {place.subtitle ? (
              <span className="col-start-2 mt-0.5 pl-[11px] text-sm text-muted">{place.subtitle}</span>
            ) : null}
            <span className="col-start-2 mt-2 flex items-baseline gap-3 pl-[11px] text-sm sm:mt-4">
              <span className="tabular font-semibold">{place.stat}</span>
              {place.note ? <span className="text-muted">{place.note}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

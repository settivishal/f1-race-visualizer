'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Entrant, ShareBar, teamWash } from '@/components/ui/results-table';

/** One driver's panel, already reduced to what it shows. */
export type GaragePanel = {
  id: string;
  code: string;
  name: string;
  country: string | null;
  numeral: number | null;
  /** The championship leader's numeral is lit, as in the standings. */
  lit: boolean;
  points: number | null;
  note: string[];
};

export type Garage = {
  key: string;
  team: { name: string; color: string | null } | null;
  standing: { position: number; points: number } | null;
  /** The team's years in the archive, for the all-seasons view. */
  span: string | null;
  share: number;
  panels: GaragePanel[];
};

/**
 * The grid, filtered as you type. The ⌘K palette jumps to one driver; this
 * narrows the page, so a name you half remember still finds its garage.
 */
export function DriverGarages({ garages }: { garages: Garage[] }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = garages
    .map((garage) => ({
      ...garage,
      panels: garage.panels.filter((panel) =>
        q === '' ||
        [panel.name, panel.code, panel.country ?? '', garage.team?.name ?? ''].some((text) =>
          text.toLowerCase().includes(q),
        ),
      ),
    }))
    .filter((garage) => garage.panels.length > 0);

  return (
    <>
      <div className="mt-6 max-w-xs">
        <Input
          label="Find a driver"
          type="search"
          placeholder="Name, code, country or team"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {shown.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No driver matches “{query.trim()}”.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {shown.map((garage) => (
            <li key={garage.key}>
              <GarageCard garage={garage} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function GarageCard({ garage }: { garage: Garage }) {
  const color = garage.team?.color ?? null;
  const header = (
    <>
      <Entrant name={garage.team?.name ?? 'Entered'} color={color} large />
      {garage.standing ? (
        <>
          <span className="tabular mt-1 block pl-[11px] text-sm text-muted">
            P{garage.standing.position} · {garage.standing.points} pts
          </span>
          <span className="mt-3 block pl-[11px]">
            <ShareBar share={garage.share} color={color} />
          </span>
        </>
      ) : garage.span ? (
        <span className="tabular mt-1 block pl-[11px] text-sm text-muted">{garage.span}</span>
      ) : null}
    </>
  );

  return (
    <Card flush className="overflow-hidden md:flex"
      style={garage.team ? teamWash(color, garage.standing?.position === 1) : undefined}
    >
      {garage.team ? (
        <Link
          href={`/teams/${encodeURIComponent(garage.team.name)}`}
          className="block shrink-0 border-b border-line/60 p-4 transition-colors hover:bg-panel-strong/50 sm:p-5 md:w-60 md:border-r md:border-b-0"
        >
          {header}
        </Link>
      ) : (
        <div className="shrink-0 border-b border-line/60 p-4 sm:p-5 md:w-60 md:border-r md:border-b-0">{header}</div>
      )}
      <ul className="grid flex-1 grid-cols-2 [&>li:nth-child(even)]:border-l [&>li:nth-child(n+3)]:border-t [&>li]:border-line/60">
        {garage.panels.map((panel) => (
          <li key={panel.id}>
            <Link
              href={`/drivers/${panel.code.toLowerCase()}`}
              className="flex h-full flex-col justify-between gap-3 p-4 transition-colors hover:bg-panel-strong/50 sm:p-5"
            >
              <span className="flex items-start justify-between gap-3">
                <span
                  className={`tabular font-heading text-3xl font-light leading-none sm:text-4xl ${
                    panel.lit ? 'text-foreground' : 'text-subtle'
                  }`}
                >
                  {panel.numeral}
                </span>
                {panel.points !== null ? (
                  <span className="text-right">
                    <span className="tabular block font-heading text-lg font-semibold leading-none sm:text-xl">
                      {panel.points}
                      <span className="ml-1 text-xs font-medium text-muted sm:text-sm">pts</span>
                    </span>
                    {panel.note.length > 0 ? (
                      // Each part stays whole, so a narrow panel breaks between
                      // "2018–26" and "44 wins", never inside them.
                      <span className="tabular mt-1 block text-xs text-muted">
                        {panel.note.map((part, i) => (
                          <span key={part} className="whitespace-nowrap">{i > 0 ? ` · ${part}` : part}</span>
                        ))}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </span>
              <span className="block min-w-0">
                {/* Two panels share a phone's width, so there the code leads and
                    the name wraps under it rather than being cut off. */}
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-sm font-semibold text-foreground sm:text-muted">{panel.code}</span>
                  <span className="hidden truncate font-medium sm:inline">{panel.name}</span>
                </span>
                <span className="mt-0.5 block text-xs text-muted sm:hidden">{panel.name}</span>
                {panel.country ? (
                  <span className="mt-0.5 hidden truncate text-xs text-subtle sm:block">{panel.country}</span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

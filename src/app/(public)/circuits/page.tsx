import { Suspense } from 'react';
import Link from 'next/link';
import { TeamCode } from '@/components/race/circuit-info-panel';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { getActiveSeason, getArchiveIndex } from '@/lib/queries';
import { seasonFilter, type SearchParams } from '@/lib/search-params';

export const metadata = {
  title: 'Circuits',
  description: 'Every circuit that has held a race in the archive.',
};

export default function CircuitsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageContainer>
      <SectionHeader
        eyebrow="Archive"
        title="Circuits"
        description="Every circuit that has held one of the races imported here — including the ones the current calendar has left behind."
      />
      <div className="mt-8">
        <Suspense fallback={<Skeleton className="h-[48rem] w-full rounded-xl" />}>
          <CircuitGrid searchParams={searchParams} />
        </Suspense>
      </div>
    </PageContainer>
  );
}

async function CircuitGrid({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const season = await seasonFilter(params.season, getActiveSeason);

  const [{ circuits, seasons }, activeSeason] = await Promise.all([getArchiveIndex(season), getActiveSeason()]);

  if (circuits.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState
          title={season === null ? 'Nothing imported yet' : `No circuits in ${season}`}
          description={
            season === null
              ? 'Import a season and they appear here.'
              : 'That season has not been imported, or nothing has been matched to it yet.'
          }
        />
      </div>
    );
  }

  const years = seasons.map((entry) => entry.year).sort((a, b) => a - b);
  // A phone has room for six seasons beside the names; the older ones join from sm up.
  const phoneFrom = years.length - 6;

  // The calendar in date order; everything else by when it was last raced,
  // and the circuits with no race linked at all after that.
  const thisSeason = (circuit: IndexCircuit) => circuit.races.find((race) => race.meeting?.season === activeSeason);
  const calendar = circuits
    .filter((circuit) => thisSeason(circuit))
    .sort((a, b) => thisSeason(a)!.date.localeCompare(thisSeason(b)!.date));
  const offCalendar = circuits
    .filter((circuit) => !thisSeason(circuit))
    .sort((a, b) => (b.races[0]?.date ?? '').localeCompare(a.races[0]?.date ?? ''));

  return (
    <>
      <p className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-muted" /> Won, in the winner&rsquo;s colour
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full border border-muted" /> Still to run
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="text-subtle">·</span> Not held
        </span>
      </p>
      <Card flush className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Grands prix held at each circuit, by season</caption>
          <thead>
            <tr className="border-b border-line text-eyebrow uppercase text-muted">
              <th scope="col" className="py-2.5 pr-3 pl-4 font-semibold sm:pl-6">
                Circuit
              </th>
              <th scope="col" className="hidden w-28 py-2.5 pr-3 font-semibold md:table-cell">
                Most wins
              </th>
              {years.map((year, index) => (
                <th
                  key={year}
                  scope="col"
                  className={`tabular w-8 py-2.5 text-center font-semibold sm:w-9 ${
                    index < phoneFrom ? 'hidden sm:table-cell' : ''
                  }`}
                >
                  <span aria-hidden>’{String(year).slice(2)}</span>
                  <span className="sr-only">{year}</span>
                </th>
              ))}
              <th scope="col" className="hidden w-24 py-2.5 pr-6 pl-3 text-right font-semibold sm:table-cell">
                Next
              </th>
            </tr>
          </thead>
          <tbody>
            {calendar.map((circuit) => (
              <CircuitRow key={circuit.id} circuit={circuit} years={years} phoneFrom={phoneFrom} activeSeason={activeSeason} />
            ))}
            {offCalendar.length > 0 ? (
              <tr className="border-b border-line/60">
                <th
                  scope="rowgroup"
                  colSpan={years.length + 3}
                  className="bg-panel-strong/40 py-2 pl-4 text-left text-eyebrow font-semibold uppercase text-muted sm:pl-6"
                >
                  Off the calendar
                </th>
              </tr>
            ) : null}
            {offCalendar.map((circuit) => (
              <CircuitRow key={circuit.id} circuit={circuit} years={years} phoneFrom={phoneFrom} activeSeason={activeSeason} />
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

type IndexCircuit = Awaited<ReturnType<typeof getArchiveIndex>>['circuits'][number];

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function CircuitRow({
  circuit,
  years,
  phoneFrom,
  activeSeason,
}: {
  circuit: IndexCircuit;
  years: number[];
  phoneFrom: number;
  activeSeason: number;
}) {
  // 2020 ran twice at a few circuits (Austria, Silverstone, Bahrain), so a
  // season holds a list, oldest first.
  const bySeason = new Map<number | undefined, IndexCircuit['races']>();
  for (const race of [...circuit.races].reverse()) {
    bySeason.set(race.meeting?.season, [...(bySeason.get(race.meeting?.season) ?? []), race]);
  }
  const next = bySeason.get(activeSeason)?.find((race) => race.status !== 'COMPLETED');
  const king = mostWins(circuit.races);

  return (
    // The name's link stretches over the whole row; the season dots sit above
    // it (z-10) so each still opens its own race. A link inside a link is not
    // allowed, so this is how a row is one target and many.
    <tr className="relative border-b border-line/60 transition-colors last:border-0 hover:bg-panel-strong/50">
      <th scope="row" className="max-w-36 py-2 pr-3 pl-4 font-normal sm:max-w-none sm:pl-6">
        <Link
          href={`/circuits/${circuit.ergastId}`}
          className="block truncate font-medium after:absolute after:inset-0 after:content-[''] hover:text-accent"
        >
          {circuit.name}
        </Link>
        <span className="block truncate text-xs text-muted">
          {[circuit.locality, circuit.country].filter(Boolean).join(', ')}
        </span>
      </th>
      <td className="hidden py-2 pr-3 md:table-cell">
        {king ? (
          <span className="flex items-center gap-1.5">
            <TeamCode code={king.code} teamColor={king.teamColor} />
            <span className="tabular text-xs text-muted">×{king.wins}</span>
          </span>
        ) : (
          <span className="text-subtle">·</span>
        )}
      </td>
      {years.map((year, index) => {
        const held = bySeason.get(year) ?? [];
        return (
          <td
            key={year}
            className={`py-2 text-center whitespace-nowrap ${index < phoneFrom ? 'hidden sm:table-cell' : ''}`}
          >
            {held.length === 0 ? (
              <span className="text-subtle" aria-label={`${year}: not held`}>
                ·
              </span>
            ) : (
              held.map((race) => {
                const winner = race.status === 'COMPLETED' ? race.podium[0] : undefined;
                const tint = winner?.teamColor ?? 'var(--muted)';
                const label = winner ? `${year}: won by ${winner.code}` : `${year}: ${shortDate(race.date)}`;
                return (
                  <Link
                    key={race.slug}
                    href={`/races/${race.slug}`}
                    title={label}
                    className={`relative z-10 inline-flex items-center justify-center rounded-full hover:bg-panel-strong ${
                      held.length > 1 ? 'size-4' : 'size-6'
                    }`}
                  >
                    <span
                      aria-hidden
                      className="size-2.5 rounded-full border"
                      style={winner ? { backgroundColor: tint, borderColor: tint } : { borderColor: tint }}
                    />
                    <span className="sr-only">{label}</span>
                  </Link>
                );
              })
            )}
          </td>
        );
      })}
      <td className="tabular hidden py-2 pr-6 pl-3 text-right text-xs text-muted sm:table-cell">
        {next ? shortDate(next.date) : null}
      </td>
    </tr>
  );
}

/**
 * Whoever has won here most, if anyone has won twice; a tie goes to the more
 * recent winner. Races come newest first, so the first to reach the top count
 * is the most recent, and their colour is from their latest win here.
 */
function mostWins(races: IndexCircuit['races']) {
  const tally = new Map<string, { code: string; teamColor: string | null; wins: number }>();
  for (const race of races) {
    const winner = race.status === 'COMPLETED' ? race.podium[0] : undefined;
    if (!winner) continue;
    const entry = tally.get(winner.code) ?? { code: winner.code, teamColor: winner.teamColor ?? null, wins: 0 };
    entry.wins += 1;
    tally.set(winner.code, entry);
  }
  let best: { code: string; teamColor: string | null; wins: number } | null = null;
  for (const entry of tally.values()) if (!best || entry.wins > best.wins) best = entry;
  return best && best.wins >= 2 ? best : null;
}

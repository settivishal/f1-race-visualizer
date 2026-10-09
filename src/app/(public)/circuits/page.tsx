import { Suspense } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { TeamCode } from '@/components/race/circuit-info-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { GridSkeleton } from '@/components/ui/skeleton';
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
        <Suspense fallback={<GridSkeleton count={6} itemClassName="h-44" />}>
          <CircuitGrid searchParams={searchParams} />
        </Suspense>
      </div>
    </PageContainer>
  );
}

async function CircuitGrid({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const season = await seasonFilter(params.season, getActiveSeason);

  const [{ circuits }, activeSeason] = await Promise.all([getArchiveIndex(season), getActiveSeason()]);

  if (circuits.length === 0) {
    return (
      <>
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
      </>
    );
  }

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
    <div className="space-y-12">
      <CircuitSection title={`On the ${activeSeason} calendar`} circuits={calendar} activeSeason={activeSeason} />
      <CircuitSection title="Off the calendar" circuits={offCalendar} activeSeason={activeSeason} />
    </div>
  );
}

type IndexCircuit = Awaited<ReturnType<typeof getArchiveIndex>>['circuits'][number];

function CircuitSection({
  title,
  circuits,
  activeSeason,
}: {
  title: string;
  circuits: IndexCircuit[];
  activeSeason: number;
}) {
  if (circuits.length === 0) return null;
  return (
    <section>
      <h2 className="type-section-title">{title}</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {circuits.map((circuit) => (
          <li key={circuit.id}>
            <Link href={`/circuits/${circuit.ergastId}`} className="block h-full rounded-xl">
              <CircuitCard circuit={circuit} activeSeason={activeSeason} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CircuitCard({ circuit, activeSeason }: { circuit: IndexCircuit; activeSeason: number }) {
  const held = circuit.races.filter((race) => race.status === 'COMPLETED');
  const winner = held.find((race) => race.podium[0]);
  const next = circuit.races.find((race) => race.meeting?.season === activeSeason);
  const years = held.map((race) => race.meeting?.season).filter((year) => year != null);
  const facts = [
    circuit.lengthKm != null ? `${circuit.lengthKm} km` : null,
    circuit.turns != null ? `${circuit.turns} turns` : null,
    circuit.firstGrandPrix != null ? `First GP ${circuit.firstGrandPrix}` : null,
  ].filter(Boolean);

  return (
    <Card interactive className="flex h-full flex-col">
      <span className="mb-4 block">
        <span className="flex items-start justify-between gap-3">
          <span className="text-eyebrow font-semibold uppercase text-muted">{circuit.country ?? '\u00a0'}</span>
          {next ? (
            <span className="tabular shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-muted">
              {next.status === 'COMPLETED'
                ? 'Raced'
                : new Date(next.date).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  timeZone: 'UTC',
                })}
            </span>
          ) : null}
        </span>
        <span className="mt-1 block font-medium">{circuit.name}</span>
        <span className="block text-sm text-muted">{circuit.locality ?? '\u00a0'}</span>
        {facts.length > 0 ? <span className="tabular mt-2 block text-xs text-subtle">{facts.join(' · ')}</span> : null}
      </span>
      <span className="mt-auto flex items-center justify-between gap-3 border-t border-line/60 pt-3 text-sm">
        {winner ? (
          <span className="flex items-center gap-2 text-muted">
            <TeamCode code={winner.podium[0].code} teamColor={winner.podium[0].teamColor ?? null} />
            <span className="text-xs">won {winner.meeting?.season}</span>
          </span>
        ) : (
          <span className="text-muted">No winner yet</span>
        )}
        <span className="tabular text-xs text-subtle">
          {held.length} {held.length === 1 ? 'race' : 'races'}
          {years.length > 1 ? ` · ${Math.min(...years)}–${Math.max(...years)}` : ''}
        </span>
      </span>
    </Card>
  );
}

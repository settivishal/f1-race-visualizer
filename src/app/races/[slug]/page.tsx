import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PageContainer } from '@/components/ui/page-container';
import { getRaceHeader, getRaceSlugs } from '@/lib/queries';

/**
 * The race detail page.
 *
 * The replay player lands in the next PR; what is here now is the header and
 * the classification, which is what the page needs to be a real destination
 * rather than a placeholder. The player will slot in below the header and read
 * a separate cached query, so the classification does not wait on a season of
 * lap rows.
 */
export async function generateStaticParams() {
  const { races } = await getRaceSlugs();
  return races.edges.map(({ node }) => ({ slug: node.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { race } = await getRaceHeader(slug);

  if (!race) return { title: 'Race not found — F1 Race Visualizer' };

  const name = race.meeting?.name ?? race.slug;
  return {
    title: `${name} — F1 Race Visualizer`,
    description: `Lap-by-lap replay of the ${race.meeting?.season ?? ''} ${name}.`.trim(),
  };
}

const STATUS_LABEL: Record<string, string> = {
  FINISHED: '',
  DNF: 'DNF',
  DNS: 'DNS',
  DSQ: 'DSQ',
};

export default async function RacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { race } = await getRaceHeader(slug);

  if (!race) notFound();

  const meeting = race.meeting;
  const classified = [...race.results].sort((a, b) => {
    // A DNF has no finishing position, so it sorts after everyone who has one
    // rather than to the front on a null.
    if (a.finalPosition === null) return b.finalPosition === null ? 0 : 1;
    if (b.finalPosition === null) return -1;
    return a.finalPosition - b.finalPosition;
  });

  return (
    <PageContainer>
      <Link
        href="/races"
        className="text-xs font-semibold uppercase tracking-[0.18em] text-muted transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        ← All races
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            {meeting ? `${meeting.season} · Round ${meeting.round}` : 'Season unknown'}
          </p>
          <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">
            {meeting?.name ?? race.slug}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {meeting?.circuitName ?? meeting?.country ?? '—'} · {race.laps} laps
            {meeting?.weather ? ` · ${meeting.weather}` : ''}
          </p>
        </div>
        {race.type === 'SPRINT' ? <Badge>Sprint</Badge> : null}
      </header>

      <Card className="mt-8 overflow-x-auto">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
          Classification
        </h2>
        <table className="mt-4 w-full min-w-[32rem] text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.12em] text-muted">
            <tr>
              <th scope="col" className="py-2 pr-3 font-semibold">Pos</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Driver</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Team</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Laps</th>
              <th scope="col" className="py-2 text-right font-semibold">Points</th>
            </tr>
          </thead>
          <tbody>
            {classified.map((result, index) => (
              <tr
                key={result.driver?.code ?? `row-${index}`}
                className="border-t border-line"
              >
                <td className="py-2 pr-3 font-mono">
                  {result.finalPosition ?? STATUS_LABEL[result.status] ?? '—'}
                </td>
                <td className="py-2 pr-3">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-4 w-1 rounded"
                      style={{ backgroundColor: result.team?.color ?? '#888888' }}
                      aria-hidden
                    />
                    <span className="font-mono">{result.driver?.code ?? '—'}</span>
                    <span>{result.driver?.name ?? 'Unknown driver'}</span>
                    {result.fastestLap ? (
                      <span className="text-xs font-semibold text-accent">FL</span>
                    ) : null}
                  </span>
                </td>
                <td className="py-2 pr-3 text-muted">{result.team?.name ?? '—'}</td>
                <td className="py-2 pr-3 text-right font-mono">{result.lapsCompleted}</td>
                <td className="py-2 text-right font-mono">{result.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </PageContainer>
  );
}

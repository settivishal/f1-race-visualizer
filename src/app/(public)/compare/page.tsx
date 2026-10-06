import { Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs } from '@/components/ui/tabs';
import { getArchiveIndex, getDriverProfile, getTeamProfile } from '@/lib/queries';

/**
 * Two drivers or two teams, over one season or over everything imported.
 *
 * There is no `compare` resolver and there should not be: a comparison is two
 * profiles side by side, and both profile queries already exist and are already
 * cached. Adding a field that fetches two of something the schema can fetch one
 * of would buy a round trip that `Promise.all` already saves.
 *
 * The picker is a plain GET form. No client component, no state — the URL *is*
 * the state, which is what makes a comparison shareable, and the browser
 * submits a form without help.
 */

export const metadata = {
  title: 'Compare',
  description: 'Compare two drivers or two constructors over a season or the whole archive.',
};

type Search = { kind?: string; a?: string; b?: string; season?: string };

type Totals = {
  starts: number;
  wins: number;
  podiums: number;
  points: number;
  bestFinish: number | null;
  seasonCount: number;
};

type Side = { label: string; sub: string | null; color: string | null; totals: Totals } | null;

export default function ComparePage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <PageContainer>
      <div className="mt-5">
        <SectionHeader
          eyebrow="Head to head"
          title="Compare"
          description="Two drivers or two constructors, over one season or every season in the archive."
        />
      </div>

      <Suspense fallback={<Skeleton className="mt-8 h-64 w-full" />}>
        <CompareBody searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function CompareBody({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const kind = params.kind === 'team' ? 'team' : 'driver';
  const season = params.season && /^\d{4}$/.test(params.season) ? Number(params.season) : null;

  const index = await getArchiveIndex();
  const [a, b] = await Promise.all([
    loadSide(kind, params.a, season),
    loadSide(kind, params.b, season),
  ]);

  return (
    <>
      <Card className="mt-8">
        {/* No AutoSubmit here, deliberately: a comparison needs two sides, so
            applying on every change would navigate twice on the way to one
            answer — once through a half-picked pair. The button stays. */}
        {/* Links, not a select: the name lists below depend on the kind, and a
            select only changes them after a submit, which sent driver codes as
            team names. A link reloads with the right lists and drops the picks. */}
        <Tabs
          label="Compare"
          active={kind}
          tabs={[
            { id: 'driver', label: 'Drivers', href: kindHref('driver', season) },
            { id: 'team', label: 'Constructors', href: kindHref('team', season) },
          ]}
        />
        <form className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <input type="hidden" name="kind" value={kind} />

          {(['a', 'b'] as const).map((slot) => (
            <Picker
              key={slot}
              label={slot === 'a' ? 'First' : 'Second'}
              name={slot}
              value={params[slot] ?? ''}
            >
              <option value="">Choose…</option>
              {kind === 'driver'
                ? index.drivers.map((driver) => (
                    <option key={driver.id} value={driver.code}>{driver.name}</option>
                  ))
                : index.teams.map((team) => (
                    <option key={team.id} value={team.name}>{team.name}</option>
                  ))}
            </Picker>
          ))}

          <Picker label="Season" name="season" value={season === null ? '' : String(season)}>
            <option value="">All seasons</option>
            {[...index.seasons].reverse().map((entry) => (
              <option key={entry.year} value={entry.year}>{entry.year}</option>
            ))}
          </Picker>

          <Button type="submit">Compare</Button>
        </form>
      </Card>

      {a && b ? (
        <ComparisonTable a={a} b={b} season={season} />
      ) : (
        <div className="mt-6">
          <EmptyState
            title="Pick two to compare"
            description={
              season === null
                ? 'Choose a driver or constructor on each side.'
                : `Choose two that both raced in ${season}.`
            }
          />
        </div>
      )}
    </>
  );
}

const kindHref = (kind: 'driver' | 'team', season: number | null) =>
  `/compare?kind=${kind}${season === null ? '' : `&season=${season}`}`;

async function loadSide(
  kind: 'driver' | 'team',
  key: string | undefined,
  season: number | null,
): Promise<Side> {
  if (!key) return null;

  if (kind === 'driver') {
    const { driver } = await getDriverProfile(key);
    if (!driver) return null;
    const rows = filterSeasons(driver.career.seasons, season);
    if (rows.length === 0) return null;
    return {
      label: driver.driver.name,
      // Whoever they drove for in the newest season on show — the rows arrive
      // newest first, and a mid-season switch keeps both, so this names the
      // team they ended with.
      sub: rows[0].team?.name ?? driver.driver.country,
      color: rows[0].team?.color ?? null,
      totals: total(rows),
    };
  }

  const { team } = await getTeamProfile(key);
  if (!team) return null;
  const rows = filterSeasons(team.career.seasons, season);
  if (rows.length === 0) return null;
  return {
    label: team.team.name,
    sub: null,
    color: team.team.color,
    totals: total(rows),
  };
}

type SeasonRow = {
  season: number;
  starts: number;
  wins: number;
  podiums: number;
  points: number;
  bestFinish: number | null;
  team?: { name: string; color: string | null } | null;
};

const filterSeasons = <T extends SeasonRow>(rows: readonly T[], season: number | null) =>
  season === null ? [...rows] : rows.filter((row) => row.season === season);

/**
 * Summed here rather than read off `career`, because a season filter means the
 * schema's totals are the wrong ones — they cover every season. The seasons a
 * driver split between two teams contribute a row each, which is why
 * `seasonCount` counts distinct years and not rows.
 */
function total(rows: SeasonRow[]): Totals {
  const finishes = rows.map((row) => row.bestFinish).filter((p): p is number => p !== null);
  return {
    starts: rows.reduce((n, row) => n + row.starts, 0),
    wins: rows.reduce((n, row) => n + row.wins, 0),
    podiums: rows.reduce((n, row) => n + row.podiums, 0),
    points: rows.reduce((n, row) => n + row.points, 0),
    bestFinish: finishes.length > 0 ? Math.min(...finishes) : null,
    seasonCount: new Set(rows.map((row) => row.season)).size,
  };
}

function Picker({
  label,
  name,
  value,
  children,
}: {
  label: string;
  name: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-eyebrow font-semibold uppercase text-muted">{label}</span>
      {/* Uncontrolled: `defaultValue` lets the browser own the field, which is
          what keeps this a server component. */}
      <select
        name={name}
        defaultValue={value}
        className="h-10 w-full rounded-md border border-line bg-panel px-3 text-sm text-foreground hover:border-line-strong"
      >
        {children}
      </select>
    </label>
  );
}

const METRICS = [
  { label: 'Seasons', key: 'seasonCount', better: 'high' },
  { label: 'Starts', key: 'starts', better: 'high' },
  { label: 'Wins', key: 'wins', better: 'high' },
  { label: 'Podiums', key: 'podiums', better: 'high' },
  { label: 'Points', key: 'points', better: 'high' },
  { label: 'Best finish', key: 'bestFinish', better: 'low' },
] as const;

function ComparisonTable({ a, b, season }: { a: NonNullable<Side>; b: NonNullable<Side>; season: number | null }) {
  return (
    <Card className="mt-6 overflow-x-auto p-0">
      <table className="w-full min-w-[30rem] text-sm">
        <caption className="sr-only">
          {a.label} compared with {b.label}
          {season === null ? ', all seasons' : ` in ${season}`}
        </caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="w-1/3 px-5 py-4 text-left text-eyebrow font-semibold uppercase text-muted">
              {season === null ? 'All seasons' : season}
            </th>
            <SideHeader side={a} />
            <SideHeader side={b} />
          </tr>
        </thead>
        <tbody>
          {METRICS.map((metric) => {
            const left = a.totals[metric.key];
            const right = b.totals[metric.key];
            return (
              <tr key={metric.key} className="border-b border-line/60 last:border-0">
                <th scope="row" className="px-5 py-3 text-left font-medium text-muted">{metric.label}</th>
                <Cell value={left} won={wins(left, right, metric.better)} isPosition={metric.key === 'bestFinish'} />
                <Cell value={right} won={wins(right, left, metric.better)} isPosition={metric.key === 'bestFinish'} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

// A missing best finish loses to any real one: never having finished a race is
// not an achievement, and two nulls tie rather than both winning.
function wins(mine: number | null, theirs: number | null, better: 'high' | 'low') {
  if (mine === null) return false;
  if (theirs === null) return true;
  return better === 'high' ? mine > theirs : mine < theirs;
}

function SideHeader({ side }: { side: NonNullable<Side> }) {
  return (
    <th scope="col" className="px-5 py-4 text-left">
      <span className="flex items-center gap-2.5">
        <span
          className="h-5 w-1 shrink-0 rounded-full"
          style={{ backgroundColor: side.color ?? 'var(--muted)' }}
          aria-hidden
        />
        <span>
          <span className="block font-heading text-base font-bold tracking-tight">{side.label}</span>
          {side.sub ? <span className="block text-xs font-normal text-muted">{side.sub}</span> : null}
        </span>
      </span>
    </th>
  );
}

function Cell({ value, won, isPosition }: { value: number | null; won: boolean; isPosition: boolean }) {
  const text = value === null ? '—' : isPosition ? `P${value}` : String(value);
  return (
    <td className={`tabular px-5 py-3 text-lg ${won ? 'font-bold text-foreground' : 'text-muted'}`}>
      {text}
      {/* The bold number already carries it visually; this is the same fact for
          a screen reader, which cannot see a font weight. */}
      {won ? <span className="sr-only"> (ahead)</span> : null}
    </td>
  );
}

import Form from 'next/form';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { HeadToHead } from '@/components/analysis/head-to-head';
import { getHeadToHead, getRaceHeader } from '@/lib/queries';

/**
 * The picker and the comparison.
 *
 * A plain GET form, as everywhere else the site lets someone choose something:
 * the URL is the state, which keeps this a server component and makes a
 * particular comparison a link someone can send.
 *
 * The picker opens on the top two finishers, but it does not *fetch* them: the
 * comparison is rendered only once the reader has asked for one, which is what
 * `a` and `b` in the URL mean.
 *
 * That is a cost decision. `getHeadToHead` is its own cache scope keyed by the
 * pair, so a default comparison is a second, independent miss — and each miss
 * re-runs `loadAnalysis`, the full-race scan over positions, stints, pit stops
 * and results. Opening the Analysis tab was paying for that race twice, the
 * second time for a comparison nobody had asked for.
 *
 * It also matches the picker beside it: two selects and a Compare button say a
 * comparison needs two choices, which is why AutoSubmit was taken off this form.
 */
export async function HeadToHeadSection({
  slug,
  driverA,
  driverB,
}: {
  slug: string;
  driverA: string | null;
  driverB: string | null;
}) {
  // The driver list comes from the header, which the page has already fetched
  // and cached — asking the head-to-head query for it first would mean two
  // round trips to learn who is even in the race.
  const { race: header } = await getRaceHeader(slug);
  if (!header) return null;

  const classified = [...header.results]
    .filter((row) => row.finalPosition !== null && row.driver !== null)
    .sort((a, b) => (a.finalPosition ?? 0) - (b.finalPosition ?? 0));

  if (classified.length < 2) {
    return (
      <EmptyState
        title="Nothing to compare"
        description="This race has fewer than two classified finishers on record."
      />
    );
  }

  const codeA = driverA ?? classified[0].driver!.code;
  const codeB = driverB ?? classified[1].driver!.code;

  // Only when the reader has picked. Both come from the same submit, so one
  // present and the other missing is not a state the form can produce.
  const asked = driverA !== null && driverB !== null;
  const comparison = asked
    ? (await getHeadToHead(slug, codeA, codeB)).race?.analysis.headToHead ?? null
    : null;

  return (
    <div className="space-y-5">
      {/* next/form rather than a bare <form>: a plain GET submit is a document
          navigation, which lands the reader at the top of a long race page
          having lost sight of the thing they just changed. This navigates on
          the client and `scroll={false}` leaves the page where it was. Still a
          GET to the same URL, so it degrades to the native form without JS. */}
      <Form action={`/races/${slug}`} scroll={false} className="flex flex-wrap items-end gap-3">
        {/* The tab lives in the query string too, so choosing a driver must not
            navigate away from the Analysis view. */}
        <input type="hidden" name="view" value="analysis" />
        <Picker label="Driver" name="a" value={codeA} drivers={classified} />
        <Picker label="Against" name="b" value={codeB} drivers={classified} />
        <Button type="submit" variant="secondary">
          Compare
        </Button>
      </Form>

      {comparison ? (
        <HeadToHead data={comparison} />
      ) : (
        <EmptyState
          title={asked ? 'Pick two different drivers' : 'Choose two drivers'}
          description={
            !asked
              ? 'Pick a pair and press Compare to see who was in front, lap by lap.'
              : codeA === codeB
                ? 'A driver is not much of a rival to themselves.'
                : 'At least one of them did not start this race.'
          }
        />
      )}
    </div>
  );
}

function Picker({
  label,
  name,
  value,
  drivers,
}: {
  label: string;
  name: string;
  value: string;
  drivers: { finalPosition: number | null; driver: { code: string; name: string } | null }[];
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-eyebrow font-semibold uppercase text-muted">{label}</span>
      <select
        name={name}
        defaultValue={value}
        className="h-10 rounded-md border border-line bg-panel px-3 text-sm text-foreground hover:border-line-strong"
      >
        {drivers.map((row) => (
          <option key={row.driver!.code} value={row.driver!.code}>
            P{row.finalPosition} · {row.driver!.name}
          </option>
        ))}
      </select>
    </label>
  );
}

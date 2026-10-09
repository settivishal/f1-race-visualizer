import { Suspense } from 'react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { executeAsAdmin } from '@/graphql/execute';
import { AdminIngestRunsDocument } from '@/graphql/generated/graphql';

export const metadata = {
  title: 'Ingest runs — Admin',
  robots: { index: false, follow: false },
};

/**
 * The ingest history.
 *
 * This page is the reason there is no Sentry in this project. The failure that
 * actually matters here is not an exception — it is a cron job that quietly
 * stopped running, which throws nothing anywhere and would page nobody. What it
 * produces is an absence: no new row in this table. So the check is "when did
 * the last run happen", and that is a thing to look at rather than be alerted
 * about.
 *
 * `error` carries warnings on a successful run as well as the message on a
 * failed one, because run.ts records both there deliberately: a run that
 * succeeded while noticing something is not the same as a clean one.
 */
export default function AdminRunsPage() {
  return (
    <PageContainer>
      <SectionHeader
        title="Ingest runs"
        description="Every import attempt, newest first. An absence of recent rows is the failure worth noticing."
      />
      <Suspense fallback={<Skeleton className="mt-8 h-96 w-full rounded-xl" />}>
        <Runs />
      </Suspense>
    </PageContainer>
  );
}

const STATUS_TONE: Record<string, string> = {
  SUCCESS: 'tone tone-green',
  FAILED: 'tone tone-red',
  RUNNING: 'tone tone-pit',
};

async function Runs() {
  const { ingestRuns } = await executeAsAdmin(AdminIngestRunsDocument, { first: 100 });

  if (ingestRuns.length === 0) {
    return (
      <div className="mt-8">
        <EmptyState
          title="No runs recorded"
          description="Nothing has imported yet. Trigger one from the races page, or wait for the cron."
        />
      </div>
    );
  }

  return (
    <Card flush className="mt-8 overflow-x-auto">
      <table className="w-full min-w-[46rem] text-left text-sm">
        <caption className="sr-only">Ingest run history</caption>
        <thead>
          <tr className="border-b border-line text-eyebrow uppercase text-muted">
            <th scope="col" className="py-3 pl-5 pr-3 font-semibold">Status</th>
            <th scope="col" className="py-3 pr-3 font-semibold">Source</th>
            <th scope="col" className="py-3 pr-3 font-semibold">Target</th>
            <th scope="col" className="py-3 pr-3 text-right font-semibold">Rows</th>
            <th scope="col" className="py-3 pr-3 font-semibold">Started</th>
            <th scope="col" className="py-3 pr-5 font-semibold">Notes</th>
          </tr>
        </thead>
        <tbody>
          {ingestRuns.map((run) => (
            <tr key={run.id} className="border-b border-line/60 align-top last:border-0">
              <td className="py-2.5 pl-5 pr-3">
                <span
                  className={`${STATUS_TONE[run.status] ?? 'tone tone-neutral'} inline-flex rounded-full border px-2.5 py-0.5 text-eyebrow font-semibold uppercase`}
                >
                  {run.status}
                </span>
              </td>
              <td className="py-2.5 pr-3 text-muted">{run.source}</td>
              <td className="tabular py-2.5 pr-3">{run.target ?? '—'}</td>
              <td className="tabular py-2.5 pr-3 text-right">{run.rowsWritten}</td>
              <td className="tabular py-2.5 pr-3 text-muted">
                {new Date(run.startedAt as string).toISOString().replace('T', ' ').slice(0, 16)}
              </td>
              <td className="max-w-md py-2.5 pr-5 text-muted">
                {run.error ? (
                  <span className="block whitespace-pre-wrap break-words text-xs">{run.error}</span>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}


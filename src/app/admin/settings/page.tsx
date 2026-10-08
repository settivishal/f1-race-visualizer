import { Suspense } from 'react';
import { ActionForm } from '@/components/admin/action-form';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { connection } from 'next/server';
import { getDb } from '@/db';
import { readAppConfig } from '@/lib/app-config';
import { updateConfigAction } from './actions';

export const metadata = {
  title: 'Settings — Admin',
  robots: { index: false, follow: false },
};

const WEEKDAYS = [
  ['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'],
  ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun'],
] as const;

/**
 * The cron's cadence.
 *
 * `vercel.json` fires the handler daily and cannot change without a deploy.
 * Everything about whether it then does anything lives in this one row, so the
 * schedule stays deliberately dumb and the decisions stay editable.
 */
export default function SettingsPage() {
  return (
    <PageContainer className="max-w-2xl">
      <SectionHeader
        title="Ingest settings"
        description="The schedule runs daily at 06:00 UTC. What it does when it runs is decided here."
      />
      <Suspense fallback={<Skeleton className="mt-8 h-96 w-full rounded-xl" />}>
        <SettingsForm />
      </Suspense>
    </PageContainer>
  );
}

async function SettingsForm() {
  // A request-time read, not a prerendered one: the proxy has already turned
  // away anyone without a session, and the form must show the row as it is now.
  await connection();
  const config = await readAppConfig(getDb());
  const runDays: string[] = config?.runDays ?? ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  return (
    <>
      {!config ? (
        <p role="status" className="tone tone-double-yellow mt-6 rounded-md border p-4 text-sm">
          No configuration row exists yet, so the cron is skipping every run. Saving this form
          creates it.
        </p>
      ) : null}

      <Card className="mt-6">
        <ActionForm action={updateConfigAction} className="space-y-6">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="ingestEnabled"
              defaultChecked={config?.ingestEnabled ?? true}
              className="mt-1 h-4 w-4 accent-[var(--accent)]"
            />
            <span>
              <span className="block text-sm font-semibold">Ingest enabled</span>
              <span className="block text-sm text-muted">
                Off means every run skips. Nothing else changes.
              </span>
            </span>
          </label>

          <fieldset>
            <legend className="text-eyebrow font-semibold uppercase text-muted">Run days</legend>
            <p className="mt-1 text-sm text-muted">
              Interpreted in UTC, to match the schedule. Monday is the default: a race weekend
              has finished publishing by then.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {WEEKDAYS.map(([value, label]) => (
                <label
                  key={value}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm transition-colors hover:border-line-strong"
                >
                  <input
                    type="checkbox"
                    name={`day-${value}`}
                    defaultChecked={runDays.includes(value)}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <Input
            label="Active season"
            name="activeSeason"
            inputMode="numeric"
            defaultValue={String(config?.activeSeason ?? new Date().getUTCFullYear())}
            hint="The season the cron imports from. Nothing outside it is touched."
          />

          <Input
            label="Hours after race"
            name="hoursAfterRace"
            inputMode="numeric"
            defaultValue={String(config?.hoursAfterRace ?? 12)}
            hint="How long to wait after a session ends. OpenF1 publishes progressively, and importing too early produces a partial replay that still reports success."
          />

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="text-eyebrow font-semibold uppercase text-muted">Win prediction panel</legend>
            <Input
              label="Drivers shown"
              name="predictionsShown"
              inputMode="numeric"
              defaultValue={String(config?.predictionsShown ?? 5)}
              hint="Listed on the race page before 'Show more'."
            />
            <Input
              label="Drivers when expanded"
              name="predictionsExpanded"
              inputMode="numeric"
              defaultValue={String(config?.predictionsExpanded ?? 10)}
              hint="'Show more' opens the list to this many. Equal to the above hides the button."
            />
          </fieldset>

          <div className="pt-1">
            <Button type="submit">Save settings</Button>
          </div>
        </ActionForm>
      </Card>

      <p className="mt-4 text-sm text-muted">
        One race per run, oldest missing first. A backlog drains a race a day; use{' '}
        <code className="font-mono text-xs">scripts/backfill.ts</code> for anything larger.
      </p>
    </>
  );
}

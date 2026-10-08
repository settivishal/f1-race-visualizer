import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/admin/action-form';
import { Button, buttonClasses } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { executeAsAdmin } from '@/graphql/execute';
import { AdminRaceDocument } from '@/graphql/generated/graphql';
import { sessionLabel } from '@/lib/session-title';
import { updateMetadataAction } from '../../actions';
import { BackLink } from '@/components/ui/back-link';

export const metadata = {
  title: 'Edit race — Admin',
  robots: { index: false, follow: false },
};

/**
 * Correcting what an import got wrong.
 *
 * Only the human-facing fields. Lap counts and names come from OpenF1 and are
 * occasionally odd; positions, results and events do not get hand-edited,
 * because a value typed here would be silently overwritten by the next import
 * of the same session — and an edit that disappears is worse than no edit.
 * `laps` and the meeting names survive because nothing in `transform.ts`
 * rewrites them on a re-import.
 */
export default function EditRacePage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <PageContainer className="max-w-2xl">
      <BackLink href="/admin">All races</BackLink>
      <Suspense fallback={<Skeleton className="mt-6 h-[30rem] w-full rounded-xl" />}>
        <EditForm params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function EditForm({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { race } = await executeAsAdmin(AdminRaceDocument, { slug });

  if (!race) notFound();

  const racePinned = race.adminEdited;
  const meetingPinned = race.meeting?.adminEdited ?? [];

  return (
    <div className="mt-5">
      <SectionHeader
        title={race.meeting?.name ?? race.slug}
        description={`${race.slug} · ${sessionLabel(race.type)}`}
      />

      <Card className="mt-8">
        <ActionForm action={updateMetadataAction} className="space-y-4">
          <input type="hidden" name="slug" value={race.slug} />

          <Field
            label="Meeting name"
            name="name"
            column="name"
            pinned={meetingPinned}
            defaultValue={race.meeting?.name ?? ''}
            hint="What every page shows as the title of the weekend."
          />
          <Field
            label="Country"
            name="country"
            column="country"
            pinned={meetingPinned}
            defaultValue={race.meeting?.country ?? ''}
            hint="Upstream files a relocated race under its original country — this is where that gets corrected."
          />
          <Field
            label="Circuit name"
            name="circuitName"
            column="circuit_name"
            pinned={meetingPinned}
            defaultValue={race.meeting?.circuitName ?? ''}
            hint="Leave empty to clear it — this is the one field that may be blank."
          />
          <Field
            label="Laps"
            name="laps"
            column="laps"
            pinned={racePinned}
            inputMode="numeric"
            defaultValue={String(race.laps)}
            hint="The scheduled distance. The replay derives its own lap list from the data."
          />

          <div>
            <Select
              label="Status"
              name="status"
              defaultValue={race.status}
              options={[
                { value: 'SCHEDULED', label: 'Scheduled — not yet run' },
                { value: 'COMPLETED', label: 'Completed — has a result' },
                { value: 'CANCELLED', label: 'Cancelled — did not take place' },
              ]}
            />
            <span className="mt-1.5 block text-sm text-muted">
              The ingest sets the first two from the data. Cancelled is only ever
              yours to set: no upstream publishes it.
            </span>
            <PinNote column="status" pinned={racePinned} />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit">Save</Button>
            <Link href={`/races/${race.slug}`} target="_blank" rel="noreferrer" className={buttonClasses({ variant: 'ghost' })}>
              View public page
            </Link>
          </div>
        </ActionForm>
      </Card>

      <p className="mt-4 text-sm text-muted">
        {race.openf1SessionKey
          ? `OpenF1 session ${race.openf1SessionKey}. Re-importing overwrites positions, results and events, but not these fields.`
          : 'No OpenF1 session key, so this race cannot be re-imported.'}
      </p>
    </div>
  );
}

/**
 * A field, with whether the ingest is still allowed to touch it.
 *
 * The whole point of `admin_edited` is that an import stops overwriting a
 * column once someone has set it — which means a field pinned by accident goes
 * stale silently and nothing upstream can correct it. So every pinned field
 * says so, and offers the way back.
 */
function Field({
  label,
  name,
  column,
  pinned,
  defaultValue,
  hint,
  inputMode,
}: {
  label: string;
  name: string;
  column: string;
  pinned: string[];
  defaultValue: string;
  hint?: string;
  inputMode?: 'numeric';
}) {
  return (
    <div>
      <Input
        label={label}
        name={name}
        defaultValue={defaultValue}
        hint={hint}
        inputMode={inputMode}
      />
      <PinNote column={column} pinned={pinned} />
    </div>
  );
}

function PinNote({ column, pinned }: { column: string; pinned: string[] }) {
  if (!pinned.includes(column)) return null;

  return (
    <label className="mt-1.5 flex items-center gap-2 text-sm text-muted">
      <input type="checkbox" name="release" value={column} className="accent-accent" />
      <span>
        Yours — the ingest leaves this alone. Tick to hand it back to upstream.
      </span>
    </label>
  );
}


import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { StatRow } from '@/components/archive/record-table';
import { getArchiveIndex, getCircuitProfile } from '@/lib/queries';
import { prerenderParams } from '@/lib/prerender';

export async function generateStaticParams() {
  const { circuits } = await getArchiveIndex();
  return prerenderParams(circuits.map((circuit) => ({ id: circuit.ergastId })));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { circuit } = await getCircuitProfile(id);

  if (!circuit) return { title: 'Circuit not found' };
  return {
    title: `${circuit.name}`,
    description: `Races held at ${circuit.name}.`,
  };
}

/**
 * The existence check runs here, above the Suspense boundary, and not in the
 * detail component below it.
 *
 * It used to run below, and that broke every one of these pages in production:
 * with Cache Components the shell is prerendered on its own, `notFound()` fired
 * while the shell was being generated, and so the prerendered shell *was* the
 * 404 page. Production then served that shell for a row that exists perfectly
 * well. Locally in `next dev` there is no separate shell, which is why it
 * looked fine every time.
 *
 * Awaiting the profile here costs a cache read — `generateMetadata` above
 * already awaits the same one — and makes the 404 a real 404 instead of a 200
 * that renders like one.
 */
export default async function CircuitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { circuit: exists } = await getCircuitProfile(id);

  if (!exists) notFound();

  return (
    <PageContainer>
      <Link
        href="/circuits"
        className="inline-flex rounded-sm text-eyebrow font-semibold uppercase text-muted transition-colors hover:text-foreground"
      >
        ← All circuits
      </Link>

      <Suspense fallback={<CircuitSkeleton />}>
        <CircuitDetail params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function CircuitDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { circuit } = await getCircuitProfile(id);

  if (!circuit) notFound();

  // Only what is known. The dimensions are a hand-maintained overlay and a
  // circuit nobody has filled in yet shows its name and its place, which is
  // still true, rather than an invented 5.0 km.
  const stats = [
    circuit.lengthKm != null ? { label: 'Length', value: `${circuit.lengthKm.toFixed(3)} km` } : null,
    circuit.turns != null ? { label: 'Turns', value: String(circuit.turns) } : null,
    circuit.firstGrandPrix != null
      ? { label: 'First grand prix', value: String(circuit.firstGrandPrix) }
      : null,
    circuit.latitude != null && circuit.longitude != null
      ? { label: 'Location', value: `${circuit.latitude.toFixed(2)}, ${circuit.longitude.toFixed(2)}` }
      : null,
  ].filter((stat): stat is { label: string; value: string } => stat !== null);

  return (
    <>
      <div className="mt-5">
        <SectionHeader
          eyebrow="Circuit"
          title={circuit.name}
          description={
            [circuit.locality, circuit.country].filter(Boolean).join(', ') || 'Location unknown'
          }
        />
      </div>

      {stats.length > 0 ? (
        <div className="mt-8">
          <StatRow stats={stats} />
        </div>
      ) : (
        <p className="mt-8 text-sm text-muted">
          No dimensions recorded for this circuit yet.
        </p>
      )}

      <p className="mt-8 text-sm text-muted">
        Looking for the races held here?{' '}
        <Link href={`/races?q=${encodeURIComponent(circuit.locality ?? circuit.name)}`} className="text-accent hover:underline">
          Search the race library
        </Link>
        .
      </p>
    </>
  );
}

function CircuitSkeleton() {
  return (
    <div className="mt-5">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="mt-3 h-12 w-96 max-w-full" />
      <Skeleton className="mt-3 h-5 w-48" />
      <Skeleton className="mt-8 h-24 w-full rounded-xl" />
    </div>
  );
}

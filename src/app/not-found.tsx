import Link from 'next/link';
import { buttonClasses } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageContainer } from '@/components/ui/page-container';

/**
 * The 404. Lives at the app root rather than in the (public) group because a
 * bad URL matches no group — a route that does not exist has no layout to
 * render inside, so a not-found page in the group would never be reached.
 *
 * `notFound()` in the race page lands here too, which is the common case: a
 * slug that was never ingested. The existence check is hoisted into the page
 * component now, above the Suspense boundary, so a bad slug renders this
 * instead of a half-built race page — but the status is still 200, not 404.
 * With Cache Components every dynamic route streams a static shell first, so
 * the response is committed before the page function runs; Next's own
 * `notFound` reference says a real 404 status has to come from `proxy.ts`.
 * The `noindex` tag Next injects is what keeps the soft 404 out of search.
 */
export default function NotFound() {
  return (
    <PageContainer className="py-20">
      <EmptyState
        title="Page not found"
        description="That race or page does not exist. It may never have been imported."
        action={
          <Link href="/races" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
            Browse races
          </Link>
        }
      />
    </PageContainer>
  );
}

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { headers } from 'next/headers';
import { auth, signIn } from '@/auth';
import { clientKey, consume } from '@/lib/rate-limit';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageContainer } from '@/components/ui/page-container';
import { isAdminPath } from '@/lib/admin-path';
import { Skeleton } from '@/components/ui/skeleton';
import { first, type SearchParams } from '@/lib/search-params';

export const metadata = {
  title: 'Sign in',
  // The one page on the site that should never be indexed.
  robots: { index: false, follow: false },
};

/**
 * The only unauthenticated form on the site.
 *
 * The page is deliberately not async. Reading the session means reading
 * cookies, and with Cache Components a cookie read outside a Suspense boundary
 * is a build error — the same constraint that shaped `/races` in M2, where it
 * was `searchParams`. So the heading prerenders into the static shell and only
 * the form, which genuinely depends on the request, streams in.
 *
 * See node_modules/next/dist/docs/01-app/02-guides/
 * authentication-with-cache-components.md.
 */
export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageContainer className="max-w-md py-16">
      <h1 className="type-page-title">Sign in</h1>
      <p className="mt-2 text-muted">Admin access only. There is no public account.</p>

      <Suspense fallback={<FormSkeleton />}>
        <LoginForm searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

/**
 * A Server Action rather than a client component: `signIn` runs on the server,
 * so the password never enters a client bundle's scope and there is no fetch to
 * write.
 */
// Five attempts, then one more every thirty seconds. A person who mistypes a
// password twice never meets it; a script working through a word list meets it
// immediately, and the limit is on the address rather than the email so trying
// many accounts is no cheaper than trying one.
const LOGIN_BUCKET = { capacity: 5, refillPerSecond: 1 / 30 };

async function authenticate(formData: FormData) {
  'use server';

  const target = String(formData.get('from') ?? '/admin');
  const safeTarget = isAdminPath(target) ? target : '/admin';

  if (!(await consume(clientKey(await headers(), 'login'), LOGIN_BUCKET))) {
    redirect(`/login?error=rate&from=${encodeURIComponent(safeTarget)}`);
  }

  try {
    await signIn('credentials', {
      email: formData.get('email'),
      password: formData.get('password'),
      redirectTo: safeTarget,
    });
  } catch (error) {
    // A successful signIn throws a redirect, which has to propagate. Only a
    // genuine authentication failure becomes an error state.
    if (error instanceof AuthError) {
      redirect(`/login?error=1&from=${encodeURIComponent(safeTarget)}`);
    }
    throw error;
  }
}

async function LoginForm({ searchParams }: { searchParams: SearchParams }) {
  if (await auth()) redirect('/admin');

  const params = await searchParams;
  const raw = first(params.from);
  const from = raw && isAdminPath(raw) ? raw : '/admin';
  const error = first(params.error);
  const failed = error !== undefined;

  return (
    <Card className="mt-8">
      <form action={authenticate} className="space-y-4">
        <input type="hidden" name="from" value={from} />
        <Input label="Email" name="email" type="email" autoComplete="username" required autoFocus />
        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />

        {failed ? (
          <p role="alert" className="text-sm text-flag-red">
            {error === 'rate'
              ? 'Too many attempts. Try again in a minute.'
              : // Deliberately does not say which of the two was wrong.
                'Those credentials did not match.'}
          </p>
        ) : null}

        <Button type="submit" className="w-full">
          Sign in
        </Button>
      </form>
    </Card>
  );
}

function FormSkeleton() {
  return (
    <Card className="mt-8">
      <div className="space-y-5">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </Card>
  );
}

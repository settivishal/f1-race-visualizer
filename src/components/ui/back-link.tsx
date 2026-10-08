import Link from 'next/link';

/** "← All races" above a detail page: back to the list it came from. */
export function BackLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="inline-flex rounded-sm text-eyebrow font-semibold uppercase text-muted transition-colors hover:text-foreground"
    >
      ← {children}
    </Link>
  );
}

import { cn } from "@/lib/cn";

/**
 * A placeholder built to the footprint of the thing it stands in for.
 *
 * This is what keeps the loading path from shifting the page: a fallback that
 * is shorter than its content makes the layout jump when the content streams
 * in. Callers are expected to pass real dimensions rather than accept a
 * default, which is why there isn't one.
 *
 * The pulse is a CSS animation, so the global `prefers-reduced-motion` rule in
 * globals.css stops it without this component knowing about the preference.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-line", className)}
    />
  );
}

/** An archive index's card grid, while it loads. */
export function GridSkeleton({ count, itemClassName }: { count: number; itemClassName: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cn("w-full rounded-xl", itemClassName)} />
      ))}
    </div>
  );
}

/** A driver or team profile, while it loads. */
export function ProfileSkeleton({ subtitleClassName = "w-56" }: { subtitleClassName?: string }) {
  return (
    <div className="mt-5">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-12 w-80 max-w-full" />
      <Skeleton className={cn("mt-3 h-5", subtitleClassName)} />
      <Skeleton className="mt-8 h-24 w-full rounded-xl" />
      <Skeleton className="mt-10 h-72 w-full rounded-xl" />
    </div>
  );
}

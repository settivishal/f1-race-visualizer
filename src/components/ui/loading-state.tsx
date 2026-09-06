import { Card } from "./card";

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <Card className="bg-white/60">
      <div className="flex items-center gap-4">
        <div className="h-10 w-10 animate-pulse rounded-full bg-[color:var(--color-track)]/10" />
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[color:var(--color-track)]">
            {label}
          </p>
          <p className="mt-2 text-sm text-[color:var(--color-muted)]">
            Pulling the latest state into view.
          </p>
        </div>
      </div>
    </Card>
  );
}

import { ReactNode } from "react";
import { Card } from "./card";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Card className="border-dashed bg-white/50 text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[color:var(--color-track)]">
        {title}
      </p>
      <p className="mt-3 text-sm leading-7 text-[color:var(--color-muted)]">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </Card>
  );
}

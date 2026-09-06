import { ReactNode } from "react";
import { Card } from "./card";

export function ErrorState({
  title = "Something went wrong",
  message,
  action,
}: {
  title?: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <Card className="border-[color:var(--color-accent)]/25 bg-[color:var(--color-accent)]/8">
      <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[color:var(--color-accent-strong)]">
        {title}
      </p>
      <p className="mt-3 text-sm leading-7 text-[color:var(--color-accent-strong)]">{message}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </Card>
  );
}

import { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Badge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border border-line bg-panel px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-foreground transition-[background-color,border-color] duration-220",
        className,
      )}
    >
      {children}
    </span>
  );
}

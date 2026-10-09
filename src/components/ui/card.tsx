import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * On a dark ground the border does most of the separating and the shadow only
 * lifts — heavy drop shadows read as smudges here, which is why the shadow
 * scale in globals.css is as restrained as it is.
 */
export function Card({
  children,
  className,
  interactive = false,
  style,
}: {
  children: ReactNode;
  className?: string;
  /** Adds hover and press affordances. For cards that are themselves links. */
  interactive?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-panel p-5 shadow-sm",
        interactive &&
          "transition-[background-color,border-color,transform] hover:border-line-strong hover:bg-panel-strong active:translate-y-px",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

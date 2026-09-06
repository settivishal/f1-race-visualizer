import { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[1.8rem] border border-line bg-panel p-6 shadow-md transition-[background-color,border-color] duration-220",
        className,
      )}
    >
      {children}
    </div>
  );
}

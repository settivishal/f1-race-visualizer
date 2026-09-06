import { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-[#e10600] text-white hover:bg-[#ff1e18] hover:shadow-[0_8px_20px_rgba(225,6,0,0.25)]",
  secondary:
    "border border-line bg-panel text-foreground hover:bg-panel-strong",
  ghost:
    "border border-transparent bg-transparent text-foreground hover:border-line hover:bg-panel",
  danger:
    "bg-red-600 text-white hover:bg-red-700",
};

export function Button({
  children,
  className,
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold uppercase tracking-[0.2em] transition disabled:cursor-not-allowed disabled:opacity-60",
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

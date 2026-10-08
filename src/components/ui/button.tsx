import { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

/**
 * The old version was a single heavy uppercase pill with `tracking-[0.2em]`,
 * hardcoded `#e10600`, no size range, and no focus ring. It was so specific
 * that `races/page.tsx` hand-rolled its own `<button>` rather than use it — a
 * primitive nothing reaches for is not a primitive.
 *
 * Colours now come from tokens, so the button follows the theme. Every variant
 * gets an `:active` state: pressing should feel like pressing, and a control
 * that only reacts to hover feels dead under a finger on a touchscreen, where
 * hover does not exist.
 */
const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-accent-fill text-on-accent hover:bg-accent-strong active:brightness-90",
  secondary:
    "border border-line bg-panel text-foreground hover:border-line-strong hover:bg-panel-strong active:brightness-95",
  ghost:
    "border border-transparent text-muted hover:bg-panel hover:text-foreground active:brightness-95",
  danger:
    "bg-flag-red text-on-accent hover:brightness-110 active:brightness-90",
};

const sizeClasses: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-10 gap-2 px-4 text-sm",
  lg: "h-12 gap-2 px-6 text-base",
};

/**
 * The button's look, for a link that should read as one. A `<Link>` around a
 * `<Button>` nests a button inside a link, two interactive elements where a
 * keyboard and a screen reader expect one; style the link instead.
 */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: Pick<ButtonProps, "variant" | "size" | "className"> = {}) {
  return cn(
    "inline-flex select-none items-center justify-center rounded-md font-semibold",
    "transition-[background-color,border-color,color,filter]",
    "disabled:pointer-events-none disabled:opacity-50",
    variantClasses[variant],
    sizeClasses[size],
    className,
  );
}

export function Button({
  children,
  className,
  type = "button",
  variant = "primary",
  size = "md",
  ...props
}: ButtonProps) {
  return (
    <button type={type} className={buttonClasses({ variant, size, className })} {...props}>
      {children}
    </button>
  );
}

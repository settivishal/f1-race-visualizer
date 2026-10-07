import { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * These previously carried `outline-none` and signalled focus with a border
 * tint alone, which is not a focus indicator — a 1px colour change is easy to
 * miss and fails against a dark ground. The global `:focus-visible` ring in
 * globals.css now does that job, so nothing here suppresses it.
 */
const fieldClasses =
  "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-foreground placeholder:text-subtle transition-[border-color,background-color] hover:border-line-strong";

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-eyebrow font-semibold uppercase text-muted">
        {label}
      </span>
      {children}
      {error ? (
        <span role="alert" className="mt-1.5 block text-sm text-flag-red">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1.5 block text-sm text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string | null;
};

export function Input({ label, hint, error, className, ...props }: InputProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      <input
        aria-invalid={error ? true : undefined}
        className={cn(fieldClasses, error && "border-flag-red", className)}
        {...props}
      />
    </Field>
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  error?: string | null;
};

export function Textarea({ label, hint, error, className, ...props }: TextareaProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      <textarea
        aria-invalid={error ? true : undefined}
        className={cn(fieldClasses, "min-h-28", error && "border-flag-red", className)}
        {...props}
      />
    </Field>
  );
}

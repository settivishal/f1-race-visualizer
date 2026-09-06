import { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string | null;
};

export function Input({ label, hint, error, className, ...props }: InputProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-foreground">
        {label}
      </span>
      <input
        className={cn(
          "w-full rounded-2xl border border-line bg-panel px-4 py-3 text-foreground outline-none transition focus:border-accent focus:bg-panel-strong/90",
          error ? "border-accent" : "",
          className,
        )}
        {...props}
      />
      {error ? (
        <span className="mt-2 block text-sm text-[#e10600]">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-2 block text-sm text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  error?: string | null;
};

export function Textarea({ label, hint, error, className, ...props }: TextareaProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-foreground">
        {label}
      </span>
      <textarea
        className={cn(
          "min-h-32 w-full rounded-2xl border border-line bg-panel px-4 py-3 text-foreground outline-none transition focus:border-accent focus:bg-panel-strong/90",
          error ? "border-accent" : "",
          className,
        )}
        {...props}
      />
      {error ? (
        <span className="mt-2 block text-sm text-[#e10600]">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-2 block text-sm text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

'use client';

import { useId } from 'react';
import * as Radix from '@radix-ui/react-select';

export type SelectOption = { value: string; label: string };

/**
 * A dropdown that looks the same in every browser.
 *
 * A native <select> can be styled shut but not open: Safari and Firefox draw
 * the list with the operating system's menu. Radix draws it here instead, and
 * keeps everything the native one gave us — keyboard, typeahead, screen
 * reader roles — plus a hidden native select carrying `name`, so the GET forms
 * around it submit, and AutoSubmit still hears a bubbling `change`.
 *
 * Radix reserves `""` for "nothing chosen", so no option may use it: an empty
 * choice is the `placeholder`, which submits nothing.
 *
 * Uncontrolled, like the selects it replaced. The key remounts it when a
 * navigation brings a new default or a new list (the compare page swaps
 * drivers for teams), since an uncontrolled field ignores a changed default.
 */
export function Select({
  name,
  label,
  defaultValue,
  options,
  placeholder,
  hint,
  className,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  options: SelectOption[];
  placeholder?: string;
  hint?: string;
  className?: string;
}) {
  const id = useId();
  const value = defaultValue || undefined;

  return (
    <div className={className ?? 'block'}>
      <span id={`${id}-label`} className="mb-1.5 block text-eyebrow font-semibold uppercase text-muted">
        {label}
      </span>
      <Radix.Root
        key={`${value}|${options.map((option) => option.value).join()}`}
        name={name}
        defaultValue={value}
      >
        <Radix.Trigger
          aria-labelledby={`${id}-label`}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-line bg-panel px-3 text-left text-sm text-foreground transition-[border-color,background-color] hover:border-line-strong data-[placeholder]:text-subtle data-[state=open]:border-line-strong"
        >
          <span className="truncate">
            <Radix.Value placeholder={placeholder} />
          </span>
          <Radix.Icon className="shrink-0 text-muted">
            <Chevron />
          </Radix.Icon>
        </Radix.Trigger>

        <Radix.Portal>
          <Radix.Content
            position="popper"
            sideOffset={6}
            collisionPadding={8}
            className="select-content z-50 max-h-[min(20rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] min-w-[10rem] overflow-hidden rounded-md border border-line-strong bg-panel-strong text-sm text-foreground shadow-lg"
          >
            <Radix.ScrollUpButton className="flex h-6 items-center justify-center text-muted">
              <Chevron up />
            </Radix.ScrollUpButton>
            <Radix.Viewport className="p-1">
              {options.map((option) => (
                <Radix.Item
                  key={option.value}
                  value={option.value}
                  className="relative flex cursor-pointer select-none items-center rounded-sm py-2 pl-3 pr-8 outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-foreground data-[state=checked]:font-semibold"
                >
                  <Radix.ItemText>{option.label}</Radix.ItemText>
                  <Radix.ItemIndicator className="absolute right-2.5 text-accent">
                    <Check />
                  </Radix.ItemIndicator>
                </Radix.Item>
              ))}
            </Radix.Viewport>
            <Radix.ScrollDownButton className="flex h-6 items-center justify-center text-muted">
              <Chevron />
            </Radix.ScrollDownButton>
          </Radix.Content>
        </Radix.Portal>
      </Radix.Root>
      {hint ? (
        <span id={`${id}-hint`} className="mt-1.5 block text-sm text-muted">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
      <path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
    </svg>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

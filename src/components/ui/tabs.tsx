import Link from "next/link";
import { cn } from "@/lib/cn";

export type Tab = {
  /** The value carried in the URL. */
  id: string;
  label: string;
  href: string;
};

/**
 * Tabs that are links, not state.
 *
 * The selected tab lives in the URL, which buys three things a `useState`
 * version cannot: the tab survives a reload, it can be linked to and shared,
 * and each panel is still a server component that only fetches when it is the
 * one being shown. It also stays operable with JavaScript disabled, and needs
 * no client bundle at all.
 *
 * The tab role is deliberately not used. ARIA tabs promise arrow-key navigation
 * within a tablist and a panel that swaps without a page load; these are links
 * that navigate. Announcing them as tabs would describe an interaction that is
 * not there, so they are marked up as what they are — navigation, with the
 * current one carrying `aria-current`.
 */
export function Tabs({ tabs, active, label = "Race views" }: { tabs: Tab[]; active: string; label?: string }) {
  return (
    <nav aria-label={label} className="border-b border-line">
      <ul className="hide-scrollbar -mb-px flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <li key={tab.id}>
              <Link
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                scroll={false}
                className={cn(
                  "inline-flex whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition-colors",
                  isActive
                    ? "border-accent text-foreground"
                    : "border-transparent text-muted hover:border-line-strong hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

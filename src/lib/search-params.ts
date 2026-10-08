/** What a page's `searchParams` resolves to. */
export type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

type Param = string | string[] | undefined;

/** The first value of a repeated parameter, which is the one a link sets. */
export const first = (value: Param) => (Array.isArray(value) ? value[0] : value);

/** `?season=2024` as a number; anything else, including nothing, is undefined. */
export function yearParam(value: Param): number | undefined {
  const raw = first(value);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) ? parsed : undefined;
}

/**
 * The season an archive page filters to: `?season=all` is every season (null),
 * a year is that year, and anything else falls back — to the configured
 * season, on every page that asks.
 */
export async function seasonFilter(value: Param, fallback: () => Promise<number>): Promise<number | null> {
  if (first(value) === 'all') return null;
  return yearParam(value) ?? fallback();
}

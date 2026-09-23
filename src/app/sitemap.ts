import type { MetadataRoute } from 'next';
import { getArchiveIndex, getRaceSlugs } from '@/lib/queries';
import { siteUrl } from '@/lib/site-url';

/**
 * The sitemap.
 *
 * Every public page is here and nothing else: `/admin`, `/login` and the API
 * routes are either private or not pages, and listing them would only invite
 * crawls of things that answer 401.
 *
 * `getRaceSlugs` is the same cached read `generateStaticParams` uses, so
 * building the sitemap costs no extra query — and it carries the race date,
 * which is the honest `lastModified` for a page whose content is a finished
 * race. It asks for no page size: this used to request 500 races from a keyset
 * connection that clamps to 100, so the twenty newest races were missing from
 * the sitemap altogether.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Both are cached reads the pages already make, so the sitemap adds no query.
  const [{ raceSlugs }, archive] = await Promise.all([getRaceSlugs(), getArchiveIndex()]);

  return [
    { url: siteUrl, changeFrequency: 'weekly', priority: 1 },
    { url: `${siteUrl}/races`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${siteUrl}/standings`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${siteUrl}/drivers`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${siteUrl}/teams`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${siteUrl}/circuits`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${siteUrl}/compare`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${siteUrl}/about`, changeFrequency: 'yearly', priority: 0.3 },
    ...archive.drivers.map((driver) => ({
      url: `${siteUrl}/drivers/${driver.code.toLowerCase()}`,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),
    ...archive.teams.map((team) => ({
      url: `${siteUrl}/teams/${encodeURIComponent(team.name)}`,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),
    ...archive.circuits.map((circuit) => ({
      url: `${siteUrl}/circuits/${circuit.ergastId}`,
      changeFrequency: 'yearly' as const,
      priority: 0.4,
    })),
    ...raceSlugs.map((race) => ({
      url: `${siteUrl}/races/${race.slug}`,
      lastModified: new Date(race.date),
      changeFrequency: 'yearly' as const,
      priority: 0.7,
    })),
  ];
}

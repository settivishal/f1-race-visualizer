import { asc, desc, eq, ilike, or } from 'drizzle-orm';
import { circuits, drivers, meetings, races, teams } from '@/db/schema';
import { sessionLabel } from '@/lib/session-title';
import { builder } from '../builder';

/**
 * One field behind the command palette.
 *
 * The palette needs four kinds of thing in one ranked list, and the honest
 * GraphQL answer would be a union of Race | Driver | Team | Circuit. It is
 * deliberately not that: a union means the client sends four inline fragments
 * to build a list where every row renders identically — an icon, a title, a
 * line of context and a link. So the resolver flattens to the shape the UI
 * actually consumes, and the href is built here because the server is the side
 * that knows a team's URL carries an encoded name and a circuit's carries its
 * Ergast id.
 *
 * The cost of that choice: anything wanting a *typed* driver out of a search
 * has to fetch it by code afterwards. Nothing does, and the palette is the only
 * caller.
 */

type Kind = 'RACE' | 'DRIVER' | 'TEAM' | 'CIRCUIT';

type Hit = {
  kind: Kind;
  title: string;
  subtitle: string | null;
  href: string;
};

const SearchKind = builder.enumType('SearchKind', {
  values: ['RACE', 'DRIVER', 'TEAM', 'CIRCUIT'] as const,
});

const SearchHit = builder.objectRef<Hit>('SearchHit').implement({
  fields: (t) => ({
    kind: t.field({ type: SearchKind, resolve: (h) => h.kind }),
    title: t.exposeString('title'),
    subtitle: t.exposeString('subtitle', { nullable: true }),
    href: t.exposeString('href'),
  }),
});

// Per kind, not overall: a query matching six drivers should not push the one
// matching circuit off the list. Four groups of five is a palette, not a page.
const PER_KIND = 5;

builder.queryField('search', (t) =>
  t.field({
    type: [SearchHit],
    args: { query: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const term = args.query.trim();
      // Two characters is where a prefix stops matching half the database. An
      // empty palette is also the correct answer to an empty box.
      if (term.length < 2) return [];
      const pattern = `%${term}%`;

      const [raceRows, driverRows, teamRows, circuitRows] = await Promise.all([
        // Newest first: someone typing "monaco" wants this year's, and races
        // are the one kind where recency is a real ranking signal.
        ctx.db
          .select({ slug: races.slug, type: races.type, name: meetings.name, season: meetings.seasonYear })
          .from(races)
          .innerJoin(meetings, eq(meetings.id, races.meetingId))
          .where(or(ilike(races.slug, pattern), ilike(meetings.name, pattern)))
          .orderBy(desc(races.date))
          .limit(PER_KIND),

        ctx.db
          .select({ code: drivers.code, name: drivers.name, country: drivers.country })
          .from(drivers)
          .where(or(ilike(drivers.name, pattern), ilike(drivers.code, pattern)))
          .orderBy(asc(drivers.name))
          .limit(PER_KIND),

        ctx.db
          .select({ name: teams.name })
          .from(teams)
          .where(ilike(teams.name, pattern))
          .orderBy(asc(teams.name))
          .limit(PER_KIND),

        ctx.db
          .select({ ergastId: circuits.ergastCircuitId, name: circuits.name, locality: circuits.locality, country: circuits.country })
          .from(circuits)
          .where(or(ilike(circuits.name, pattern), ilike(circuits.locality, pattern), ilike(circuits.country, pattern)))
          .orderBy(asc(circuits.name))
          .limit(PER_KIND),
      ]);

      return [
        ...raceRows.map((r): Hit => ({
          kind: 'RACE',
          title: `${r.season} ${r.name}`,
          subtitle: sessionLabel(r.type),
          href: `/races/${r.slug}`,
        })),
        ...driverRows.map((d): Hit => ({
          kind: 'DRIVER',
          title: d.name,
          subtitle: [d.code, d.country].filter(Boolean).join(' · ') || null,
          href: `/drivers/${d.code}`,
        })),
        ...teamRows.map((team): Hit => ({
          kind: 'TEAM',
          title: team.name,
          subtitle: null,
          href: `/teams/${encodeURIComponent(team.name)}`,
        })),
        ...circuitRows.map((c): Hit => ({
          kind: 'CIRCUIT',
          title: c.name,
          subtitle: [c.locality, c.country].filter(Boolean).join(', ') || null,
          href: `/circuits/${c.ergastId}`,
        })),
      ];
    },
  }),
);

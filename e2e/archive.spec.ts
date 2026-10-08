import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

/**
 * The archive pages, and the one thing that separates an archive race from a
 * modern one: it must say what its era did not publish rather than showing
 * empty columns.
 */
test('a driver page shows a record built from the seasons imported', async ({ page }) => {
  await page.goto('/drivers/ham');

  await expect(page.getByRole('heading', { name: 'Lewis Hamilton' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('heading', { name: 'By season' })).toBeVisible();

  // The record table has a row per season the database holds for him.
  const rows = page.locator('table tbody tr');
  await expect.poll(() => rows.count(), { timeout: 15_000 }).toBeGreaterThan(0);
});

test('the archive index pages list what has been imported', async ({ page }) => {
  await page.goto('/teams');
  await expect(page.getByRole('link', { name: /ferrari/i }).first()).toBeVisible({
    timeout: 30_000,
  });

  await page.goto('/circuits');
  await expect(page.getByRole('link', { name: /albert park/i }).first()).toBeVisible();
});

// A name with a space: the build once prerendered these as 404s.
test('a team page renders for a name with a space', async ({ page }) => {
  await page.goto('/teams/Aston%20Martin');
  await expect(page.getByRole('heading', { name: 'Aston Martin' })).toBeVisible({
    timeout: 30_000,
  });
});

test('a circuit page shows only the facts it has', async ({ page }) => {
  await page.goto('/circuits/albert_park');

  await expect(page.getByRole('heading', { name: /albert park/i })).toBeVisible({
    timeout: 30_000,
  });
  // Seeded facts, not the invented "15 turns, 5.0 km" the old lookup returned
  // for anything it did not recognise.
  await expect(page.getByText('5.278 km')).toBeVisible();
});

/**
 * The slug of the oldest race the database holds at `LAPS` tier, or null when
 * there is none.
 *
 * The test below is about an era, not a race, and which eras are imported is a
 * product decision that moves: 2018-2022 are on hold, so today production holds
 * only `FULL` races and the assertion has nothing to stand on. Hardcoding
 * `2019-melbourne` made this red for a missing import rather than a broken
 * behaviour. Asking the API instead means the test skips while the archive is
 * empty and arms itself the moment a backfill lands.
 */
type RacesPage = {
  data?: {
    races?: {
      edges: { node: { slug: string; dataTier: string } }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
};

async function findArchiveRace(request: APIRequestContext): Promise<string | null> {
  let after: string | null = null;

  for (;;) {
    const response: APIResponse = await request.post('/api/graphql', {
      data: {
        query: `query($after: String) {
          races(first: 100, after: $after) {
            edges { node { slug dataTier } }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        variables: { after },
      },
    });

    const { data }: RacesPage = await response.json();
    const connection = data?.races;
    if (!connection) return null;

    const archive = connection.edges.find((edge) => edge.node.dataTier === 'LAPS');
    if (archive) return archive.node.slug;

    if (!connection.pageInfo.hasNextPage) return null;
    after = connection.pageInfo.endCursor;
  }
}

test('an archive race says what its era did not publish', async ({ page, request }) => {
  const slug = await findArchiveRace(request);
  test.skip(slug === null, 'No LAPS-tier race is imported — the pre-2023 archive is on hold.');

  await page.goto(`/races/${slug}`);

  await expect(page.getByRole('img', { name: /race position chart/i })).toBeVisible({
    timeout: 30_000,
  });
  // The absence is stated, and the columns that would have held dashes are gone.
  // Gaps are no longer mentioned: `gap` is null on every row of every race, so
  // the column went and the notice stopped claiming it was an era thing.
  await expect(page.getByText(/sector times were not published/i)).toBeVisible();
  await expect(page.getByText('S1', { exact: true })).toHaveCount(0);
});

import { expect, test } from '@playwright/test';

/**
 * The Analysis tab, covered the same way the replay is: through what a visitor
 * can see, not through internal state.
 *
 * The failure this catches is the one the ingest change makes possible — a race
 * whose stints or lap times did not import, which renders as a page with
 * headings and no chart rather than as an error.
 */
const RACE = '2025-melbourne';

/**
 * The analysis payload is the heaviest read on the site — every lap of every
 * driver — and it is behind a `use cache` scope, so the first request for it
 * pays for all of it. Two workers hitting a freshly started server meant this
 * file's first test raced that cold entry and lost: the pace table had no rows
 * inside its timeout, three times in one afternoon.
 *
 * Warming it once here is the fix rather than a longer timeout, because a
 * longer timeout would only make the same race take longer to fail. What the
 * tests below assert is what the page renders, not how fast it warms.
 */
test.beforeAll(async ({ request }) => {
  await request.get(`/races/${RACE}?view=analysis`);
});

test('the analysis tab charts lap times and tyre strategy', async ({ page }) => {
  await page.goto(`/races/${RACE}`);

  await page.getByRole('link', { name: 'Analysis' }).click();
  await expect(page).toHaveURL(/view=analysis/);

  // The chart names the drivers it is drawing, so an empty one fails here.
  const chart = page.getByRole('img', { name: /^lap times for .+/i });
  await expect(chart).toBeVisible({ timeout: 30_000 });

  await expect(page.getByRole('heading', { name: 'Tyres' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Race pace' })).toBeVisible();

  // The pace table has a row per driver who set a lap. Found by its caption
  // rather than as "the last table on the page" — the page has more than one,
  // and which one is last depends on what has streamed in so far.
  const paceRows = page
    .getByRole('table', { name: /race pace by driver/i })
    .locator('tbody tr');
  await expect.poll(async () => paceRows.count(), { timeout: 30_000 }).toBeGreaterThan(10);
});

test('the selected view survives a reload, because it lives in the URL', async ({ page }) => {
  await page.goto(`/races/${RACE}?view=analysis`);

  const analysisTab = page.getByRole('link', { name: 'Analysis' });
  await expect(analysisTab).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Lap times' })).toBeVisible({ timeout: 30_000 });
});

test('a driver can be added to and removed from the lap-time chart', async ({ page }) => {
  await page.goto(`/races/${RACE}?view=analysis`);

  const chart = page.getByRole('img', { name: /^lap times for .+/i });
  await expect(chart).toBeVisible({ timeout: 30_000 });

  // The chart opens with the five quickest by median pace, and Hamilton is not
  // one of them here — which makes him the driver whose toggle proves the
  // control does something. The assertion below states that precondition rather
  // than assuming it.
  const hamilton = page.getByRole('button', { name: 'HAM', exact: true });
  await expect(hamilton).toHaveAttribute('aria-pressed', 'false');

  await hamilton.click();
  await expect(hamilton).toHaveAttribute('aria-pressed', 'true');
  // The label lists the drivers being drawn, so it names him once he is on.
  await expect(chart).toHaveAttribute('aria-label', /hamilton/i);

  await hamilton.click();
  await expect(chart).not.toHaveAttribute('aria-label', /hamilton/i);
});

test('a lap can be linked to', async ({ page }) => {
  await page.goto(`/races/${RACE}?lap=30`);

  const chart = page.getByRole('img', { name: /race position chart/i });
  await expect(chart).toBeVisible({ timeout: 30_000 });
  // The replay opens on the linked lap rather than on lap 1.
  await expect(chart).toHaveAttribute('aria-label', /lap 30 of/i);
});

test('head to head compares two drivers and follows the picker', async ({ page }) => {
  // `Race.analysis.headToHead` was written in M5 and no page had ever queried
  // it. This is the whole point of the section: that it renders, and that
  // choosing a different driver changes the answer rather than the tab.
  await page.goto('/races?season=all');
  await page.locator('a[href^="/races/2"]').first().click();
  await page.getByRole('link', { name: /analysis/i }).click();

  await expect(page.getByText('Two drivers, lap by lap')).toBeVisible();

  // Nothing is compared until someone asks: a default pair would be a second
  // cache miss, and each miss re-runs the whole-race analysis scan.
  await expect(page.getByText('Choose two drivers')).toBeVisible();
  await expect(page.getByText(/laps ahead/)).toHaveCount(0);

  // Switching the second driver keeps the Analysis view — the tab lives in the
  // query string, so the form has to carry it.
  const against = page.locator('select[name="b"]');
  const options = await against.locator('option').all();
  await against.selectOption(await options[options.length - 1].getAttribute('value') ?? '');
  await page.getByRole('button', { name: 'Compare' }).click();

  await expect(page.getByText('Two drivers, lap by lap')).toBeVisible();
  await expect(page.getByText(/laps ahead/).first()).toBeVisible();
  expect(page.url()).toContain('view=analysis');
});

test('the lap-time chart reads out every shown driver for the lap under the pointer', async ({
  page,
}) => {
  await page.goto(`/races/${RACE}?view=analysis`);

  const chart = page.getByRole('img', { name: /^lap times for .+/i });
  await expect(chart).toBeVisible({ timeout: 30_000 });

  // hover() rather than mouse.move(): it scrolls the chart into view first,
  // and the analysis tab is long enough that the chart starts below the fold.
  await chart.hover();

  // A lap number and one row per driver drawn — the readout is about the lap,
  // not about the nearest dot.
  const readout = page.getByText(/^Lap \d+$/).last();
  await expect(readout).toBeVisible();
  const rows = readout.locator('xpath=../ul/li');
  await expect(rows).toHaveCount(5);

  // Off the plot, it goes away rather than sticking to the last lap hovered.
  await page.mouse.move(0, 0);
  await expect(readout).toBeHidden();
});

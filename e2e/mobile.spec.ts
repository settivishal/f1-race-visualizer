import { expect, test } from '@playwright/test';

/**
 * The phone.
 *
 * Every page on the site used to scroll sideways by exactly 334px, and it was
 * the same element every time — the header nav, 477px of links in a 390px
 * viewport. The race page added another hundred of its own, because the chart's
 * `min-w-[760px]` propagated up through a grid column with no `min-w-0` and
 * stretched the timing tower beside it.
 *
 * Neither is visible at desktop width, which is where every other test in this
 * suite runs. That is the whole reason this file exists: a class of bug that
 * only exists below a breakpoint needs a test below that breakpoint.
 */

const PAGES = [
  '/',
  '/races',
  '/races?season=all',
  '/standings',
  '/drivers',
  '/teams',
  '/circuits',
  '/compare',
  '/about',
  '/races/2026-monza',
  '/races/2026-monza/analysis',
];

test.use({ viewport: { width: 390, height: 844 } });

for (const path of PAGES) {
  test(`${path} does not scroll sideways`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');

    const { clientWidth, scrollWidth } = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
}

test('the nav is reachable behind the menu button', async ({ page }) => {
  await page.goto('/');

  // The row of links is hidden below md, so the only way through is the
  // disclosure. If it were missing, the site would have no navigation at all on
  // a phone rather than merely an ugly one.
  // getByLabel, not getByRole('button'): a <summary> is a disclosure control
  // and is not exposed with a button role, whatever it looks like.
  const menu = page.getByLabel('Menu');
  await expect(menu).toBeVisible();

  await menu.click();
  // Scoped to the header: the footer carries its own Standings link now, and an
  // unscoped locator matches both and fails on strict mode rather than on
  // anything being wrong.
  await page
    .getByRole('banner')
    .getByRole('link', { name: 'Standings', exact: true })
    .click();

  await expect(page).toHaveURL(/\/standings/);
});

test('the chart fits the screen and windows the race instead of panning', async ({ page }) => {
  // It used to be 760px wide inside a scrolling box, so reading one race meant
  // scrolling in two directions at once. Now the axis shows as many laps as fit
  // at a legible spacing, centred on wherever the replay is.
  await page.goto('/races/2026-monza?lap=40');
  await page.waitForLoadState('networkidle');

  const chart = await page.evaluate(() => {
    const svg = document.querySelector('svg[role="img"]');
    const box = svg?.parentElement?.parentElement as HTMLElement;
    // A phone labels the axis with a bare number; the desktop prefixes "Lap".
    // Either way a tick is the only text in the chart that is just a number.
    const ticks = [...document.querySelectorAll('svg text')]
      .map((node) => (node.textContent ?? '').replace('Lap ', ''))
      .filter((text) => /^\d+$/.test(text))
      .map(Number);

    return {
      content: box.scrollWidth,
      visible: box.clientWidth,
      firstTick: Math.min(...ticks),
      lastTick: Math.max(...ticks),
    };
  });

  // Nothing to pan: the chart is drawn to the box it has.
  expect(chart.content).toBeLessThanOrEqual(chart.visible);

  // A window rather than the whole 53-lap race, and it is around lap 40.
  expect(chart.lastTick - chart.firstTick).toBeLessThan(40);
  expect(chart.firstTick).toBeLessThanOrEqual(40);
  expect(chart.lastTick).toBeGreaterThanOrEqual(40);
});

test('what a finger lands on is big enough to hit', async ({ page }) => {
  // Playwright's default is a fine pointer, so the coarse-pointer rules that
  // grow these targets would not apply. A phone is what this file is about.
  await page.emulateMedia({ reducedMotion: null });
  await page.goto('/races');
  await page.waitForLoadState('networkidle');

  const tooSmall = await page.evaluate(() => {
    const offenders: string[] = [];
    document.querySelectorAll('a, button, select').forEach((element) => {
      const rect = element.getBoundingClientRect();
      // Skipped: things with no box at all, and the skip link, which is
      // deliberately 1px until it takes focus.
      if (rect.width === 0 || rect.height === 0) return;
      if (element.className.toString().includes('sr-only')) return;
      // And inline links inside a sentence — "results from OpenF1", "see
      // About". WCAG 2.2 exempts those by name, because their height is the
      // line-height of the text around them and growing them would break the
      // paragraph rather than help anyone.
      if (getComputedStyle(element).display === 'inline') return;
      // 24x24 is WCAG 2.2 AA. Anything under that is a failure rather than a
      // preference, and is what this asserts; the 44px comfort target is a
      // coarse-pointer rule the desktop viewport here does not trigger.
      if (rect.width < 24 || rect.height < 24) {
        offenders.push(`${element.tagName} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
    });
    return offenders;
  });

  expect(tooSmall).toEqual([]);
});

test('the chart is drawn at the size it is displayed', async ({ page }) => {
  // It used to have a fixed 1120x640 viewBox scaled into whatever box it had.
  // At 390px that is a factor of 0.35, so an 11px label rendered at 3.8px and
  // the box letterboxed 129px. "Looks small" is not a test; these numbers are.
  await page.goto('/races/2026-monza?lap=40');
  await page.waitForLoadState('networkidle');

  const chart = await page.evaluate(() => {
    const svg = document.querySelector('svg[role="img"]') as SVGSVGElement;
    const box = svg.parentElement as HTMLElement;
    const rows = [...svg.querySelectorAll('text')]
      .filter((node) => /^P\d+$/.test(node.textContent ?? ''))
      .map((node) => node.getBoundingClientRect());
    const labels = [...svg.querySelectorAll('text')].map(
      (node) => node.getBoundingClientRect().height,
    );

    const ticks = [...svg.querySelectorAll('text')]
      .filter((node) => /^\d+$/.test(node.textContent ?? ''))
      .map((node) => node.getBoundingClientRect())
      .sort((a, b) => a.left - b.left);

    return {
      svgHeight: svg.getBoundingClientRect().height,
      boxHeight: box.getBoundingClientRect().height,
      smallestLabel: Math.min(...labels),
      rowGap: rows.length > 1 ? rows[1].top - rows[0].top : 0,
      rowCount: rows.length,
      labelOverlap: ticks.filter((tick, i) => i > 0 && tick.left < ticks[i - 1].right).length,
    };
  });

  // The assertion that would have caught this: type is type, at any width.
  expect(chart.smallestLabel).toBeGreaterThanOrEqual(10);

  // The drawing is the shape of its container, so nothing letterboxes.
  expect(Math.abs(chart.svgHeight - chart.boxHeight)).toBeLessThanOrEqual(1);

  // Rows stay far enough apart to read and to hit.
  expect(chart.rowCount).toBeGreaterThan(10);
  expect(chart.rowGap).toBeGreaterThanOrEqual(16);

  // And the axis holds as many labels as fit, rather than a fixed eight
  // overlapping into one smear.
  expect(chart.labelOverlap).toBe(0);
});

test('the driver badges come off on a phone and stay on a desktop', async ({ page }) => {
  // Twenty-two badges down a narrow screen are a column of labels over the
  // plot. The timing tower above lists every driver as real text instead.
  await page.goto('/races/2026-monza?lap=40');
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('race-car')).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/races/2026-monza?lap=40');
  await page.waitForLoadState('networkidle');
  expect(await page.getByTestId('race-car').count()).toBeGreaterThan(0);
});

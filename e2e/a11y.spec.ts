import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Accessibility, checked by something other than good intentions.
 *
 * The site is built carefully for this — the chart points at the timing tower
 * with `aria-describedby` because an SVG cannot be read, the flag tones are
 * derived from tokens so they hold their contrast in both themes, the replay
 * respects `prefers-reduced-motion` — and none of it was verified by anything.
 * Careful design that nobody measures is a claim, not a property.
 *
 * Serious and critical violations only. axe's "minor" and "moderate" buckets
 * include advisory rules that a design can reasonably decline, and a check that
 * fails on those gets switched off within a month.
 */

type Violation = {
  id: string;
  nodes: { target: unknown[]; failureSummary?: string }[];
};

/** Rule, selector and axe's own measurement, so a failure names the element. */
const describeViolation = (violation: Violation) =>
  `${violation.id} @ ${violation.nodes[0]?.target.join(' ')} — ${
    violation.nodes[0]?.failureSummary?.replace(/\s+/g, ' ') ?? ''
  }`;

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'race library', path: '/races' },
  { name: 'standings', path: '/standings' },
  { name: 'drivers', path: '/drivers' },
  { name: 'compare', path: '/compare' },
  { name: 'about', path: '/about' },
];

async function expectNoSerious(browser: import('@playwright/test').Page, path: string) {
  await browser.goto(path);
  // The pages stream, and axe would otherwise scan a skeleton.
  await browser.waitForLoadState('networkidle');

  const results = await new AxeBuilder({ page: browser })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const serious = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );

  // The failure carries axe's own summary, because "3 violations" sends you
  // to a report while a rule, a selector and the measured ratio send you to
  // the element.
  expect(serious.map(describeViolation)).toEqual([]);
}

for (const page of PAGES) {
  test(`${page.name} has no serious accessibility violations`, async ({ page: browser }) => {
    await expectNoSerious(browser, page.path);
  });
}

// A phone renders a different page: labels hidden below sm, columns below md.
// The header's search button had no name there and the desktop run never saw
// it, so the same pages, plus the archive tables, run again at phone width.
test.describe('at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const page of [...PAGES, { name: 'teams', path: '/teams' }, { name: 'circuits', path: '/circuits' }]) {
    test(`${page.name} has no serious accessibility violations`, async ({ page: browser }) => {
      await expectNoSerious(browser, page.path);
    });
  }
});

test('the race page is reachable and readable with the replay on it', async ({ page }) => {
  // The replay is the one page whose markup is generated rather than written:
  // an SVG chart, a live-updating tower, and controls that are not native.
  await page.goto('/races');
  await page.locator('a[href^="/races/2"]').first().click();
  await page.waitForLoadState('networkidle');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const serious = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );

  expect(serious.map(describeViolation)).toEqual([]);
});

import { expect, test } from '@playwright/test';

/**
 * The smoke test the design doc asks for: load a race, press play, assert the
 * positions changed.
 *
 * "Changed" is the tower's order, not a pixel or an internal state value. The
 * tower is the canvas's text alternative, so asserting on it covers the chart
 * as well — both render from the same lap — and it fails for the failures that
 * matter: no data, a player that renders but never advances, a lap loop that
 * advances the counter while every driver stays put.
 */
const RACE = '2025-melbourne';

/** `... race position chart, lap 12 of 57` — the label the chart already has. */
function lapFrom(label: string | null): number {
  return Number(/lap (\d+) of/i.exec(label ?? '')?.[1] ?? NaN);
}

test('a race replays: the lap advances and the order changes', async ({ page }) => {
  await page.goto(`/races/${RACE}`);

  const chart = page.getByRole('img', { name: /race position chart/i });
  await expect(chart).toBeVisible({ timeout: 30_000 });

  const startingLap = lapFrom(await chart.getAttribute('aria-label'));
  expect(startingLap).toBeGreaterThan(0);

  const order = () => page.getByTestId('tower-driver').allInnerTexts();
  const startingOrder = await order();
  // A tower with one row would make the order assertion below vacuous.
  expect(startingOrder.length).toBeGreaterThan(10);

  await page.getByRole('button', { name: 'Play replay' }).click();
  await expect(page.getByRole('button', { name: 'Pause replay' })).toBeVisible();

  await expect
    .poll(async () => lapFrom(await chart.getAttribute('aria-label')), { timeout: 45_000 })
    .toBeGreaterThan(startingLap);

  await expect.poll(order, { timeout: 45_000 }).not.toEqual(startingOrder);
});

test('focusing a driver names them on the chart, and pressing again clears it', async ({
  page,
}) => {
  await page.goto(`/races/${RACE}`);

  const chart = page.getByRole('img', { name: /race position chart/i });
  await expect(chart).toBeVisible({ timeout: 30_000 });

  const code = (await page.getByTestId('tower-driver').first().innerText()).trim();
  const named = new RegExp(`\\b${code}\\b`);
  // The two controls the plan gave this feature, asserted as one piece of
  // state: the tower row is pressed from the tower, and the chip above the
  // chart must agree without being touched.
  const row = page.locator('#replay-timing-tower').getByRole('button', { name: named }).first();
  const chip = page.getByTestId('driver-chips').getByRole('button', { name: named }).first();

  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(chart).toHaveAttribute('aria-label', /focused on /i);

  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'false');
  await expect(chart).not.toHaveAttribute('aria-label', /focused on /i);

  // And the same state reached from the other control.
  await chip.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
});

test('hovering a driver previews the emphasis without committing to it', async ({ page }) => {
  await page.goto(`/races/${RACE}`);
  await expect(page.getByRole('img', { name: /race position chart/i })).toBeVisible({
    timeout: 30_000,
  });

  // Exactly one car not drawn back is what "one driver stands out" means, and
  // it is the assertion the pixels cannot give us. `data-dimmed` is the state
  // itself rather than the styling that expresses it, which has changed shape
  // more than once.
  const fullStrengthCars = () =>
    page.getByTestId('race-car').and(page.locator('[data-dimmed="false"]')).count();

  const row = page.locator('#replay-timing-tower').getByRole('button').first();

  await row.hover();
  await expect.poll(fullStrengthCars).toBe(1);
  // A hover is a preview, not a choice.
  await expect(row).toHaveAttribute('aria-pressed', 'false');

  // And leaving puts the whole field back at full strength, rather than
  // leaving the last hovered driver lit.
  await page.mouse.move(0, 0);
  await expect.poll(fullStrengthCars).toBeGreaterThan(1);
});

test('the story moves the chart to the chapter being read', async ({ page }) => {
  await page.goto(`/races/${RACE}/story`);

  const chart = page.getByRole('img', { name: /race position chart/i });
  await expect(chart).toBeVisible({ timeout: 30_000 });

  const chapters = page.getByRole('list', { name: 'Race story' }).getByRole('listitem');
  expect(await chapters.count()).toBeGreaterThan(2);

  // The third chapter's own lap, read off its eyebrow, is where the chart
  // should land once that chapter is in the middle of the screen.
  const third = chapters.nth(2);
  const lap = Number(/Lap (\d+)/.exec(await third.innerText())?.[1]);
  await third.evaluate((node) => node.scrollIntoView({ block: 'center' }));

  await expect.poll(async () => lapFrom(await chart.getAttribute('aria-label'))).toBe(lap);
});

/**
 * The reduced-motion path, which had shipped untested.
 *
 * The preference must change *how* the replay moves without taking any of it
 * away: playback, the lap counter and the running order all still work, and
 * only the interpolation between laps stops. That second half is the part
 * nothing asserted — the player's `shouldReduceMotion` branch swaps the
 * animation for a `setTimeout`, and every piece of motion added since is
 * written to fall out of `lapProgress` staying at 0.
 */
test.describe('with a reduced-motion preference', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the replay still runs, and the cars step between laps instead of sliding', async ({
    page,
  }) => {
    await page.goto(`/races/${RACE}`);

    const chart = page.getByRole('img', { name: /race position chart/i });
    await expect(chart).toBeVisible({ timeout: 30_000 });

    const startingOrder = await page.getByTestId('tower-driver').allInnerTexts();

    // Half speed, so several samples land inside one lap.
    await page.getByRole('button', { name: '0.5x' }).click();
    await page.getByRole('button', { name: 'Play replay' }).click();

    // Lap and position read in one evaluate, not two round trips: read
    // separately, a pair can straddle a lap boundary and the step the
    // preference asks for looks like the slide it forbids.
    const sample = () =>
      page.evaluate(() => {
        const car = document.querySelector('[data-testid="race-car"]');
        const label = document.querySelector('svg[role="img"]')?.getAttribute('aria-label') ?? '';
        const playhead = document.querySelector('[data-testid="lap-playhead"]');
        const svg = document.querySelector('svg[role="img"]');

        return {
          lap: Number(/lap (\d+) of/i.exec(label)?.[1] ?? NaN),
          transform: car ? getComputedStyle(car).transform : null,
          // Context, carried only so a failure can say which of the two it
          // was: the car moving on its own, or the lap scale moving under it.
          playhead: playhead ? getComputedStyle(playhead).transform : null,
          width: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
        };
      });

    const samples: {
      lap: number;
      transform: string | null;
      playhead: string | null;
      width: number;
    }[] = [];
    for (let index = 0; index < 16; index += 1) {
      samples.push(await sample());
      await page.waitForTimeout(400);
    }

    // Nothing is taken away: the lap still advances and the order still changes.
    expect(samples.at(-1)!.lap).toBeGreaterThan(samples[0]!.lap);
    // Polled, not read once: the sampling window above is only a couple of
    // laps, and a race need not change hands in those.
    await expect
      .poll(() => page.getByTestId('tower-driver').allInnerTexts(), { timeout: 45_000 })
      .not.toEqual(startingOrder);

    // And the part that had never been checked: inside a lap the leading car's
    // badge does not move. Its transform comes from the same motion values the
    // whole chart animates from, so a car that holds still is the whole chart
    // holding still.
    const withinLap = samples
      .slice(1)
      .map((entry, index) => [samples[index]!, entry] as const)
      .filter(([before, after]) => before.lap === after.lap);

    expect(withinLap.length, 'no two samples landed inside the same lap').toBeGreaterThan(0);
    for (const [before, after] of withinLap) {
      expect(before.transform).not.toBeNull();
      // This has failed about one full run in three and has never reproduced
      // in isolation, so the message carries everything needed to tell the two
      // explanations apart rather than guessing again: if `playhead` and
      // `width` also differ, the whole chart rescaled and the car went with
      // it; if only `transform` differs, a car really did slide.
      expect(after.transform, `moved within lap ${before.lap}\n${JSON.stringify(
        { before, after },
        null,
        2,
      )}`).toBe(before.transform);
    }
  });
});

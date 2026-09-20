import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { SPACE_STUB } from '../../playwright.config';

const { scenarios } = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../src/data/scenarios.generated.json', import.meta.url)), 'utf8'),
) as {
  scenarios: {
    id: string;
    candidates: { token: string }[];
    states: { continuation: string }[];
  }[];
};

const ALPHAS = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2];
const LIVE_MODEL = 'stub-org/Tiny-Live-1B';
const LIVE_SENTENCE = 'gloriously, and the whole corridor filled with light.';

/** A Space response that is obviously distinguishable from the bundled measurements. */
function livePayload(scenarioId: string) {
  return {
    id: scenarioId,
    title: 'Live',
    negative_label: 'Left',
    positive_label: 'Right',
    prompt: 'Live prompt.',
    prefix: 'Live prefix',
    takeaway: 'Live takeaway.',
    candidates: [' gloriously', ' plainly', ' grimly'],
    layer: 42,
    scale: 3,
    model: LIVE_MODEL,
    device: 'cuda:0',
    states: ALPHAS.map((alpha) => ({
      alpha,
      percents: [55, 20, 5],
      other: 20,
      selected: ' gloriously',
      continuation: LIVE_SENTENCE,
    })),
  };
}

/**
 * Intercepts the Space. `mode` decides whether the live call succeeds, fails, or hangs.
 *
 * `delayMs` holds the result back so the pre-live state can be asserted deterministically - a
 * real Space takes seconds, an intercepted one would otherwise answer before the first paint.
 */
async function stubSpace(page: Page, mode: 'ok' | 'fail' | 'hang', delayMs = 0) {
  await page.route(`${SPACE_STUB}/**`, async (route) => {
    if (mode === 'hang') return; // never fulfilled: the client must time out on its own
    if (mode === 'fail') return route.fulfill({ status: 503, body: 'asleep' });

    const url = route.request().url();
    if (url.endsWith('/run_scenario')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ event_id: 'stub-event' }),
      });
    }
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const scenarioId = JSON.parse(route.request().postData() ?? '{"data":["movie-critic"]}')
      ?.data?.[0] ?? 'movie-critic';
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `event: complete\ndata: ${JSON.stringify([JSON.stringify(livePayload(scenarioId))])}\n\n`,
    });
  });
}

test.describe('live results from the Space', () => {
  test('shows the recorded measurement first, then replaces it with the live run', async ({ page }) => {
    await stubSpace(page, 'ok', 1200);
    await page.goto('/steering/');

    // The bundled measurement is readable and usable while the live call is still in flight.
    await expect(page.locator('#alpha-slider')).toHaveValue('0');
    await expect(page.getByText(/Running it live/)).toBeVisible();
    await expect(page.getByText(/Measured from/)).toBeVisible();
    await expect(page.getByText(scenarios[0].states[4].continuation, { exact: false }).first()).toBeVisible();

    await expect(page.getByText(/Computed live just now/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(LIVE_MODEL.split("/").pop()!).first()).toBeVisible();
    await expect(page.getByText(LIVE_SENTENCE, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/layer 42/).first()).toBeVisible();
  });

  test('keeps the recorded measurement when the Space is unavailable', async ({ page }) => {
    await stubSpace(page, 'fail');
    await page.goto('/steering/');

    await expect(page.getByText(/Live run unavailable/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Measured from/)).toBeVisible();

    // The page is still fully usable on the bundled data.
    const movie = scenarios[0];
    await page.getByRole('button', { name: /Set alpha to minus 2\.0/ }).click();
    await expect(page.locator('#alpha-slider')).toHaveValue('-2');
    const token = movie.candidates[0].token.trim();
    await expect(page.getByText(token, { exact: false }).first()).toBeVisible();
  });

  test('does not call the Space at all when live is switched off', async ({ page }) => {
    const attempts: string[] = [];
    await page.route(`${SPACE_STUB}/**`, (route) => {
      attempts.push(route.request().url());
      return route.fulfill({ status: 503, body: 'nope' });
    });
    await page.goto('/steering/?live=0');
    await page.waitForTimeout(1500);

    expect(attempts).toEqual([]);
    await expect(page.getByText(/Measured from/)).toBeVisible();
  });

  test('the slider stays local after the live results land', async ({ page }) => {
    const calls: string[] = [];
    await page.route(`${SPACE_STUB}/**`, async (route) => {
      calls.push(route.request().url());
      const url = route.request().url();
      if (url.endsWith('/run_scenario')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ event_id: 'e' }) });
      }
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify([JSON.stringify(livePayload('movie-critic'))])}\n\n`,
      });
    });
    await page.goto('/steering/');
    await expect(page.getByText(/Computed live just now/)).toBeVisible({ timeout: 15_000 });

    const before = calls.length;
    const slider = page.locator('#alpha-slider');
    await slider.focus();
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(600);

    // Scrubbing the whole range must not produce another request.
    expect(calls.length).toBe(before);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { SPACE_STUB } from '../../playwright.config';

const { scenarios } = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../src/data/scenarios.generated.json', import.meta.url)), 'utf8'),
) as {
  scenarios: {
    id: string;
    prompt: string;
    prefix: string;
    candidates: { token: string }[];
    states: { continuation: string }[];
  }[];
};

const ALPHAS = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2];
const LIVE_MODEL = 'stub-org/Tiny-Live-1B';
const LIVE_SENTENCE = 'gloriously, and the whole corridor filled with light.';

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
    cached: false,
    age_seconds: 0,
    states: ALPHAS.map((alpha) => ({
      alpha,
      percents: [55, 20, 5],
      other: 20,
      selected: ' gloriously',
      continuation: LIVE_SENTENCE,
    })),
  };
}

interface Recorded {
  calls: { fn: string; data: unknown[] }[];
}

/** Intercepts the Space and records which endpoint the page asked for. */
async function stubSpace(page: Page, mode: 'ok' | 'fail', delayMs = 0): Promise<Recorded> {
  const recorded: Recorded = { calls: [] };
  await page.route(`${SPACE_STUB}/**`, async (route) => {
    const url = route.request().url();
    if (mode === 'fail') return route.fulfill({ status: 503, body: 'asleep' });

    const match = /\/call\/([a-z_]+)(?:\/|$)/.exec(url);
    if (url.match(/\/call\/[a-z_]+$/)) {
      recorded.calls.push({
        fn: match?.[1] ?? '?',
        data: JSON.parse(route.request().postData() ?? '{}')?.data ?? [],
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ event_id: 'stub-event' }),
      });
    }
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const scenarioId = recorded.calls.at(-1)?.data?.[0];
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `event: complete\ndata: ${JSON.stringify([
        JSON.stringify(livePayload(typeof scenarioId === 'string' ? scenarioId : 'movie-critic')),
      ])}\n\n`,
    });
  });
  return recorded;
}

test.describe('the live Space', () => {
  test('is not called at all until the visitor asks', async ({ page }) => {
    const recorded = await stubSpace(page, 'ok');
    await page.goto('/');
    await expect(page.locator('#alpha-slider')).toHaveValue('0');
    await page.waitForTimeout(1500);

    // Loading the page must not spend anyone's GPU quota.
    expect(recorded.calls).toEqual([]);
    await expect(page.getByText(/Measured from/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Run it live on the GPU/ })).toBeVisible();
  });

  test('runs on demand and swaps the results in', async ({ page }) => {
    const recorded = await stubSpace(page, 'ok', 700);
    await page.goto('/');
    await page.getByRole('button', { name: /Run it live on the GPU/ }).click();

    await expect(page.getByRole('button', { name: /Running on the GPU/ })).toBeVisible();
    await expect(page.getByText(/Computed live just now/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(LIVE_SENTENCE, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/layer 42/).first()).toBeVisible();
    expect(recorded.calls[0].fn).toBe('run_model');
  });

  test('sends the chosen model', async ({ page }) => {
    const recorded = await stubSpace(page, 'ok');
    await page.goto('/');
    await page.getByLabel('Model').selectOption({ index: 1 });
    await page.getByRole('button', { name: /Run it live on the GPU/ }).click();
    await expect(page.getByText(/Computed live just now/)).toBeVisible({ timeout: 20_000 });

    expect(recorded.calls[0].data[1]).toContain('SmolLM2');
  });

  test('sends an edited prompt to the custom endpoint', async ({ page }) => {
    const recorded = await stubSpace(page, 'ok');
    await page.goto('/');
    await page.getByLabel(/^Prompt/).fill('Describe a rainy afternoon.');
    await expect(page.getByRole('button', { name: /Run my prompt on the GPU/ })).toBeVisible();
    await page.getByRole('button', { name: /Run my prompt on the GPU/ }).click();
    await expect(page.getByText(/Computed live just now/)).toBeVisible({ timeout: 20_000 });

    expect(recorded.calls[0].fn).toBe('run_custom');
    expect(recorded.calls[0].data[0]).toBe('Describe a rainy afternoon.');
    expect(recorded.calls[0].data[2]).toBe(scenarios[0].id);
  });

  test('reports a failed run only because it was asked for', async ({ page }) => {
    await stubSpace(page, 'fail');
    await page.goto('/');
    // Nothing is wrong before the visitor asks for anything.
    await expect(page.getByText(/Measured from/)).toBeVisible();
    await expect(page.getByText(/did not finish|replied 503/)).toHaveCount(0);

    await page.getByRole('button', { name: /Run it live on the GPU/ }).click();
    await expect(page.getByText(/replied 503|did not finish/).first()).toBeVisible({ timeout: 20_000 });

    // The recorded measurement is untouched and the page still works.
    await expect(page.getByText(/Measured from/)).toBeVisible();
    await page.getByRole('button', { name: /Set alpha to minus 2\.0/ }).click();
    await expect(page.locator('#alpha-slider')).toHaveValue('-2');
  });

  test('goes back to the recorded run on request', async ({ page }) => {
    await stubSpace(page, 'ok');
    await page.goto('/');
    await page.getByRole('button', { name: /Run it live on the GPU/ }).click();
    await expect(page.getByText(/Computed live just now/)).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /Back to the recorded run/ }).click();
    await expect(page.getByText(/Measured from/)).toBeVisible();
    await expect(page.getByText(scenarios[0].states[4].continuation, { exact: false }).first()).toBeVisible();
  });

  test('the slider stays local after a live run', async ({ page }) => {
    const recorded = await stubSpace(page, 'ok');
    await page.goto('/');
    await page.getByRole('button', { name: /Run it live on the GPU/ }).click();
    await expect(page.getByText(/Computed live just now/)).toBeVisible({ timeout: 20_000 });

    const before = recorded.calls.length;
    await page.locator('#alpha-slider').focus();
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(600);
    expect(recorded.calls.length).toBe(before);
  });

  test('hides the live controls entirely with ?live=0', async ({ page }) => {
    const recorded = await stubSpace(page, 'ok');
    await page.goto('/?live=0');
    await page.waitForTimeout(1200);
    expect(recorded.calls).toEqual([]);
    await expect(page.getByRole('button', { name: /Run it live/ })).toHaveCount(0);
    await expect(page.getByText(/Measured from/)).toBeVisible();
  });
});

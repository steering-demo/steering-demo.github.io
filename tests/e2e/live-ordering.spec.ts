import { expect, test, type Page } from '@playwright/test';

import { SPACE_STUB } from '../../playwright.config';

/**
 * Stale live replies, and what the page says about where a result came from.
 *
 * The component used to guard against stale replies by comparing a key captured when the request
 * started against a key rebuilt from the same render closure. Both came from the same snapshot,
 * so the comparison always matched and no reply was ever rejected.
 */

const ALPHAS = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2];

interface Step {
  delayMs: number;
  /** Omitted for a step that should fail rather than answer. */
  payload?: Record<string, unknown>;
  status?: number;
}

function payloadFor(model: string, sentence: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'movie-critic',
    title: 'Live',
    negative_label: 'Left',
    positive_label: 'Right',
    prompt: 'Live prompt.',
    prefix: 'Live prefix',
    takeaway: 'Live takeaway.',
    candidates: [' one', ' two', ' three'],
    layer: 11,
    scale: 1,
    model,
    device: 'cuda:0',
    cached: false,
    age_seconds: 0,
    states: ALPHAS.map((alpha) => ({
      alpha,
      percents: [55, 20, 5],
      other: 20,
      selected: ' one',
      selected_index: 0,
      continuation: sentence,
    })),
    ...extra,
  };
}

/**
 * Serves each successive call from `programme`, tying the streamed reply to the request that
 * started it via the event id. A step can therefore be made slow while a later one answers at
 * once, which is the situation being tested.
 */
async function programSpace(page: Page, programme: Step[]) {
  const calls: { fn: string; data: unknown[] }[] = [];
  let started = -1;

  await page.route(`${SPACE_STUB}/**`, async (route) => {
    const url = route.request().url();

    if (/\/call\/[a-z_]+$/.test(url)) {
      started += 1;
      calls.push({
        fn: /\/call\/([a-z_]+)$/.exec(url)?.[1] ?? '?',
        data: JSON.parse(route.request().postData() ?? '{}')?.data ?? [],
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ event_id: `stub-${started}` }),
      });
    }

    const index = Number(/stub-(\d+)$/.exec(url)?.[1] ?? 0);
    const step = programme[Math.min(index, programme.length - 1)];
    if (step.delayMs) await new Promise((resolve) => setTimeout(resolve, step.delayMs));

    try {
      if (!step.payload) {
        await route.fulfill({ status: step.status ?? 503, body: 'no' });
        return;
      }
      // The real Space echoes the prompt and prefix it measured, which is what the page builds
      // the result's identity from. A stub that returned fixed text would make every custom run
      // look like it had answered a different question.
      const call = calls[index];
      const body =
        call?.fn === 'run_custom'
          ? { ...step.payload, prompt: call.data[0], prefix: call.data[1] }
          : step.payload;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `event: complete\ndata: ${JSON.stringify([JSON.stringify(body)])}\n\n`,
      });
    } catch {
      // The browser abandoned this request when the visitor moved on. That is the behaviour
      // under test, not a failure of the stub.
    }
  });

  return calls;
}

const SLOW = 'slowly, from the run that was abandoned.';
const FAST = 'quickly, from the run that was actually asked for.';

test.describe('a reply for a configuration the visitor has left', () => {
  /*
   * Each of these leaves one run outstanding and then changes something, without starting a
   * second run. That matters: starting another run abandons the first request on its own, which
   * is why a guard that never rejected anything went unnoticed for so long. With no second click,
   * the only thing that can stop the stale reply is the invalidation being tested.
   */

  test('does not land on a model the visitor has since chosen against', async ({ page }) => {
    await programSpace(page, [{ delayMs: 2500, payload: payloadFor('stub-org/Abandoned-Model', SLOW) }]);
    await page.goto('/');

    await page.getByRole('button', { name: /Run this example on the GPU/ }).click();
    await expect(page.getByRole('button', { name: /Running on the GPU/ })).toBeVisible();

    const select = page.getByLabel('Model for live run');
    await select.selectOption({ index: 1 });
    await expect(select).toHaveValue(/SmolLM2/);

    await page.waitForTimeout(4000);

    // Applying this reply would put the abandoned model's name in the badge while the dropdown
    // shows another one, and label numbers from one model as if they came from the other.
    await expect(page.getByText(/Abandoned-Model/)).toHaveCount(0);
    await expect(page.getByText(SLOW, { exact: false })).toHaveCount(0);
    await expect(page.getByText(/Precomputed results/)).toBeVisible();
  });

  test('does not land on a prompt the visitor has since edited', async ({ page }) => {
    await programSpace(page, [{ delayMs: 2500, payload: payloadFor('stub-org/Abandoned-Model', SLOW) }]);
    await page.goto('/');

    await page.getByRole('button', { name: /Run this example on the GPU/ }).click();
    await expect(page.getByRole('button', { name: /Running on the GPU/ })).toBeVisible();

    await page.getByLabel(/^Prompt/).fill('Describe a rainy afternoon.');
    await page.waitForTimeout(4000);

    await expect(page.getByText(SLOW, { exact: false })).toHaveCount(0);
    await expect(page.getByText(/Abandoned-Model/)).toHaveCount(0);
    await expect(page.getByText(/Precomputed results/)).toBeVisible();
  });

  test('does not report a failure the visitor has already moved on from', async ({ page }) => {
    await programSpace(page, [{ delayMs: 2500 }]);
    await page.goto('/');

    await page.getByRole('button', { name: /Run this example on the GPU/ }).click();
    await expect(page.getByRole('button', { name: /Running on the GPU/ })).toBeVisible();

    const select = page.getByLabel('Model for live run');
    await select.selectOption({ index: 1 });
    await expect(select).toHaveValue(/SmolLM2/);

    await page.waitForTimeout(4000);

    await expect(page.getByText(/did not finish/)).toHaveCount(0);
    await expect(page.getByText(/Precomputed results/)).toBeVisible();
  });

  test('cannot land on a scenario the visitor has switched away from', async ({ page }) => {
    await programSpace(page, [{ delayMs: 2500, payload: payloadFor('stub-org/Abandoned-Model', SLOW) }]);
    await page.goto('/');

    await page.getByRole('button', { name: /Run this example on the GPU/ }).click();
    await expect(page.getByRole('button', { name: /Running on the GPU/ })).toBeVisible();

    await page.getByRole('tab').nth(1).click();
    await page.waitForTimeout(4000);

    await expect(page.getByText(/Precomputed results/)).toBeVisible();
    await expect(page.getByText(SLOW, { exact: false })).toHaveCount(0);
  });

  test('an abandoned failure cannot overwrite a result that succeeded after it', async ({ page }) => {
    await programSpace(page, [
      { delayMs: 3000 },
      { delayMs: 0, payload: payloadFor('stub-org/Current-Model', FAST) },
    ]);
    await page.goto('/');

    await page.getByRole('button', { name: /Run this example on the GPU/ }).click();
    await expect(page.getByRole('button', { name: /Running on the GPU/ })).toBeVisible();

    const select = page.getByLabel('Model for live run');
    await select.selectOption({ index: 1 });
    await expect(select).toHaveValue(/SmolLM2/);
    await page.getByRole('button', { name: /Run this example on the GPU/ }).click();
    await expect(page.getByText(/Current-Model/).first()).toBeVisible({ timeout: 20_000 });

    // The first run's failure arrives last. It must not replace the result on screen.
    await page.waitForTimeout(4000);
    await expect(page.getByText(/did not finish/)).toHaveCount(0);
    await expect(page.getByText(/Current-Model/).first()).toBeVisible();
    await expect(page.getByText(FAST, { exact: false }).first()).toBeVisible();
  });
});

test.describe('what the page says about where a result came from', () => {
  test('names the model that actually ran, not the recorded one', async ({ page }) => {
    await programSpace(page, [
      { delayMs: 0, payload: payloadFor('HuggingFaceTB/SmolLM2-135M-Instruct', FAST) },
    ]);
    await page.goto('/');
    await page.getByRole('button', { name: /Run this example on the GPU/ }).click();
    await expect(page.getByText(/Computed on Hugging Face/)).toBeVisible({ timeout: 20_000 });

    const explanation = page.locator('details', { hasText: 'How this works' });
    await explanation.getByText('How this works').click();
    await expect(explanation).toContainText('SmolLM2-135M-Instruct');
    await expect(explanation).not.toContainText('Qwen2.5-0.5B-Instruct');
    await expect(explanation).toContainText('computed on Hugging Face during this visit');
  });

  test('says a cached result was replayed rather than computed just now', async ({ page }) => {
    await programSpace(page, [
      {
        delayMs: 0,
        payload: payloadFor('stub-org/Current-Model', FAST, { cached: true, age_seconds: 600 }),
      },
    ]);
    await page.goto('/');
    await page.getByRole('button', { name: /Run this example on the GPU/ }).click();

    await expect(page.getByText(/Replayed from the Space's cache, 10 min ago/)).toBeVisible({
      timeout: 20_000,
    });
    const explanation = page.locator('details', { hasText: 'How this works' });
    await explanation.getByText('How this works').click();
    await expect(explanation).toContainText('replayed the result it stored 10 min ago');
    await expect(explanation).not.toContainText('computed on Hugging Face during this visit');
  });

  test('says so when a stored result was served because the run failed', async ({ page }) => {
    await programSpace(page, [
      {
        delayMs: 0,
        payload: payloadFor('stub-org/Current-Model', FAST, {
          cached: true,
          stale: true,
          age_seconds: 3600,
          note: 'RuntimeError: ZeroGPU quota exceeded',
        }),
      },
    ]);
    await page.goto('/');
    await page.getByRole('button', { name: /Run this example on the GPU/ }).click();

    await expect(page.getByText(/Live run failed/)).toBeVisible({ timeout: 20_000 });
    const explanation = page.locator('details', { hasText: 'How this works' });
    await explanation.getByText('How this works').click();
    await expect(explanation).toContainText('did not complete');
    await expect(explanation).toContainText('ZeroGPU quota exceeded');
  });
});

test.describe('the editor and the results on screen', () => {
  test('says so while an edited prompt has not been run', async ({ page }) => {
    await programSpace(page, [{ delayMs: 0, payload: payloadFor('stub-org/Current-Model', FAST) }]);
    await page.goto('/');

    // Nothing is stale before anything is edited.
    await expect(page.getByText(/Showing the saved example/)).toHaveCount(0);

    await page.getByLabel(/^Prompt/).fill('Describe a rainy afternoon.');
    await expect(page.getByText(/Showing the saved example/)).toBeVisible();
    // The numbers underneath are still the saved ones, and still labelled as such.
    await expect(page.getByText(/Precomputed results/)).toBeVisible();

    // Running the edited prompt resolves it.
    await page.getByRole('button', { name: /Run my prompt on the GPU/ }).click();
    await expect(page.getByText(/Current-Model/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Showing the saved example/)).toHaveCount(0);

    // And going back to the saved example clears the draft with it.
    await page.getByRole('button', { name: /Back to the saved example/ }).click();
    await expect(page.getByText(/Precomputed results/)).toBeVisible();
    await expect(page.getByText(/Showing the saved example/)).toHaveCount(0);
  });
});

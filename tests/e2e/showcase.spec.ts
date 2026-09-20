import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

interface Candidate { id: string; token: string; label: string }
interface State {
  index: number;
  alpha: number;
  probabilities: number[];
  other: number;
  selectedIndex: number;
  continuation: string;
}
interface Scenario {
  id: string;
  title: string;
  prompt: string;
  prefix: string;
  takeaway: string;
  negativeLabel: string;
  positiveLabel: string;
  candidates: Candidate[];
  states: State[];
}

// The same data the page was built from, so the tests compare the UI against the content source
// rather than against numbers copied into the test.
const { scenarios } = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../src/data/scenarios.generated.json', import.meta.url)), 'utf8'),
) as { scenarios: Scenario[] };

const PAGE = '/?live=0';

/** Reads the accessible probability table that mirrors the chart. */
async function readTable(page: Page): Promise<{ label: string; value: number; neutral: number }[]> {
  return page.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return [];
    return [...table.querySelectorAll('tbody tr')].map((row) => {
      const cells = row.querySelectorAll('th, td');
      return {
        label: cells[0].textContent ?? '',
        // "<0.1%" renders for a small but non-zero probability; treat it as such.
        value: (cells[1].textContent ?? '').startsWith('<')
          ? 0.05
          : Number.parseFloat(cells[1].textContent ?? ''),
        neutral: (cells[2].textContent ?? '').startsWith('<')
          ? 0.05
          : Number.parseFloat(cells[2].textContent ?? ''),
      };
    });
  });
}

/** x centre of each neutral-reference marker, in SVG user units. */
async function markerPositions(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('svg rect[width="2"]')].map(
      (rect) => Number(rect.getAttribute('x')) + 1,
    ),
  );
}

async function barWidths(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.recharts-bar-rectangle path')].map(
      (path) => Math.round((path as SVGGraphicsElement).getBBox().width * 100) / 100,
    ),
  );
}

test.describe('representation steering showcase', () => {
  test('loads with no console or page errors and no external requests', async ({ page }) => {
    const problems: string[] = [];
    const external: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('request', (request) => {
      if (!request.url().startsWith('http://127.0.0.1')) external.push(request.url());
    });

    await page.goto(PAGE);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Explore Representation Steering',
    );
    await expect(page.getByText(/Precomputed results/)).toBeVisible();
    await page.waitForTimeout(500);

    expect(problems, problems.join('\n')).toEqual([]);
    expect(external, external.join('\n')).toEqual([]);
  });

  test('renders a meaningful state in the static HTML, before any JavaScript runs', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(PAGE);

    const movie = scenarios[0];
    await expect(page.getByText(movie.prompt)).toBeVisible();
    await expect(page.getByText(movie.prefix, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(movie.states[4].continuation, { exact: false }).first()).toBeVisible();
    await expect(page.locator('#alpha-slider')).toHaveValue('0');
    await context.close();
  });

  test('builds one tab per scenario, with tab semantics', async ({ page }) => {
    await page.goto(PAGE);
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(scenarios.length);
    for (const [index, scenario] of scenarios.entries()) {
      await expect(tabs.nth(index)).toHaveText(scenario.title);
    }
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toBeVisible();
  });

  test('switching scenario resets alpha to zero', async ({ page }) => {
    await page.goto(PAGE);
    await page.getByRole('button', { name: /Set alpha to plus 2\.0/ }).click();
    await expect(page.locator('#alpha-slider')).toHaveValue('2');

    await page.getByRole('tab', { name: scenarios[1].title }).click();
    await expect(page.locator('#alpha-slider')).toHaveValue('0');
    await expect(page.getByRole('tab', { name: scenarios[1].title })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText(scenarios[1].prompt)).toBeVisible();
  });

  test('tabs are operable with the arrow keys', async ({ page }) => {
    await page.goto(PAGE);
    await page.getByRole('tab', { name: scenarios[0].title }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: scenarios[1].title })).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: scenarios.at(-1)!.title })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: scenarios[0].title })).toBeFocused();
  });

  test('the slider steps through all nine states with the keyboard', async ({ page }) => {
    await page.goto(PAGE);
    const slider = page.locator('#alpha-slider');
    await slider.focus();
    await page.keyboard.press('Home');
    await expect(slider).toHaveValue('-2');

    const movie = scenarios[0];
    for (const state of movie.states) {
      await expect(slider).toHaveValue(String(state.alpha));
      await expect(page.getByText(state.continuation, { exact: false }).first()).toBeVisible();
      if (state.index < movie.states.length - 1) await page.keyboard.press('ArrowRight');
    }
    await expect(slider).toHaveValue('2');
    await page.keyboard.press('End');
    await expect(slider).toHaveValue('2');
  });

  test('the chart, the accessible table and the completion always agree', async ({ page }) => {
    await page.goto(PAGE);
    const slider = page.locator('#alpha-slider');

    for (const scenario of scenarios) {
      await page.getByRole('tab', { name: scenario.title }).click();
      for (const state of scenario.states) {
        await slider.fill(String(state.alpha));
        await expect(slider).toHaveValue(String(state.alpha));

        const rows = await readTable(page);
        expect(rows).toHaveLength(scenario.candidates.length + 1);
        scenario.candidates.forEach((candidate, index) => {
          expect(rows[index].label).toBe(candidate.label);
          const expected = state.probabilities[index];
          expect(rows[index].value, `${scenario.id} @ ${state.alpha} ${candidate.id}`).toBeCloseTo(
            expected < 0.1 && expected > 0 ? 0.05 : Number(expected.toFixed(1)),
            1,
          );
        });
        expect(rows.at(-1)!.value).toBeCloseTo(Number(state.other.toFixed(1)), 1);
        expect(rows.reduce((sum, row) => sum + row.value, 0)).toBeCloseTo(100, 0);

        // The completion begins with the candidate the table shows as the highest.
        const highest = rows
          .slice(0, scenario.candidates.length)
          .reduce((best, row) => (row.value > best.value ? row : best));
        expect(state.continuation.toLowerCase().startsWith(highest.label.toLowerCase())).toBe(true);
        await expect(page.getByText(state.continuation, { exact: false }).first()).toBeVisible();
      }
    }
  });

  test('the neutral markers sit at their own percentages on the axis', async ({ page }) => {
    await page.goto(PAGE);
    await page.waitForTimeout(400);

    const scenario = scenarios[0];
    const expected = [...scenario.states[4].probabilities, scenario.states[4].other];
    const positions = await markerPositions(page);
    expect(positions).toHaveLength(expected.length);

    // Fit x = origin + scale * percent on the two extreme rows, then check the rest.
    const lowIndex = expected.indexOf(Math.min(...expected));
    const highIndex = expected.indexOf(Math.max(...expected));
    const scale =
      (positions[highIndex] - positions[lowIndex]) / (expected[highIndex] - expected[lowIndex]);
    const origin = positions[lowIndex] - scale * expected[lowIndex];
    expect(scale).toBeGreaterThan(0);

    expected.forEach((percent, index) => {
      expect(Math.abs(positions[index] - (origin + scale * percent))).toBeLessThan(1.5);
    });
  });

  test('the prompt and prefix never change while alpha does', async ({ page }) => {
    await page.goto(PAGE);
    const movie = scenarios[0];
    const slider = page.locator('#alpha-slider');
    for (const alpha of [-2, -1, 0, 1, 2]) {
      await slider.fill(String(alpha));
      await expect(page.getByText(movie.prompt)).toBeVisible();
      await expect(page.getByText(movie.prefix, { exact: false }).first()).toBeVisible();
    }
  });

  test('the neutral reference stays fixed and reset returns to it', async ({ page }) => {
    await page.goto(PAGE);
    const movie = scenarios[0];
    const reference = page.getByRole('heading', { name: /Without steering/i }).locator('..');

    await expect(reference).toContainText(movie.states[4].continuation);
    await page.getByRole('button', { name: /Set alpha to minus 2\.0/ }).click();
    await expect(reference).toContainText(movie.states[4].continuation);

    const reset = page.getByRole('button', { name: /Reset to \u03b1 = 0/ });
    await expect(reset).toBeEnabled();
    await reset.click();
    await expect(page.locator('#alpha-slider')).toHaveValue('0');
    await expect(page.getByRole('button', { name: /At \u03b1 = 0/ })).toBeDisabled();
  });

  test('moving the slider makes no network requests', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    const after: string[] = [];
    page.on('request', (request) => after.push(request.url()));

    const slider = page.locator('#alpha-slider');
    await slider.focus();
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('ArrowLeft');
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('ArrowRight');
    await page.getByRole('tab', { name: scenarios[2].title }).click();
    await page.waitForTimeout(500);

    expect(after, after.join('\n')).toEqual([]);
  });

  test('rapid scrubbing lands on the final state with no stale output', async ({ page }) => {
    await page.goto(PAGE);
    const slider = page.locator('#alpha-slider');
    await slider.focus();
    for (const alpha of [-2, 2, -1.5, 1.5, -0.5, 1, -2, 2]) {
      await slider.fill(String(alpha));
    }
    const movie = scenarios[0];
    const final = movie.states.at(-1)!;

    // The numbers are correct immediately, before the bars finish easing.
    // The table formats to one decimal, so compare against the same rounding.
    const toShown = (value: number) => (value > 0 && value < 0.1 ? 0.05 : Number(value.toFixed(1)));
    const rowsNow = await readTable(page);
    expect(rowsNow.map((row) => row.value)).toEqual(
      [...final.probabilities, final.other].map(toShown),
    );

    await page.waitForTimeout(500);
    const settled = await barWidths(page);
    const widest = Math.max(...settled);
    expect(settled.indexOf(widest)).toBe(final.selectedIndex);
    expect(await readTable(page)).toEqual(rowsNow);
  });

  test('the slider announces the scenario meaning', async ({ page }) => {
    await page.goto(PAGE);
    const slider = page.locator('#alpha-slider');
    await slider.fill('1.5');
    const valueText = await slider.getAttribute('aria-valuetext');
    expect(valueText).toContain('alpha plus 1.5');
    expect(valueText).toContain(scenarios[0].positiveLabel);
    const expected = scenarios[0].candidates[scenarios[0].states[7].selectedIndex].label;
    expect(valueText).toContain(expected);
    await expect(page.locator('[aria-live="polite"]')).toHaveCount(1);
  });

  test('the explainer is expandable and states the caveats', async ({ page }) => {
    await page.goto(PAGE);
    const details = page.locator('details');
    await expect(details).not.toHaveAttribute('open', '');
    await page.getByText('How this works').click();
    await expect(details).toHaveAttribute('open', '');
    await expect(details).toContainText('immediately after the fixed opening words');
    await expect(details).toContainText('combined remainder of the vocabulary');
    await expect(details).toContainText('greedy decoding');
    await expect(details).toContainText('selected demonstration settings');
  });

  for (const [name, width, height] of [
    ['mobile', 375, 780],
    ['tablet', 768, 1024],
    ['desktop', 1440, 1000],
  ] as const) {
    test(`has no horizontal page overflow at ${name} width`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(PAGE);
      await page.getByRole('button', { name: /Set alpha to plus 2\.0/ }).click();
      await page.waitForTimeout(400);
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
    });
  }
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('applies state changes without a transition', async ({ page }) => {
    await page.goto(PAGE);
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /Set alpha to plus 2\.0/ }).click();

    const immediate = await barWidths(page);
    await page.waitForTimeout(500);
    const settled = await barWidths(page);
    expect(immediate).toEqual(settled);
  });
});

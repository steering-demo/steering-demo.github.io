import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the unit tests. `tests/e2e` belongs to Playwright.
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});

// @ts-check
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

/**
 * Base path support.
 *
 * A GitHub Pages *user* site is served from the domain root, so the default is `/`. A project
 * repository is served from `/<repo>/`, so the CI workflow (or a local build) sets BASE_PATH.
 * Every URL in the site is written through `import.meta.env.BASE_URL`, and Astro rewrites bundled
 * asset URLs, so nothing assumes assets live at `/assets/`.
 *
 *   BASE_PATH=/steering-demo.github.io/ npm run build
 */
/** @param {string | undefined} value */
function normalizeBase(value) {
  if (!value) return '/';
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? '/' : `/${trimmed}`;
}

const base = normalizeBase(process.env.BASE_PATH);
const site = process.env.SITE_URL?.trim() || undefined;

/**
 * Keeps the generated scenario JSON in step with `content/scenarios.md` while the dev server is
 * running, so editing the Markdown hot-reloads the page. The build path does not need this: the
 * `build` script regenerates first.
 */
/** @returns {import('vite').Plugin} */
function scenarioContentPlugin() {
  const source = fileURLToPath(new URL('./content/scenarios.md', import.meta.url));
  const script = fileURLToPath(new URL('./scripts/build-scenarios.ts', import.meta.url));
  const tsx = fileURLToPath(new URL('./node_modules/tsx/dist/cli.mjs', import.meta.url));

  return {
    name: 'steering:scenario-content',
    apply: 'serve',
    configureServer(server) {
      server.watcher.add(source);
    },
    handleHotUpdate({ file, server }) {
      if (file !== source) return;
      const result = spawnSync(process.execPath, [tsx, script], { encoding: 'utf8' });
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
      if (result.status === 0) server.config.logger.info(`[scenarios] ${output}`);
      else server.config.logger.error(`[scenarios] validation failed\n${output}`);
    },
  };
}

export default defineConfig({
  site,
  base,
  output: 'static',
  trailingSlash: 'ignore',
  // The showcase lives at the root. `/steering/` was the original route and has been handed out,
  // so it stays as a redirect rather than becoming a dead link.
  // With trailingSlash 'ignore' a single entry covers both /steering and /steering/; declaring
  // both collides.
  redirects: {
    '/steering': '/',
  },
  build: {
    /*
     * Everything the showcase needs lands under `dist/steering/`, so integrating into another
     * site is a single directory copy. It also keeps the output free of a leading-underscore
     * directory, which Jekyll would otherwise exclude from a portfolio repository.
     */
    assets: 'steering/assets',
  },
  integrations: [react()],
  vite: {
    plugins: [tailwindcss(), scenarioContentPlugin()],
  },
});

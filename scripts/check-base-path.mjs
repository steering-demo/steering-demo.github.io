/**
 * Builds and serves the site under a repository-style base path, then checks that every local URL
 * the built HTML references actually resolves there.
 *
 * This is the failure mode that only shows up once a site is served from /<repo>/ instead of a
 * domain root, so it is worth catching in CI rather than in production.
 *
 *   node scripts/check-base-path.mjs [base] [port]
 */
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? '/steering-demo.github.io/';
const PORT = Number(process.argv[3] ?? 4402);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORIGIN = `http://127.0.0.1:${PORT}`;

console.log(`building with BASE_PATH=${BASE}`);
const build = spawnSync('npm', ['run', 'build'], {
  cwd: ROOT,
  env: { ...process.env, BASE_PATH: BASE },
  stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status ?? 1);

// Reuse the same static server the browser tests run against.
const server = spawn(
  process.execPath,
  ['scripts/serve-dist.mjs', '--port', String(PORT), '--base', BASE],
  { cwd: ROOT, stdio: 'ignore' },
);

const failures = [];

try {
  await new Promise((resolve) => setTimeout(resolve, 700));

  for (const path of [BASE, `${BASE}steering/`, `${BASE}steering`]) {
    const response = await fetch(`${ORIGIN}${path}`);
    if (!response.ok) failures.push(`${response.status} ${path}`);
  }

  const html = await (await fetch(`${ORIGIN}${BASE}steering/`)).text();
  // src=/href= attributes, plus the paths Astro writes inside inline module scripts as
  // import("/base/_astro/....js") - those carry the base too and must resolve.
  const urls = new Set([
    ...[...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((match) => match[1]),
    ...[...html.matchAll(/["'`](\/[^"'`\s]*\.(?:js|mjs|css|svg|png|jpg|webp|woff2?|json))["'`]/g)].map(
      (match) => match[1],
    ),
  ]);
  if (urls.size === 0) failures.push('no local asset URLs found in the built page');

  for (const url of urls) {
    if (!url.startsWith(BASE)) {
      failures.push(`URL is missing the base path: ${url}`);
      continue;
    }
    const response = await fetch(`${ORIGIN}${url}`);
    if (!response.ok) failures.push(`${response.status} ${url}`);
  }

  console.log(`checked ${urls.size} local URL(s) plus 3 entry points under ${BASE}`);
} finally {
  server.kill();
}

if (failures.length > 0) {
  console.error('\nbase-path check FAILED:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log('base-path check ok');

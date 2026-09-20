/**
 * Minimal static server for the built site.
 *
 * `astro preview` daemonises, which does not suit Playwright's webServer, and a real server is
 * also the only honest way to check that the build works under a repository-style base path.
 *
 *   node scripts/serve-dist.mjs --port 4321
 *   node scripts/serve-dist.mjs --port 4322 --base /steering-demo.github.io/
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist');

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const port = Number(flag('port', 4321));
const rawBase = flag('base', '/');
const base = rawBase === '/' ? '/' : `/${rawBase.replace(/^\/+|\/+$/g, '')}/`;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function resolveFile(pathname) {
  // Strip the base prefix the same way GitHub Pages serves a project repository.
  let rest = pathname;
  if (base !== '/') {
    if (rest === base.slice(0, -1)) rest = '/';
    else if (rest.startsWith(base)) rest = `/${rest.slice(base.length)}`;
    else return null;
  }

  const safe = normalize(decodeURIComponent(rest)).replace(/^(\.\.[/\\])+/, '');
  const candidate = join(ROOT, safe);
  if (!candidate.startsWith(ROOT)) return null;

  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  // Directory-format output: /steering/ and /steering both resolve to steering/index.html.
  const asIndex = join(candidate, 'index.html');
  if (existsSync(asIndex)) return asIndex;
  const asHtml = `${candidate}.html`;
  if (existsSync(asHtml)) return asHtml;
  return null;
}

const server = createServer((request, response) => {
  const { pathname } = new URL(request.url ?? '/', `http://localhost:${port}`);
  const file = resolveFile(pathname);

  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`404 Not Found: ${pathname}\n`);
    return;
  }

  response.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`serving dist/ at http://127.0.0.1:${port}${base}\n`);
});

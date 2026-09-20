/**
 * Joins a site-root-relative path onto the configured base path.
 *
 * `import.meta.env.BASE_URL` is `/` for a user site and `/repo` (no trailing slash) for a project
 * repository, so neither plain concatenation nor a template literal is safe on its own.
 */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  const left = base.endsWith('/') ? base.slice(0, -1) : base;
  const right = path.startsWith('/') ? path : `/${path}`;
  return `${left}${right}`;
}

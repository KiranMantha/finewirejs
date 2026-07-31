/**
 * finewire/file-routes — the build-time convention that maps files to routes.
 *
 * Convention (relative to a routes/ dir):
 *   index.ts            -> /
 *   about.ts            -> /about
 *   users/index.ts      -> /users
 *   users/[id].ts       -> /users/:id
 *   [org]/settings.ts   -> /:org/settings
 *   blog/[...slug].ts   -> /blog/*slug   (catch-all)
 *
 * In a Vite app you feed it import.meta.glob output:
 *   const modules = import.meta.glob('./routes/∗∗/∗.ts', { eager: true });
 *   const routes  = buildRoutes(modules);
 */

import type { RouteDef, Page } from './router.ts';

export interface PageModule {
  default: Page;
  name?: string;
}

/** Convert a file path (relative to routes/) into a route pattern. */
export function filePathToPattern(file: string): string {
  let p = file
    .replace(/^\.?\/?(?:src\/)?routes\//, '') // strip leading routes/
    .replace(/\.(t|j)sx?$/, '') // strip extension
    .replace(/\/index$/, '') // users/index -> users
    .replace(/^index$/, ''); // index -> ''

  const segs = p
    .split('/')
    .filter(Boolean)
    .map((s) => {
      const catchAll = s.match(/^\[\.\.\.(.+)\]$/);
      if (catchAll) return '*' + catchAll[1];
      const dyn = s.match(/^\[(.+)\]$/);
      if (dyn) return ':' + dyn[1];
      return s;
    });

  return '/' + segs.join('/');
}

/**
 * Build a sorted route table from a glob-style module map.
 */
export function buildRoutes(modules: Record<string, PageModule>): RouteDef[] {
  const defs: RouteDef[] = [];
  for (const [file, mod] of Object.entries(modules)) {
    if (!mod?.default) continue;
    const pattern = filePathToPattern(file);
    defs.push({ pattern, name: mod.name ?? pattern, page: mod.default });
  }
  return defs;
}

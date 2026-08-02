/**
 * finewire/file-routes — the build-time convention that maps files to routes.
 *
 * Convention (relative to a routes/ dir):
 *   index.ts            -> /
 *   about.ts            -> /about
 *   users/index.ts      -> /users
 *   users/[id].ts       -> /users/:id
 *   [org]/settings.ts   -> /:org/settings
 *   blog/[...slug].ts   -> /blog/*slug   (catch-all — captures a real path tail)
 *   404.ts              -> RESERVED: the not-found page. Never added to the
 *                          route table; feed it to createRouter's `notFound`.
 *
 * In a Vite app you feed it import.meta.glob output:
 *   const modules = import.meta.glob('./routes/∗∗/∗.ts', { eager: true });
 *   const routes  = buildRoutes(modules);
 *   const router  = createRouter(routes, { notFound: getNotFound(modules) });
 */

import type { RouteDef, Page, RouteMeta, SyncGuard, AsyncGuard, Guard } from './router.ts';

export interface PageModule {
  default: Page;
  name?: string;
  meta?: RouteMeta;
}

/**
 * A guard.ts module. Declares its mode by WHICH export it uses — never both:
 *   export default (to) => true | { redirect }            // sync
 *   export const guardAsync = async (to) => ...            // async
 */
export interface GuardModule {
  default?: SyncGuard;
  guardAsync?: AsyncGuard;
}

/** A loading.ts module: its default export is shown while an async guard runs. */
export interface LoadingModule {
  default: Page;
}

/** The reserved, protected route-group folder. Everything inside it is guarded. */
export const AUTH_GROUP = '(auth)';

/** Reserved files that are NOT matchable routes. */
const isNotFoundFile = (file: string): boolean => /(^|\/)404\.(t|j)sx?$/.test(file);
const isGuardFile = (file: string): boolean => /(^|\/)guard\.(t|j)sx?$/.test(file);
const isLoadingFile = (file: string): boolean => /(^|\/)loading\.(t|j)sx?$/.test(file);
/** Is this route file inside the reserved (auth) group (at any depth)? */
const isProtectedFile = (file: string): boolean => file.includes('/' + AUTH_GROUP + '/') || file.includes(AUTH_GROUP + '/');

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
    .filter((s) => !/^\(.*\)$/.test(s)) // (group) folders add no URL segment
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
 *
 * Reserved, non-matchable files are handled here:
 *   - 404.ts       → skipped (retrieve via getNotFound)
 *   - guard.ts     → skipped; the (auth)/guard.ts default becomes the guard
 *                    attached to every route inside the reserved (auth) group.
 *
 * Protection is by MEMBERSHIP: any route inside routes/(auth)/ (at any depth)
 * is guarded — no manual enrollment. If (auth)/ contains routes but no
 * guard.ts, that's a loud build-time error, never a silent unprotected hole.
 */
export function buildRoutes(modules: Record<string, PageModule | GuardModule | LoadingModule>): RouteDef[] {
  // Resolve the reserved (auth)/guard.ts into a single-mode descriptor, and
  // pick up (auth)/loading.ts for the async pending state.
  let guard: Guard | undefined;
  let loading: Page | undefined;
  for (const [file, mod] of Object.entries(modules)) {
    if (isGuardFile(file) && isProtectedFile(file)) {
      guard = resolveGuard(file, mod as GuardModule);
    } else if (isLoadingFile(file) && isProtectedFile(file)) {
      loading = (mod as LoadingModule).default;
    }
  }

  const defs: RouteDef[] = [];
  let sawProtectedRoute = false;

  for (const [file, mod] of Object.entries(modules)) {
    if (isGuardFile(file)) continue;     // guard.ts is policy, not a route
    if (isLoadingFile(file)) continue;   // loading.ts is a pending view, not a route
    if (isNotFoundFile(file)) continue;  // 404.ts is a fallback, not a route
    const page = (mod as PageModule).default;
    if (!page) continue;

    const protectedRoute = isProtectedFile(file);
    if (protectedRoute) sawProtectedRoute = true;

    const pattern = filePathToPattern(file);
    defs.push({
      pattern,
      name: (mod as PageModule).name ?? pattern,
      page,
      meta: (mod as PageModule).meta,
      guard: protectedRoute ? guard : undefined,
      loading: protectedRoute ? loading : undefined,
    });
  }

  // loud error: a protected folder MUST have a guard, or it's a silent hole.
  if (sawProtectedRoute && !guard) {
    throw new Error(
      `[finewire] routes/${AUTH_GROUP}/ contains protected routes but no ${AUTH_GROUP}/guard.ts. ` +
      `Add ${AUTH_GROUP}/guard.ts or move those routes out of ${AUTH_GROUP}/.`,
    );
  }

  return defs;
}

/** Resolve a guard.ts module into exactly one mode; reject sync+async mix. */
function resolveGuard(file: string, mod: GuardModule): Guard {
  const hasSync = typeof mod.default === 'function';
  const hasAsync = typeof mod.guardAsync === 'function';
  if (hasSync && hasAsync) {
    throw new Error(
      `[finewire] ${file} exports BOTH a sync guard (default) and an async guard (guardAsync). ` +
      `A guard is one mode or the other — keep exactly one.`,
    );
  }
  if (hasSync) return { mode: 'sync', run: mod.default as SyncGuard };
  if (hasAsync) return { mode: 'async', run: mod.guardAsync as AsyncGuard };
  throw new Error(
    `[finewire] ${file} must export a guard: \`export default\` (sync) OR ` +
    `\`export const guardAsync\` (async).`,
  );
}

/**
 * Find the not-found page (routes/404.ts) in a glob module map, if present.
 * Pass the result to createRouter(routes, { notFound }).
 */
export function getNotFound(modules: Record<string, PageModule | GuardModule>): Page | undefined {
  for (const [file, mod] of Object.entries(modules)) {
    if (isNotFoundFile(file) && (mod as PageModule)?.default) return (mod as PageModule).default;
  }
  return undefined;
}
/**
 * finewire/router — a small file-based router built on the signals core.
 *
 * Design:
 *  - Route params/query/path are SIGNALS. Navigating between two URLs that
 *    resolve to the same route file updates those signals; the page's holes
 *    patch fine-grained and the component is NOT remounted.
 *  - When the matched route file changes, the old page's owner is disposed
 *    (tearing down its effects) and the new page is mounted.
 *  - History is injected, so the router runs under test (memory history) or
 *    server (no window) exactly as it does in the browser.
 */

import {
    signal, computed, effect, createRoot,
    type Component, type Setup,
  } from './index.ts';
  import { defineComponent } from './index.ts';
  
  // -- route context passed to every page ------------------------------------
  
  export type RouteContext = {
    /** Reactive path params, e.g. { id: '42' } for /users/:id. */
    params: () => Record<string, string>;
    /** Reactive query params, e.g. { tab: 'posts' } for ?tab=posts. */
    query: () => Record<string, string>;
    /** Reactive current pathname. */
    path: () => string;
    /** The matched route's name (its pattern), stable for the page's lifetime. */
    name: string;
    /** The matched route's meta (auth flags, roles, titles...). */
    meta: RouteMeta;
    /** Programmatic navigation. */
    navigate: (to: string) => void;
  }

  /** Arbitrary per-route metadata a route file exports alongside `default`. */
  export type RouteMeta = {
    requiresAuth?: boolean;
    roles?: string[];
    [key: string]: unknown;
  }

  /** What a guard sees about the route being entered. */
  export type GuardLocation = {
    path: string;
    params: Record<string, string>;
    query: Record<string, string>;
    name: string | null;
    meta: RouteMeta;
  }

  /** A guard's verdict: allow, or redirect (optionally replacing history). */
  export type GuardResult = true | { redirect: string; replace?: boolean };

  /**
   * SYNC guard — `(auth)/guard.ts` exports this as `default`. Runs INSIDE the
   * reactive effect on EVERY entry to a protected route (never cached), so it
   * tracks the auth signals it reads and re-fires when they change (idle/logout
   * redirect with no navigation). Cannot await — reads a resolved auth signal.
   */
  export type SyncGuard = (to: GuardLocation) => GuardResult;

  /**
   * ASYNC guard — `(auth)/guard.ts` exports this as `guardAsync`. Runs on the
   * async path: a pending state (loading.ts) shows while it resolves, and its
   * verdict is applied only if the navigation is still current (stale
   * resolutions from abandoned navigations are dropped). Use when the decision
   * genuinely requires awaiting per navigation. NOT reactive after the first
   * `await` — read auth signals synchronously up front if you need tracking.
   */
  export type AsyncGuard = (to: GuardLocation) => Promise<GuardResult>;

  /** Back-compat alias: the sync guard shape. */
  export type BeforeEach = SyncGuard;

  /** A guard resolved from a guard.ts module: exactly one mode. */
  export type Guard =
    | { mode: 'sync'; run: SyncGuard }
    | { mode: 'async'; run: AsyncGuard };
  
  /** A route file's default export: a component or a plain setup function. */
  export type Page = Component<RouteContext> | Setup<RouteContext>;
  
  export type RouteDef = {
    pattern: string;            // '/users/:id'  (':name' dynamic, '*name' catch-all)
    name: string;               // usually === pattern
    page: Page;
    meta?: RouteMeta;           // from the route file's `export const meta = {...}`
    guard?: Guard;              // attached to routes inside (auth)/ by buildRoutes
    loading?: Page;             // (auth)/loading.ts — shown while an async guard resolves
  }
  
  // -- matcher ----------------------------------------------------------------
  
  type Compiled = {
    def: RouteDef;
    re: RegExp;
    names: string[];
    score: number;
  }
  
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  function compile(def: RouteDef): Compiled {
    const segs = def.pattern.split('/').filter(Boolean);
    const names: string[] = [];
    let re = '^';
    let score = 0;
    let hasCatchAll = false;
    for (const s of segs) {
      if (s.startsWith('*')) {
        // Catch-all. Matches one-or-more segments here, PLUS optionally the
        // bare parent (so /docs/*path also serves /docs, with path=""). A
        // root-level catch-all (/*x) still won't match "/" because the index
        // route outscores it and (.+) is required when a segment is present.
        names.push(s.slice(1) || 'rest');
        re += '(?:/(.+))?';
        hasCatchAll = true;
      }
      else if (s.startsWith(':')) { names.push(s.slice(1)); re += '/([^/]+)'; score += 20; }
      else { re += '/' + escapeRe(s); score += 30; }
    }
    re += '/?$';
    // A catch-all is always the least specific route — it must sort below the
    // index route (score 0) and every static/dynamic route, so subtract.
    if (hasCatchAll) score -= 1000;
    return { def, re: new RegExp(re), names, score };
  }
  
  /** Compile + sort by specificity (static > dynamic > catch-all). */
  export function buildMatcher(routes: RouteDef[]): Compiled[] {
    return routes.map(compile).sort((a, b) => b.score - a.score);
  }
  
  export function matchRoute(
    compiled: Compiled[],
    path: string,
  ): { def: RouteDef; params: Record<string, string> } | null {
    for (const c of compiled) {
      const m = c.re.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      c.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1] ?? '')));
      return { def: c.def, params };
    }
    return null;
  }
  
  // -- history adapters -------------------------------------------------------
  
  export type History = {
    current(): string;                       // "/path?query"
    push(to: string): void;
    replace(to: string): void;
    subscribe(cb: () => void): () => void;
  }
  
  export function createBrowserHistory(): History {
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach((l) => l());
    window.addEventListener('popstate', notify);
    return {
      current: () => location.pathname + location.search,
      push: (to) => { history.pushState(null, '', to); notify(); },
      replace: (to) => { history.replaceState(null, '', to); notify(); },
      subscribe: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    };
  }
  
  export function createMemoryHistory(initial = '/'): History {
    let cur = initial;
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach((l) => l());
    return {
      current: () => cur,
      push: (to) => { cur = to; notify(); },
      replace: (to) => { cur = to; notify(); },
      subscribe: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    };
  }
  
  // -- router -----------------------------------------------------------------
  
  export type RouterOptions = {
    history?: History;
    /** Rendered when nothing matches. */
    notFound?: Page;
    /** Intercept clicks on internal <a href> and route them. Default true. */
    interceptLinks?: boolean;
  }
  
  export type Router = {
    mount(container: Element): { dispose: () => void };
    navigate: (to: string) => void;
    /** Reactive accessors, also usable outside a page. */
    path: () => string;
    params: () => Record<string, string>;
    query: () => Record<string, string>;
    routeName: () => string | null;
  }
  
  const asComponent = (page: Page): Component<RouteContext> =>
    // A component made by defineComponent is a function; so is a bare setup fn.
    // We can't tell them apart by type, so we always wrap: defineComponent is
    // idempotent enough here because a component IS a valid setup shape only if
    // called — instead we detect by a brand set on defineComponent output.
    (page as any).__isComponent ? (page as Component<RouteContext>)
      : defineComponent<RouteContext>(page as Setup<RouteContext>);
  
  export function createRouter(routes: RouteDef[], opts: RouterOptions = {}): Router {
    const history = opts.history ?? createBrowserHistory();
    const compiled = buildMatcher(routes);
    const notFound = opts.notFound ? asComponent(opts.notFound) : null;
  
    const location = signal(history.current());
    history.subscribe(() => location.set(history.current()));
  
    const parsed = computed(() => {
      const raw = location();
      const qIdx = raw.indexOf('?');
      const path = qIdx === -1 ? raw : raw.slice(0, qIdx);
      const search = qIdx === -1 ? '' : raw.slice(qIdx + 1);
      return { path, search, match: matchRoute(compiled, path || '/') };
    });
  
    const path = computed(() => parsed().path || '/');
    const params = computed(() => parsed().match?.params ?? {});
    const query = computed(() => {
      const out: Record<string, string> = {};
      new URLSearchParams(parsed().search).forEach((v, k) => (out[k] = v));
      return out;
    });
    const routeName = computed(() => parsed().match?.def.name ?? null);
  
    const navigate = (to: string) => history.push(to);
  
    const router: Router = {
      path, params, query, routeName, navigate,
      mount(container) {
        let currentDef: RouteDef | null | undefined;
        let current: { nodes: Node[]; dispose(): void } | null = null;
        // Bumped on every guard evaluation. An async guard captures the value it
        // saw; when its promise resolves, a mismatch means a newer navigation (or
        // auth change) superseded it → the stale result is dropped.
        let guardSeq = 0;

        const swap = createRoot(() => {
          return effect(() => {
            const def = parsed().match?.def ?? null;
            const token = ++guardSeq; // this evaluation's identity

            // Render the matched route (no-op if the route file didn't change).
            const renderDef = () => {
              if (def === currentDef) return;
              currentDef = def;
              current?.dispose();
              container.textContent = '';
              const comp = def ? asComponent(def.page) : notFound;
              if (!comp) return;
              const ctx: RouteContext = {
                params, query, path,
                name: def?.name ?? '(not found)',
                meta: def?.meta ?? {},
                navigate,
              };
              current = comp(ctx);
              current.nodes.forEach((n) => container.appendChild(n));
            };

            const applyRedirect = (r: { redirect: string; replace?: boolean }) => {
              const target = r.redirect;
              if (target === path()) return;                 // already there → no loop
              (r.replace ?? true) ? history.replace(target) : history.push(target);
            };

            // Show the loading.ts pending view (async mode only), replacing the
            // current content until the guard resolves.
            const showPending = () => {
              currentDef = null;                             // force a fresh render after resolve
              current?.dispose();
              container.textContent = '';
              const comp = def?.loading ? asComponent(def.loading) : null;
              if (!comp) return;
              current = comp({ params, query, path, name: def?.name ?? '', meta: def?.meta ?? {}, navigate });
              current.nodes.forEach((n) => container.appendChild(n));
            };

            // 1. guard — a route inside (auth)/ carries a resolved, single-mode
            //    guard descriptor. The MODE is declared (which export guard.ts
            //    used), never sniffed — so behaviour is fully predictable.
            const guard = def?.guard;
            const to: GuardLocation = {
              path: path(),
              params: params(),
              query: query(),
              name: def?.name ?? null,
              meta: def?.meta ?? {},
            };

            if (guard?.mode === 'sync') {
              // Runs inside this effect → reads of auth signals are tracked, so
              // logout/idle re-fires the guard. Never cached.
              const verdict = guard.run(to);
              if (verdict !== true) { applyRedirect(verdict); return; }
            } else if (guard?.mode === 'async') {
              // Out-of-band: show loading.ts, await, and apply the verdict only
              // if this evaluation is still current (drop stale resolutions).
              showPending();
              guard.run(to).then((resolved) => {
                if (token !== guardSeq) return;              // superseded → drop
                if (resolved === true) renderDef();
                else applyRedirect(resolved);
              });
              return; // the .then finishes the job
            }

            // 2. allowed (public or sync-allowed) → render
            renderDef();
          });
        });
  
        // link interception — listen on document so links ANYWHERE (nav bars,
        // layouts, content) are caught, not just those inside the outlet.
        let unlisten: (() => void) | undefined;
        if (opts.interceptLinks !== false) {
          const onClick = (e: MouseEvent) => {
            // let the browser handle modified clicks (new tab, download, etc.)
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            const a = (e.target as Element)?.closest?.('a');
            if (!a) return;
            const href = a.getAttribute('href') ?? '';
            const target = a.getAttribute('target');
            if (
              !href.startsWith('/') ||            // external or hash-only
              href.startsWith('//') ||            // protocol-relative external
              (target && target !== '_self') ||   // opens elsewhere
              a.hasAttribute('download') ||
              a.hasAttribute('data-external')
            ) return;
            e.preventDefault();
            navigate(href);
          };
          const host = container.ownerDocument ?? document;
          host.addEventListener('click', onClick as EventListener);
          unlisten = () => host.removeEventListener('click', onClick as EventListener);
        }
  
        return {
          dispose() {
            unlisten?.();
            swap.dispose();
            current?.dispose();
            container.textContent = '';
          },
        };
      },
    };
    return router;
  }
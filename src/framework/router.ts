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
  
  export interface RouteContext {
    /** Reactive path params, e.g. { id: '42' } for /users/:id. */
    params: () => Record<string, string>;
    /** Reactive query params, e.g. { tab: 'posts' } for ?tab=posts. */
    query: () => Record<string, string>;
    /** Reactive current pathname. */
    path: () => string;
    /** The matched route's name (its pattern), stable for the page's lifetime. */
    name: string;
    /** Programmatic navigation. */
    navigate: (to: string) => void;
  }
  
  /** A route file's default export: a component or a plain setup function. */
  export type Page = Component<RouteContext> | Setup<RouteContext>;
  
  export interface RouteDef {
    pattern: string;            // '/users/:id'  (':name' dynamic, '*name' catch-all)
    name: string;               // usually === pattern
    page: Page;
  }
  
  // -- matcher ----------------------------------------------------------------
  
  interface Compiled {
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
  
  export interface History {
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
  
  export interface RouterOptions {
    history?: History;
    /** Rendered when nothing matches. */
    notFound?: Page;
    /** Intercept clicks on internal <a href> and route them. Default true. */
    interceptLinks?: boolean;
  }
  
  export interface Router {
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
  
        const swap = createRoot(() => {
          // This effect fires on every navigation, but only re-renders when the
          // matched route FILE changes. Same-file param changes flow through the
          // reactive params()/query() signals into the live page's holes.
          return effect(() => {
            const def = parsed().match?.def ?? null;
            if (def === currentDef) return;
            currentDef = def;
            current?.dispose();
            container.textContent = '';
  
            const comp = def ? asComponent(def.page) : notFound;
            if (!comp) return; // silent blank on unmatched with no notFound
            const ctx: RouteContext = {
              params, query, path,
              name: def?.name ?? '(not found)',
              navigate,
            };
            current = comp(ctx);
            current.nodes.forEach((n) => container.appendChild(n));
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
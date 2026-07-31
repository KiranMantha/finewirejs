/**
 * finewire/component — components, lifecycle, For/Show.
 * @packageDocumentation
 */

/**
 * Component layer for the signals + tagged-template core.
 *
 * A component's setup function runs EXACTLY ONCE. It returns a template; every
 * dynamic hole owns an effect, so updates patch individual DOM nodes and setup
 * never re-runs. This is the core difference from React's re-execute-and-diff.
 *
 * Each component owns a reactive scope (createRoot), so disposing it stops all
 * effects created inside it and runs its onCleanup callbacks — depth first.
 */

import { createRoot, onCleanup as coreOnCleanup, runWithOwner, getOwner } from './signals';
import { instantiate, type TemplateResult } from './template';

// -- types ------------------------------------------------------------------

export interface Ctx {
  /** Runs after the component's nodes exist. Return a fn to clean up. */
  onMount(fn: () => void | (() => void)): void;
  /** Runs when the component is disposed. */
  onCleanup(fn: () => void): void;
}

export type Setup<P> = (props: P, ctx: Ctx) => TemplateResult;

export interface ComponentInstance {
  nodes: Node[];
  dispose(): void;
}

/**
 * What defineComponent returns. If the component has no required props, it's
 * callable with no arguments: `Card()` instead of `Card({})`.
 */
export type Component<P> = {} extends P
  ? (props?: P) => ComponentInstance
  : (props: P) => ComponentInstance;

// -- defineComponent --------------------------------------------------------

export function defineComponent<P = {}>(setup: Setup<P>): Component<P> {
  const factory = (props?: P) => {
    const p = (props ?? {}) as P;
    const mounts: Array<() => void> = [];
    let owner: unknown = null;

    const ctx: Ctx = {
      onMount: (fn) =>
        mounts.push(() => {
          const c = fn();
          if (typeof c === 'function') coreOnCleanup(c);
        }),
      onCleanup: (fn) => coreOnCleanup(fn),
    };

    const { value, dispose } = createRoot(() => {
      owner = getOwner();                 // capture so lifecycle re-enters this scope
      const tpl = setup(p, ctx);          // ← runs ONCE, ever
      return instantiate(tpl);            // holes wire their own effects here
    });

    // onMount fires after nodes exist, re-entering the component's owner so any
    // cleanup it registers is tied to this component.
    if (mounts.length) {
      queueMicrotask(() => runWithOwner(owner, () => mounts.forEach((m) => m())));
    }

    return { nodes: value, dispose };
  };
  (factory as { __isComponent?: boolean }).__isComponent = true;
  return factory as Component<P>;
}

// -- control flow -----------------------------------------------------------

type Renderable = ComponentInstance | Node | TemplateResult;

const isInstance = (x: unknown): x is ComponentInstance =>
  !!x && typeof x === 'object' && 'nodes' in (x as object) && 'dispose' in (x as object);

/**
 * Keyed list. Use inside a template hole:
 *   ${For(todos, t => t.id, t => TodoItem({ todo: t }))}
 * Instances are created once per key and reused across updates; removed keys
 * are disposed. No manual node caching in app code.
 */
export function For<T>(
  list: () => T[],
  keyOf: (item: T, index: number) => unknown,
  render: (item: T, index: number) => Renderable,
): () => Node[] {
  const owner = getOwner();               // captured during setup
  const cache = new Map<unknown, { nodes: Node[]; dispose?: () => void }>();

  return () => {
    const items = list() ?? [];
    const seen = new Set<unknown>();
    const out: Node[] = [];

    items.forEach((item, i) => {
      const key = keyOf(item, i);
      seen.add(key);
      let entry = cache.get(key);
      if (!entry) {
        // create inside the component's owner so app dispose cascades
        entry = runWithOwner(owner, () => {
          const r = render(item, i);
          if (isInstance(r)) return { nodes: r.nodes, dispose: r.dispose };
          if (r instanceof Node) return { nodes: [r] };
          const { value, dispose } = createRoot(() => instantiate(r as TemplateResult));
          return { nodes: value, dispose };
        });
        cache.set(key, entry);
      }
      out.push(...entry.nodes);
    });

    for (const [key, entry] of cache) {
      if (!seen.has(key)) {
        entry.dispose?.();
        entry.nodes.forEach((n) => (n as ChildNode).parentNode?.removeChild(n));
        cache.delete(key);
      }
    }
    return out;
  };
}

/** Conditional block: ${Show(() => isOpen(), () => html`<p>hi</p>`)} */
export function Show(cond: () => unknown, render: () => TemplateResult | null): () => Node[] {
  const owner = getOwner();
  let cached: { nodes: Node[]; dispose: () => void } | null = null;

  return () => {
    if (cond()) {
      if (!cached) {
        cached = runWithOwner(owner, () => {
          const tpl = render();
          if (!tpl) return { nodes: [] as Node[], dispose: () => {} };
          const { value, dispose } = createRoot(() => instantiate(tpl));
          return { nodes: value, dispose };
        });
      }
      return cached.nodes;
    }
    if (cached) { cached.dispose(); cached = null; }
    return [];
  };
}

// -- app root ---------------------------------------------------------------

export interface AppHandle { dispose(): void; }

/** Mount a component (from defineComponent) into a container element. */
export function mount(componentInstance: ComponentInstance, container: Element): AppHandle {
  container.textContent = '';
  componentInstance.nodes.forEach((n) => container.appendChild(n));
  return {
    dispose() {
      componentInstance.dispose();
      container.textContent = '';
    },
  };
}
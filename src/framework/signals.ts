/**
 * A minimal, framework-agnostic signals runtime.
 * Push-based invalidation + pull-based (lazy, memoized) evaluation.
 */

// ---------------------------------------------------------------------------
// Core graph
// ---------------------------------------------------------------------------

export type Equal<T> = (a: T, b: T) => boolean;
const defaultEqual = <T>(a: T, b: T): boolean => Object.is(a, b);

const State = {
  /** value is up to date */
  Clean: 0,
  /** a *transitive* dependency may have changed — must poll before trusting */
  Check: 1,
  /** a *direct* dependency definitely changed — must recompute */
  Dirty: 2,
} as const;
type State = (typeof State)[keyof typeof State];

/** The ambient consumer. This single variable is the whole magic trick. */
let activeConsumer: ReactiveNode | null = null;

let batchDepth = 0;
const scheduled = new Set<EffectNode>();
let flushQueued = false;

abstract class ReactiveNode {
  /** Producer role: bumped ONLY when the value actually changes. */
  version = 0;

  /** Consumer role. */
  state: State = State.Clean;

  /** producer -> version of that producer when we last read it */
  readonly producers = new Map<ReactiveNode, number>();

  /** nodes that read us */
  readonly consumers = new Set<ReactiveNode>();

  /** Consumer hook: "something upstream moved". */
  protected onDirty(): void {}

  /** Producer hook: bring `version`/value up to date. Must end Clean. */
  protected recompute(): void {}

  // -- producer side --------------------------------------------------------

  /** Record the edge activeConsumer -> this. Call AFTER version is current. */
  protected trackRead(): void {
    const c = activeConsumer;
    if (c !== null) {
      c.producers.set(this, this.version);
      this.consumers.add(c);
    }
  }

  protected notifyConsumers(state: State): void {
    for (const c of this.consumers) {
      if (c.state === State.Clean) {
        c.state = state;
        c.onDirty();
        // everything further downstream is only *maybe* stale
        c.notifyConsumers(State.Check);
      } else if (c.state === State.Check && state === State.Dirty) {
        c.state = State.Dirty;
        // descendants are already >= Check, no need to re-walk
      }
    }
  }

  // -- consumer side --------------------------------------------------------

  /** Pull: make sure this node's value/version is trustworthy. */
  updateIfNecessary(): void {
    if (this.state === State.Check) {
      for (const [producer, seenVersion] of this.producers) {
        producer.updateIfNecessary();
        if (producer.version !== seenVersion) {
          this.state = State.Dirty;
          break;
        }
      }
      if (this.state === State.Check) this.state = State.Clean;
    }
    if (this.state === State.Dirty) this.recompute();
  }

  /** Run `fn` with `this` as the ambient consumer, re-recording dependencies. */
  protected runInContext<T>(fn: () => T): T {
    for (const p of this.producers.keys()) p.consumers.delete(this);
    this.producers.clear();

    const prev = activeConsumer;
    activeConsumer = this;
    try {
      return fn();
    } finally {
      activeConsumer = prev;
    }
  }

  protected unlink(): void {
    for (const p of this.producers.keys()) p.consumers.delete(this);
    this.producers.clear();
  }
}

// ---------------------------------------------------------------------------
// signal()
// ---------------------------------------------------------------------------

class SignalNode<T> extends ReactiveNode {
  constructor(private value: T, private readonly equal: Equal<T>) {
    super();
  }

  get(): T {
    this.trackRead();
    return this.value;
  }

  set(next: T): void {
    if (this.equal(this.value, next)) return; // pruning: identical write = no-op
    this.value = next;
    this.version++;
    this.notifyConsumers(State.Dirty);
    flush();
  }

  peek(): T {
    return this.value;
  }
}

export interface ReadonlySignal<T> {
  (): T;
  peek(): T;
}
export interface WritableSignal<T> extends ReadonlySignal<T> {
  set(value: T): void;
  update(fn: (current: T) => T): void;
  asReadonly(): ReadonlySignal<T>;
}

export function signal<T>(
  initial: T,
  opts: { equal?: Equal<T> } = {}
): WritableSignal<T> {
  const node = new SignalNode(initial, opts.equal ?? defaultEqual);
  const fn = (() => node.get()) as WritableSignal<T>;
  (fn as any).__isSignal = true;
  fn.peek = () => node.peek();
  fn.set = (v: T) => node.set(v);
  fn.update = (f: (c: T) => T) => node.set(f(node.peek()));
  fn.asReadonly = () => {
    const ro = (() => node.get()) as ReadonlySignal<T>;
    ro.peek = () => node.peek();
    (ro as any).__isSignal = true;
    return ro;
  };
  return fn;
}

// ---------------------------------------------------------------------------
// computed()
// ---------------------------------------------------------------------------

const UNSET = Symbol('unset');
const ERRORED = Symbol('errored');

class ComputedNode<T> extends ReactiveNode {
  private value: T | typeof UNSET | typeof ERRORED = UNSET;
  private error: unknown = null;

  constructor(private readonly fn: () => T, private readonly equal: Equal<T>) {
    super();
    this.state = State.Dirty;
  }

  protected recompute(): void {
    let next: T | typeof ERRORED;
    try {
      next = this.runInContext(this.fn);
      this.error = null;
    } catch (e) {
      next = ERRORED;
      this.error = e;
    }
    this.state = State.Clean;

    const same =
      this.value !== UNSET &&
      this.value !== ERRORED &&
      next !== ERRORED &&
      this.equal(this.value as T, next as T);

    this.value = next;
    // Bump only on real change — this is what stops the cascade and
    // prevents "glitches" from reaching effects.
    if (!same) this.version++;
  }

  get(): T {
    this.updateIfNecessary();
    this.trackRead(); // AFTER update, so consumers record the fresh version
    if (this.value === ERRORED) throw this.error;
    return this.value as T;
  }
}

export function computed<T>(
  fn: () => T,
  opts: { equal?: Equal<T> } = {}
): ReadonlySignal<T> {
  const node = new ComputedNode(fn, opts.equal ?? defaultEqual);
  const out = (() => node.get()) as ReadonlySignal<T>;
  (out as any).__isSignal = true;
  out.peek = () => untracked(() => node.get());
  return out;
}

// ---------------------------------------------------------------------------
// effect()
// ---------------------------------------------------------------------------

export type CleanupFn = () => void;
export type EffectFn = (onCleanup: (fn: CleanupFn) => void) => void;

class EffectNode extends ReactiveNode {
  private cleanup: CleanupFn | null = null;
  private destroyed = false;

  constructor(private readonly fn: EffectFn) {
    super();
    this.state = State.Dirty;
    schedule(this);
  }

  protected onDirty(): void {
    if (!this.destroyed) schedule(this);
  }

  protected recompute(): void {
    this.runCleanup();
    this.state = State.Clean;
    this.runInContext(() => this.fn((c) => (this.cleanup = c)));
  }

  run(): void {
    if (this.destroyed) return;
    this.updateIfNecessary(); // may decide nothing actually changed → no run
  }

  private runCleanup(): void {
    const c = this.cleanup;
    this.cleanup = null;
    c?.();
  }

  destroy(): void {
    this.destroyed = true;
    scheduled.delete(this);
    this.runCleanup();
    this.unlink();
  }
}

export interface EffectRef {
  destroy(): void;
}

export function effect(fn: EffectFn): EffectRef {
  const node = new EffectNode(fn);
  const ref = { destroy: () => node.destroy() };
  currentOwner?.cleanups.push(ref.destroy); // torn down when the owner disposes
  return ref;
}

// ---------------------------------------------------------------------------
// Ownership / cleanup tree
//
// An "owner" collects the effects and cleanup callbacks created within it.
// Components create an owner; disposing it stops every descendant effect and
// runs onCleanup callbacks — depth-first — so unmounting never leaks.
// ---------------------------------------------------------------------------

interface Owner {
  cleanups: Array<() => void>;
  children: Owner[];
}
let currentOwner: Owner | null = null;

/** Run `fn` inside a fresh owner; returns the result plus a dispose handle. */
export function createRoot<T>(fn: (dispose: () => void) => T): {
  value: T;
  dispose: () => void;
} {
  const owner: Owner = { cleanups: [], children: [] };
  currentOwner?.children.push(owner);
  const dispose = () => disposeOwner(owner);
  const prev = currentOwner;
  currentOwner = owner;
  try {
    return { value: fn(dispose), dispose };
  } finally {
    currentOwner = prev;
  }
}

function disposeOwner(o: Owner): void {
  for (const c of o.children) disposeOwner(c);
  o.children.length = 0;
  for (let i = o.cleanups.length - 1; i >= 0; i--) o.cleanups[i]();
  o.cleanups.length = 0;
}

/** Register a callback to run when the current owner disposes. */
export function onCleanup(fn: () => void): void {
  currentOwner?.cleanups.push(fn);
}

/** Run `fn` with a specific owner active (used to attach child effects). */
export function runWithOwner<T>(owner: unknown, fn: () => T): T {
  const prev = currentOwner;
  currentOwner = owner as Owner;
  try {
    return fn();
  } finally {
    currentOwner = prev;
  }
}

/** The current owner, to re-enter later (e.g. inside an async boundary). */
export const getOwner = (): unknown => currentOwner;

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

function schedule(node: EffectNode): void {
  scheduled.add(node);
  if (batchDepth === 0 && !flushQueued) {
    flushQueued = true;
    queueMicrotask(() => {
      flushQueued = false;
      flush();
    });
  }
}

function flush(): void {
  if (batchDepth > 0) return;
  let guard = 0;
  while (scheduled.size > 0) {
    if (++guard > 1000) throw new Error('effect loop: too many flush passes');
    const batch = [...scheduled];
    scheduled.clear();
    for (const e of batch) e.run();
  }
}

/** Run `fn`, deferring all effects until it returns. */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    flush();
  }
}

/** Read signals without registering dependencies. */
export function untracked<T>(fn: () => T): T {
  const prev = activeConsumer;
  activeConsumer = null;
  try {
    return fn();
  } finally {
    activeConsumer = prev;
  }
}

/** Force pending effects to run now (useful in tests / SSR). */
export function flushSync(): void {
  flush();
}

/** True if v is a signal/computed accessor. */
export const isSignal = (v: unknown): v is () => unknown =>
  typeof v === 'function' && (v as any).__isSignal === true;

/** Read a value, auto-calling it if it's a signal. */
export const unwrap = (v: unknown): unknown =>
  isSignal(v) ? (v as () => unknown)() : v;

// ---------------------------------------------------------------------------
// Reactive bindings
//
// The bridge between the graph and any sink (DOM, canvas, logging...). Renderers
// use these instead of touching `effect` directly, so all reactivity policy —
// what counts as reactive, how a value is read, when an effect is created —
// lives here rather than being duplicated in each renderer.
// ---------------------------------------------------------------------------

/**
 * True if `v` is a reactive accessor: a signal, a computed, or any arrow
 * expression that reads them (`() => a() * 2`). Calling it inside an effect is
 * what registers the dependency.
 */
export const isReactive = (v: unknown): v is () => unknown =>
  typeof v === 'function';

/** Read a value once, invoking it if it is an accessor. */
export const resolve = (v: unknown): unknown =>
  isReactive(v) ? (v as () => unknown)() : v;

/**
 * Connect a computation to a sink.
 *
 * If any input is reactive, `apply(compute())` runs inside an effect, so the
 * sink re-runs whenever the signals read by `compute` change. If nothing is
 * reactive, it applies once and creates no graph node at all — static content
 * costs nothing.
 */
export function bind<T>(
  inputs: readonly unknown[],
  compute: () => T,
  apply: (value: T) => void
): void {
  if (inputs.some(isReactive)) effect(() => apply(compute()));
  else apply(compute());
}

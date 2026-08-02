# Finewire

**A tiny signals-based UI framework with fine-grained reactivity — no virtual DOM, no re-renders.**

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![size](https://img.shields.io/badge/core-~3.7KB%20gzip-brightgreen.svg)
![types](https://img.shields.io/badge/TypeScript-strict-blue.svg)

[Wiki & Docs](https://github.com/KiranMantha/finewire/wiki) · [Getting Started](https://github.com/KiranMantha/finewire/wiki/Getting-Started)

</div>

---

Finewire is a small framework for building single-page apps. A component's setup runs **once**; a state change patches only the specific DOM nodes that depend on it. There's no virtual DOM, no diffing, and no component re-execution — which means no `useMemo`, no `useCallback`, no dependency arrays, and nothing to memoize.

```ts
import { signal, html, defineComponent, mount } from './framework';

const Counter = defineComponent(() => {
  const count = signal(0);
  return html`
    <button onclick=${() => count.set(count() + 1)}>+1</button>
    <p>Count: ${() => count()}</p>
  `;
});

mount(Counter(), document.getElementById('root')!);
```

Clicking `+1` updates the `<p>` — it does **not** re-run `Counter`. The body executes a single time to wire signals to nodes; after that, writes flow straight to the DOM.

## Why finewire

- **No re-renders.** The component function runs once. State changes patch nodes directly, so the whole class of "why is this re-rendering?" problems — and the hooks that exist to tame them — simply don't apply.
- **Fine-grained by default.** Only the exact hole that reads a changed signal updates. The rest of the DOM is untouched.
- **One rule, not a hook zoo.** A template hole is *live* if you give it a function, *frozen* if you give it a value. That single idea replaces the dependency-array apparatus.
- **Tiny.** ~3.7KB gzipped core, ~6.4KB with the router.
- **Standard HTML.** Tagged template literals — no JSX, no compile step, no directives polluting your markup.
- **File-based routing** built in, with dynamic params, catch-alls, and folder-based auth guards.
- **Strict TypeScript** throughout.

## Core concepts

### Signals — reactive state

```ts
const count = signal(0);
count();                     // read
count.set(5);                // write
count.update(n => n + 1);    // write from current

const doubled = computed(() => count() * 2);   // derived, memoized

effect(() => console.log(count()));            // side effect, auto-tracked
```

`signal` for state you own, `computed` for state you derive, `effect` for things that happen. No dependency arrays — effects and computeds subscribe to exactly what they read.

### Templates — the one rule

A hole is reactive if it's a **function**, static if it's a **value**:

```ts
html`<p>${count()}</p>`         // ❌ frozen — the value, set once
html`<p>${() => count()}</p>`   // ✅ live — updates when count changes
```

This is the single most important thing to learn. If something isn't updating, it's almost always a missing `() =>`.

### Components

```ts
const Greeting = defineComponent<{ name: string }>(({ name }, { onMount, onUnmount }) => {
  onMount(() => console.log('mounted'));
  return html`<h1>Hello, ${name}!</h1>`;
});
```

Setup runs once. Props that change over time are passed as accessors (functions); static props are plain values. Lifecycle is `onMount` / `onUnmount`.

### Routing

Files in `src/routes/` become URLs:

```
routes/
  index.ts            → /
  about.ts            → /about
  users/[id].ts       → /users/:id
  docs/[...slug].ts   → /docs/*   (catch-all)
  404.ts              → not-found page
```

```ts
// routes/users/[id].ts
export default (ctx) => html`<h1>User ${() => ctx.params().id}</h1>`;
```

```ts
// main.ts
const modules = import.meta.glob('./routes/**/*.ts', { eager: true });
createRouter(buildRoutes(modules), { notFound: getNotFound(modules) })
  .mount(document.getElementById('root')!);
```

Route params are signals — navigating `/users/1` → `/users/2` updates the param without remounting the page.

### Protected routes

Drop a file in the reserved `(auth)/` folder and it's protected — no list to maintain:

```
routes/
  login.ts              → public
  (auth)/
    guard.ts            → the guard for everything below
    dashboard.ts        → protected
    admin.ts            → protected (+ roles via meta)
```

```ts
// routes/(auth)/guard.ts
export default (to) => {
  if (!isLoggedIn()) return { redirect: `/login?next=${to.path}` };
  if (to.meta.roles && !to.meta.roles.some(hasRole)) return { redirect: '/403' };
  return true;
};
```

Guards run on every entry, never cached, and re-fire reactively when auth state changes (log out and you're redirected off a protected page with no navigation). Sync and async guards are both supported. **Route guards are UX, not security** — enforce real access control on your server.

## Getting started

```bash
git clone https://github.com/KiranMantha/finewirejs.git
cd finewirejs
npm install
npm run dev
```

The framework source lives in `src/framework/`; your app code lives alongside it in `src/`. See the [Getting Started guide](https://github.com/KiranMantha/finewirejs/wiki/Getting-Started) for project layout, TypeScript config, and the recommended path alias.

## Documentation

Full documentation is in the **[Wiki](https://github.com/KiranMantha/finewirejs/wiki)**:

| | |
|---|---|
| [Signals](https://github.com/KiranMantha/finewirejs/wiki/Signals) | `signal`, `computed`, `effect`, and when to use each |
| [Templates & Reactivity](https://github.com/KiranMantha/finewirejs/wiki/Templates-and-Reactivity) | the values-vs-functions rule, events, control flow |
| [Components](https://github.com/KiranMantha/finewirejs/wiki/Components) | props, lifecycle, composition |
| [Routing](https://github.com/KiranMantha/finewirejs/wiki/Routing) | file conventions, params, navigation |
| [Guards & Auth](https://github.com/KiranMantha/finewirejs/wiki/Guards-and-Auth) | protected routes, sync/async guards, roles |
| [Mental Model vs React](https://github.com/KiranMantha/finewirejs/wiki/Mental-Model-vs-React) | what replaces hooks |
| [API Reference](https://github.com/KiranMantha/finewirejs/wiki/API-Reference) | every export |

## How it compares

If you know React: Finewire keeps the component-and-props model but removes the re-render. That deletes an entire category of concerns.

| React | Finewire |
|---|---|
| `useState` | `signal` |
| `useMemo` | `computed` |
| `useEffect(fn, [deps])` | `effect(fn)` — auto-tracked, no deps array |
| `useEffect(fn, [])` | `onMount(fn)` |
| `useCallback` / `React.memo` | *(not needed — nothing re-runs)* |
| `useContext` + provider | a module-level `signal` |

The trade: you learn one rule (live holes are functions, frozen holes are values) instead of a set of optimization hooks. The default path is already the fast one.

## Project scripts

```bash
npm run dev       # start the Vite dev server
npm run build     # type-check and build
npm run preview   # preview the production build
```

## Status

Finewire is in active development (v0.1.x). The reactive core, templating, components, and router are stable and tested. Server-side rendering works for first paint; full hydration is experimental. See the [FAQ](https://github.com/KiranMantha/finewirejs/wiki/Gotchas-and-FAQ#ssr-and-hydration) for details.

## License

[MIT](./LICENSE) © [Kiran Mantha](https://github.com/KiranMantha)
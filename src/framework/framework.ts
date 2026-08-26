/** Public API. */
export {
  signal,
  computed,
  effect,
  batch,
  untracked,
  flushSync,
  createRoot,
  onCleanup,
  getOwner,
  runWithOwner,
  isSignal,
  unwrap,
  isReactive,
  resolve,
  bind,
  type WritableSignal,
  type ReadonlySignal,
} from './signals.ts';
export {
  html,
  render,
  instantiate,
  setDev,
  type TemplateResult,
} from './template.ts';
export {
  defineComponent,
  mount,
  For,
  Show,
  type Ctx,
  type Setup,
  type Component,
  type ComponentInstance,
  type AppHandle,
} from './component.ts';
export {
  createRouter,
  createBrowserHistory,
  createMemoryHistory,
  buildMatcher,
  matchRoute,
  type GuardLocation,
  type GuardResult,
  type Router,
  type RouterOptions,
  type RouteDef,
  type RouteContext,
  type Page,
  type History,
} from './router.ts';
export {
  buildRoutes,
  getNotFound,
  filePathToPattern,
  type PageModule,
} from './file-routes.ts';

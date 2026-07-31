import {
  createRouter,
  buildRoutes,
  getNotFound,
  mount,
  defineComponent,
  html,
  type PageModule,
} from './framework';

const modules = import.meta.glob('./routes/**/*.ts', { eager: true }) as Record<
  string,
  PageModule
>;

const routes = buildRoutes(modules);
const notFound = getNotFound(modules);

const router = createRouter(routes, { notFound });

const Shell = defineComponent<{ outlet: Element }>(
  ({ outlet }) => html`
  <nav>
    <a href="/">Home</a>
    <a href="/users">Users</a>
    <a href="/about">About</a>
    <a href="/docs/guide">/docs/guide</a>
    <a href="/docs/guide/routing">/docs/guide/routing</a>
    <a href="/docs/api/signal">/docs/api/signal</a>
    <a href="/docs/does/not/exist">/docs/does/not/exist</a>
  </nav>
  ${outlet}`
);

const outlet = document.createElement('div');
mount(Shell({ outlet }), document.getElementById('root')!);

router.mount(outlet);

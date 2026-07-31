import {
  createRouter,
  buildRoutes,
  mount,
  defineComponent,
  html,
  type PageModule,
} from './framework';

const modules = import.meta.glob('./routes/**/*.ts', { eager: true }) as Record<
  string,
  PageModule
>;
const router = createRouter(buildRoutes(modules));

const Shell = defineComponent<{ outlet: Element }>(
  ({ outlet }) => html`
  <nav>
    <a href="/">Home</a>
    <a href="/users">Users</a>
    <a href="/about">About</a>
  </nav>
  ${outlet}`
);

const outlet = document.createElement('div');
mount(Shell({ outlet }), document.getElementById('root')!);
router.mount(outlet);

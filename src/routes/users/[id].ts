import { html, type RouteContext } from '../../framework';

export default (ctx: RouteContext) => {
  const id = () => ctx.params().id;
  const tab = () => ctx.query().tab ?? 'profile';
  return html`
    <section>
      <a href="/users">← all users</a>
      <h1>User ${() => id()}</h1>
      <p>route: ${ctx.name} · tab: ${() => tab()}</p>
    </section>`;
};

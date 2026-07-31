import { html, computed, type RouteContext } from '../../framework';

export default (ctx: RouteContext) => {
  // param name MUST match the filename: [...slug] -> ctx.params().slug
  const slug = () => ctx.params().slug ?? '';                       // "guide/routing"
  const segments = computed(() => slug().split('/').filter(Boolean).join(',')); // ["guide","routing"]

  // every dynamic value in the template is wrapped in () => so it's reactive
  return html`
    <p>${segments}</p>
  `;
};
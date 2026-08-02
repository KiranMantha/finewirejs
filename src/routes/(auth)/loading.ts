// (auth)/loading.ts — the pending view shown while an ASYNC guard resolves.
// Ignored entirely by sync guards (they never pend). Not a route itself.
import { html, type RouteContext } from '../../framework';
export default (_ctx: RouteContext) => html`<p>Checking access…</p>`;
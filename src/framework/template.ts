/**
 * finewire/template — fine-grained tagged-template renderer.
 * @packageDocumentation
 */

/**
 * A tiny fine-grained template-literal renderer built on the signals core.
 *
 * Thesis: `html` parses ONCE per call site. Dynamic holes that receive a
 * *function* (a signal reader / accessor) are wired to their own `effect`,
 * so a signal write patches exactly that DOM node -- no re-render, no VDOM diff.
 *
 * Conventions (Solid-style):
 *   ${count}            -> reactive if it's a function accessor
 *   ${() => a() * 2}    -> reactive derived expression
 *   ${"static"}         -> written once, never tracked
 *   class=${fn}         -> reactive attribute
 *   ?disabled=${fn}     -> reactive boolean attribute
 *   .value=${fn}        -> reactive property
 *   @click=${handler}   -> event listener (NOT reactive)
 */

import { bind, resolve } from './signals';
import { assertTemplate } from './validate';

/** Dev flag: when true, html`` templates are structurally validated once per
 *  call site and throw a located error if malformed. Set false in production. */
export let DEV = true;
export const setDev = (on: boolean): void => { DEV = on; };

const M0 = '\uFFFF';
const marker = (i: number) => `${M0}${i}${M0}`;
const markerRe = /\uFFFF(\d+)\uFFFF/g;

export interface TemplateResult {
  readonly _strings: TemplateStringsArray;
  readonly _values: unknown[];
  key?: unknown;
}
const isResult = (v: unknown): v is TemplateResult =>
  !!v && typeof v === 'object' && '_strings' in (v as object);

const validated = new WeakSet<TemplateStringsArray>();

export function html(strings: TemplateStringsArray, ...values: unknown[]): TemplateResult {
  if (DEV && !validated.has(strings)) {
    validated.add(strings);      // once per call site, then free
    assertTemplate(strings);     // throws a located SyntaxError on malformed markup
  }
  return { _strings: strings, _values: values };
}
export function keyed(k: unknown, result: TemplateResult): TemplateResult {
  result.key = k;
  return result;
}

// -- compile (once per call site, cached by strings identity) ---------------

type AttrPart = {
  kind: 'attr' | 'bool' | 'prop' | 'event' | 'auto';
  el: Element;
  index: number;
  name: string;
  template: string;
  holes: number[];
};
type ChildDef = { index: number; hole: number };
type Compiled = { content: DocumentFragment; attrDefs: Omit<AttrPart, 'el'>[]; childDefs: ChildDef[] };

const cache = new WeakMap<TemplateStringsArray, Compiled>();

function* dfs(node: Node): Generator<Node> {
  yield node;
  for (const child of Array.from(node.childNodes)) yield* dfs(child);
}
function flatIndex(frag: DocumentFragment): Node[] {
  const out: Node[] = [];
  for (const child of Array.from(frag.childNodes)) for (const n of dfs(child)) out.push(n);
  return out;
}

function compile(strings: TemplateStringsArray): Compiled {
  const hit = cache.get(strings);
  if (hit) return hit;

  if (DEV) assertTemplate(strings); // located error on malformed markup, once per call site

  let src = strings[0];
  for (let i = 0; i < strings.length - 1; i++) src += marker(i) + strings[i + 1];

  const tpl = document.createElement('template');
  tpl.innerHTML = src;
  const content = tpl.content;

  // Pass 1: collect attribute parts (keep element ref) + text nodes to split.
  const attrs: AttrPart[] = [];
  const texts: Text[] = [];
  for (const node of flatIndex(content)) {
    if (node.nodeType === 1) {
      const el = node as Element;
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name;
        const value = attr.value;
        const special = name[0] === '@' || name[0] === '.' || name[0] === '?';
        if (!special && !value.includes(M0)) continue;

        const holes: number[] = [];
        let m: RegExpExecArray | null;
        markerRe.lastIndex = 0;
        while ((m = markerRe.exec(value))) holes.push(Number(m[1]));

        let kind: AttrPart['kind'] = 'auto';
        let clean = name;
        if (name[0] === '@') { kind = 'event'; clean = name.slice(1); }
        else if (name[0] === '.') { kind = 'prop'; clean = name.slice(1); }
        else if (name[0] === '?') { kind = 'bool'; clean = name.slice(1); }
        // NOTE: every dynamic attribute (incl. on*) is removed from the compiled
        // template below, so a marker can never survive as an inline handler.

        attrs.push({ kind, el, index: -1, name: clean, template: value, holes });
        el.removeAttribute(name);
      }
    } else if (node.nodeType === 3 && (node as Text).data.includes(M0)) {
      texts.push(node as Text);
    }
  }

  // Pass 2: split text nodes -> text + comment markers.
  const childMarks: { comment: Comment; hole: number }[] = [];
  for (const node of texts) {
    const parent = node.parentNode!;
    const parts = node.data.split(markerRe);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        if (parts[i]) parent.insertBefore(document.createTextNode(parts[i]), node);
      } else {
        const c = document.createComment('');
        parent.insertBefore(c, node);
        childMarks.push({ comment: c, hole: Number(parts[i]) });
      }
    }
    parent.removeChild(node);
  }

  // Pass 3: final DFS indexing (elements never moved, so their identity holds).
  const nodes = flatIndex(content);
  const idx = new Map<Node, number>();
  nodes.forEach((n, i) => idx.set(n, i));

  const attrDefs = attrs.map(({ el, kind, name, template, holes }) => ({
    kind, name, template, holes, index: idx.get(el)!,
  }));
  const childDefs = childMarks.map(({ comment, hole }) => ({ index: idx.get(comment)!, hole }));

  const compiled: Compiled = { content, attrDefs, childDefs };
  cache.set(strings, compiled);
  return compiled;
}

// -- instantiate ------------------------------------------------------------

// Attributes that must stay attributes even though a same-named property exists.
const ALWAYS_ATTR = new Set(['class', 'style', 'role', 'is', 'list', 'form']);
// Properties that must be set as properties (live state, not just defaults).
const ALWAYS_PROP = new Set(['value', 'checked', 'selected', 'indeterminate', 'muted', 'srcObject', 'files']);

/** Set a value the way plain HTML/DOM would expect, with no special syntax. */
function setNatural(el: Element, name: string, v: unknown): void {
  if (ALWAYS_PROP.has(name)) { (el as any)[name] = v; return; }
  if (!ALWAYS_ATTR.has(name) && !name.includes('-') && name in el) { (el as any)[name] = v; return; }
  if (v == null || v === false) el.removeAttribute(name);
  else el.setAttribute(name, v === true ? '' : String(v));
}

function fillAttr(el: Element, def: Compiled['attrDefs'][number], values: unknown[]) {
  const { kind, name, template, holes } = def;

  const compute = () => {
    // single-hole fast path preserves non-string values (fns, objects, booleans)
    if (holes.length === 1 && template === marker(holes[0])) {
      return resolve(values[holes[0]]);
    }
    return template.replace(markerRe, (_, h) => String(resolve(values[Number(h)])));
  };

  // ---- explicit event syntax: @click ----
  if (kind === 'event') {
    el.addEventListener(name, values[holes[0]] as EventListener);
    return;
  }

  // ---- natural syntax: onclick=${fn} ----
  // Decided at instantiate time, when the actual value is known. A function in
  // an on* attribute is an event listener; anything else falls through to the
  // normal attribute/property path.
  if (kind === 'auto' && name.startsWith('on') && name.length > 2) {
    const v = values[holes[0]];
    // In an on* attribute a function is ALWAYS a listener, never an accessor —
    // the position disambiguates what `typeof v === 'function'` cannot.
    if (typeof v === 'function') {
      el.addEventListener(name.slice(2), v as EventListener);
      return;
    }
  }

  bind(holes.map((h) => values[h]), compute, (v) => {
    if (kind === 'prop') (el as any)[name] = v;
    else if (kind === 'bool') v ? el.setAttribute(name, '') : el.removeAttribute(name);
    else if (kind === 'auto') setNatural(el, name, v);
    else el.setAttribute(name, v as string);
  });
}

function fillChild(anchor: Comment, value: unknown) {
  let current: Node[] = [];

  const set = (v: unknown) => {
    current = reconcile(anchor, current, normalize(v));
  };

  bind([value], () => resolve(value), set);
}

function normalize(v: unknown): Node[] {
  if (v == null || v === false || v === true) return [];
  if (Array.isArray(v)) return v.flatMap(normalize);
  if (isResult(v)) return instantiate(v);
  if (v instanceof Node) return [v];
  // A component instance ({ nodes, dispose }) embedded directly: `${Card()}`.
  // Its owner is already parented to the enclosing component, so disposal
  // cascades — we only need its nodes here. Duck-typed to avoid a cyclic import.
  if (isComponentInstance(v)) return v.nodes;
  return [document.createTextNode(String(v))];
}

const isComponentInstance = (v: unknown): v is { nodes: Node[] } =>
  !!v && typeof v === 'object' && Array.isArray((v as { nodes?: unknown }).nodes)
    && typeof (v as { dispose?: unknown }).dispose === 'function';

// Keyed-ish reconcile: reuse nodes by referential identity, order before anchor.
function reconcile(anchor: Comment, oldNodes: Node[], newNodes: Node[]): Node[] {
  const parent = anchor.parentNode!;
  const newSet = new Set(newNodes);
  for (const n of oldNodes) if (!newSet.has(n) && n.parentNode === parent) parent.removeChild(n);
  for (const n of newNodes) parent.insertBefore(n, anchor); // insertBefore moves existing nodes
  return newNodes;
}

export function instantiate(result: TemplateResult): Node[] {
  const { content, attrDefs, childDefs } = compile(result._strings);
  const frag = content.cloneNode(true) as DocumentFragment;
  const nodes = flatIndex(frag);

  for (const def of attrDefs) fillAttr(nodes[def.index] as Element, def, result._values);
  for (const def of childDefs) fillChild(nodes[def.index] as Comment, result._values[def.hole]);

  return Array.from(frag.childNodes);
}

export function render(result: TemplateResult, container: Element): void {
  container.textContent = '';
  for (const n of instantiate(result)) container.appendChild(n);
}
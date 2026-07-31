/**
 * Build/dev-time validator for html`` templates.
 *
 * Runs once per call site (cache by the `strings` identity, like compile()).
 * Turns the silent-breakage failure mode of tagged-template HTML into a loud,
 * located error — the same DX you get from a type error.
 *
 * Catches the cases that actually break marker placement:
 *   - unclosed non-void elements            <div> … (never closed)
 *   - mismatched close tags                 <section>…</div>
 *   - stray close tags                      </div> with nothing open
 *   - unterminated tag / attribute          <div class=${x}   (missing >)
 *   - ${} interpolated into <table>/<select> text (foster-parenting risk)
 *
 * Void elements and explicit self-closing (<x />) are fine. The validator is
 * intentionally strict about explicit closing of normal elements: a framework
 * that owns its templates benefits from clean, unambiguous markup.
 */

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
// A ${} directly inside these (not inside a proper child) is ambiguous: if it
// yields text it gets foster-parented out. Holes inside <tbody>/<tr>/<option>
// are NOT flagged — a hole producing <tr>/<td> there is the correct pattern.
const FOSTER = new Set(['table', 'select']);

export interface TemplateError {
  message: string;
  hole?: number; // which ${} (0-based), if the problem is near an interpolation
}

const HOLE = '\u0000';

export function validateTemplate(strings: readonly string[]): TemplateError[] {
  const src = strings.join(HOLE);
  const errors: TemplateError[] = [];
  const stack: { name: string }[] = [];
  let hole = 0;
  let i = 0;
  const n = src.length;

  const near = () =>
    i > 0 && src.lastIndexOf(HOLE, i) === i - 1 ? hole - 1 : undefined;

  while (i < n) {
    const c = src[i];

    if (c === HOLE) {
      if (FOSTER.has(stack[stack.length - 1]?.name)) {
        errors.push({
          message: `Interpolation directly inside <${
            stack[stack.length - 1].name
          }> — will be foster-parented; put it inside a row/cell/option`,
          hole,
        });
      }
      hole++;
      i++;
      continue;
    }

    if (c === '<' && src.startsWith('<!--', i)) {
      // comment
      const end = src.indexOf('-->', i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }

    if (c === '<' && src[i + 1] === '/') {
      // close tag
      const m = /^<\/\s*([a-zA-Z][\w-]*)\s*>/.exec(src.slice(i));
      if (!m) {
        errors.push({ message: 'Malformed closing tag', hole: near() });
        i++;
        continue;
      }
      const name = m[1].toLowerCase();
      i += m[0].length;
      if (stack.length === 0) {
        errors.push({ message: `Stray </${name}> — nothing is open here` });
      } else if (stack[stack.length - 1].name !== name) {
        const open = stack[stack.length - 1].name;
        errors.push({
          message: `Mismatched tag: expected </${open}> but found </${name}>`,
        });
        // recover: if it matches something deeper, pop to it; else drop the stray close
        const idx = [...stack].reverse().findIndex((e) => e.name === name);
        if (idx !== -1) stack.length -= idx + 1;
      } else {
        stack.pop();
      }
      continue;
    }

    if (c === '<' && /[a-zA-Z]/.test(src[i + 1] ?? '')) {
      // open tag
      const nameMatch = /^<([a-zA-Z][\w-]*)/.exec(src.slice(i));
      const name = nameMatch![1].toLowerCase();
      // scan to the terminating '>', honoring quotes; detect unterminated tags
      let j = i + nameMatch![0].length;
      let selfClose = false;
      let quote = '';
      for (; j < n; j++) {
        const ch = src[j];
        if (quote) {
          if (ch === quote) quote = '';
          continue;
        }
        if (ch === '"' || ch === "'") {
          quote = ch;
          continue;
        }
        if (ch === '<') break; // new '<' before '>' => unterminated
        if (ch === '>') {
          selfClose = src[j - 1] === '/';
          break;
        }
      }
      if (j >= n || src[j] !== '>') {
        errors.push({
          message: `Unterminated <${name}…> (missing '>' or quote) — this usually swallows an interpolation`,
          hole: hole,
        });
        return errors; // structure is unrecoverable past here
      }
      // ${} sitting in table/select text just before this content?
      if (
        FOSTER.has(stack[stack.length - 1]?.name) &&
        src.slice(i - 1, i) === HOLE
      ) {
        errors.push({
          message: `Interpolation inside <${
            stack[stack.length - 1].name
          }> text — wrap rows in the proper child (<tbody>/<option>) or the parser will relocate it`,
          hole: hole - 1,
        });
      }
      if (!VOID.has(name) && !selfClose) stack.push({ name });
      i = j + 1;
      continue;
    }

    // text: flag ${} directly inside a foster-parenting context
    if (c === HOLE && FOSTER.has(stack[stack.length - 1]?.name)) {
      errors.push({
        message: `Interpolation directly inside <${
          stack[stack.length - 1].name
        }> — will be foster-parented; put it inside a row/cell/option`,
        hole,
      });
    }
    i++;
  }

  for (const e of stack)
    errors.push({ message: `Unclosed <${e.name}> — add </${e.name}>` });
  return errors;
}

/** Throw a single readable error if the template is malformed. */
export function assertTemplate(strings: readonly string[]): void {
  const errs = validateTemplate(strings);
  if (errs.length === 0) return;
  const lines = errs.map(
    (e) =>
      `  • ${e.message}${
        e.hole != null ? ` (near interpolation #${e.hole + 1})` : ''
      }`
  );
  throw new SyntaxError(`Invalid html\`\` template:\n${lines.join('\n')}`);
}

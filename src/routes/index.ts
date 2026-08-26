import {
  computed,
  defineComponent,
  For,
  html,
  Show,
  signal,
  type WritableSignal,
  type ReadonlySignal
} from '../framework';

var seq = 1;
var makeTask = (title: string, tag: string) => ({
  id: seq++,
  title,
  tag,
  done: signal(false),
});

var TaskRow = defineComponent(({ task, onRemove }: { task: unknown; onRemove: (id: number) => void }) => {
  return html`<li class=${() => (task.done() ? 'row done' : 'row')}>
    <input
      type="checkbox"
      checked=${() => task.done()}
      onchange=${() => task.done.set(!task.done())}
    />
    <span class="title">${task.title}</span>
    <span class="tag">${task.tag}</span>
    <button class="x" onclick=${() => onRemove(task.id)}>✕</button>
  </li>`;
});

var FilterBar = defineComponent(({ filter, counts }: { filter: WritableSignal<string>; counts: ReadonlySignal<{ all: number; done: number; active: number; }> }) => {
  const chip = (id: string, label: string) => html`<button
    class=${() => (filter() === id ? 'chip active' : 'chip')}
    onclick=${() => filter.set(id)}
  >
    ${label} <b>${() => counts()[id as keyof { all: number; done: number; active: number; }]}</b>
  </button>`;
  return html`<div class="chips">
    ${() => chip('all', 'All')} ${() => chip('active', 'Active')}
    ${() => chip('done', 'Done')}
  </div>`;
});

var AddForm = defineComponent(({ onAdd }: { onAdd: (title: string, tag: string) => void }) => {
  const title = signal('');
  const tag = signal('general');
  const valid = computed(() => title().trim().length > 0);
  const submit = () => {
    if (!valid()) return;
    onAdd(title().trim(), tag());
    title.set('');
  };
  return html`<div class="add">
    <input
      class="grow"
      placeholder="add a task…"
      value=${() => title()}
      oninput=${(e: Event) => title.set(e.target.value)}
      onkeydown=${(e: KeyboardEvent) => {
      if (e.key === 'Enter') submit();
    }}
    />
    <select
      value=${() => tag()}
      onchange=${(e: Event) => tag.set(e.target.value)}
    >
      <option value="general">general</option>
      <option value="work">work</option>
      <option value="home">home</option>
    </select>
    <button
      class="primary"
      disabled=${() => !valid()}
      onclick=${submit}
    >
      Add
    </button>
  </div>`;
});

var appSetupRuns = 0;

var App = defineComponent((_props, ctx) => {
  appSetupRuns++;
  const tasks = signal([
    makeTask('read the signals core', 'work'),
    makeTask('wire template holes to effects', 'work'),
    makeTask('water the plants', 'home'),
  ]);
  tasks()[0].done.set(true);
  const filter = signal('all');
  const counts = computed(() => {
    const list = tasks();
    const done = list.filter((t) => t.done()).length;
    return { all: list.length, done, active: list.length - done };
  });
  const visible = computed(() => {
    const f = filter();
    return tasks().filter((t) =>
      f === 'all' ? true : f === 'done' ? t.done() : !t.done()
    );
  });
  const add = (title: string, tag: string) => tasks.set([...tasks(), makeTask(title, tag)]);
  const remove = (id: number) => tasks.set(tasks().filter((t) => t.id !== id));
  const clearDone = () => tasks.set(tasks().filter((t) => !t.done()));
  ctx.onMount(() => {
    const t = setInterval(() => { }, 6e4);
    return () => clearInterval(t);
  });
  return html`<section class="app">
    <header>
      <h1>Tasks</h1>
      <span class="sub"
        >${() => counts().active} active · ${() => counts().all}
        total</span
      >
    </header>

    ${AddForm({ onAdd: add })}
    ${FilterBar({ filter, counts })}

    <ul class="list">
      ${For(
    visible,
    (t) => t.id,
    (t) => TaskRow({ task: t, onRemove: remove })
  )}
    </ul>

    ${Show(
    () => visible().length === 0,
    () => html`<p class="empty">nothing here</p>`
  )}

    <footer>
      <button
        class="ghost"
        disabled=${() => counts().done === 0}
        onclick=${clearDone}
      >
        Clear completed
      </button>
      <span class="proof"
        >App setup ran <b>${() => appSetupRuns}</b>× — updates re-run
        zero component code</span
      >
    </footer>
  </section>`;
});

export default () => {
  return html`
    <h1>Home Route</h1>
    ${App()}
  `;
};

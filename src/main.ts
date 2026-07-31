import {
  computed,
  defineComponent,
  For,
  html,
  mount,
  Show,
  signal,
} from './framework';

var seq = 1;
var makeTask = (title, tag) => ({
  id: seq++,
  title,
  tag,
  done: signal(false),
});

var TaskRow = defineComponent(({ task, onRemove }) => {
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

var FilterBar = defineComponent(({ filter, counts }) => {
  const chip = (id, label) => html`<button
    class=${() => (filter() === id ? 'chip active' : 'chip')}
    onclick=${() => filter.set(id)}
  >
    ${label} <b>${() => counts()[id]}</b>
  </button>`;
  return html`<div class="chips">
    ${() => chip('all', 'All')} ${() => chip('active', 'Active')}
    ${() => chip('done', 'Done')}
  </div>`;
});

var AddForm = defineComponent(({ onAdd }) => {
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
      oninput=${(e) => title.set(e.target.value)}
      onkeydown=${(e) => {
        if (e.key === 'Enter') submit();
      }}
    />
    <select
      value=${() => tag()}
      onchange=${(e) => tag.set(e.target.value)}
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
  const add = (title, tag) => tasks.set([...tasks(), makeTask(title, tag)]);
  const remove = (id) => tasks.set(tasks().filter((t) => t.id !== id));
  const clearDone = () => tasks.set(tasks().filter((t) => !t.done()));
  ctx.onMount(() => {
    const t = setInterval(() => {}, 6e4);
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

mount(App, {}, document.getElementById('root') as Element);

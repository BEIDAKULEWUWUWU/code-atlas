import { store, toggle } from '../store';
import { TaskRow, type Row } from './TaskRow';

export type List = {
  element: HTMLElement;
  render(state: typeof store): void;
};

export function TaskList(): List {
  const element = document.createElement('ul');
  element.className = 'task-list';

  const empty = document.createElement('p');
  empty.className = 'task-empty';
  empty.textContent = 'Nothing here yet.';

  /* Rows are pooled by index rather than keyed by id. Ids would be more correct in general, but
     the list is appended to and toggled in place — it never reorders — so row N is always task
     N, and a keyed pool would be a map to maintain for a property that cannot change. */
  const pool: Row[] = [];

  return {
    element,
    render(state) {
      element.hidden = state.tasks.length === 0;
      empty.hidden = !element.hidden;
      if (empty.hidden === false) element.after(empty);

      /* A stale row from a longer list would otherwise stay on screen after a delete. */
      while (pool.length > state.tasks.length) pool.pop()?.element.remove();

      state.tasks.forEach((task, index) => {
        if (!pool[index]) {
          const row = TaskRow(toggle);
          pool[index] = row;
          element.append(row.element);
        }
        pool[index].render(task);
      });

      if (state.loading) element.classList.add('is-loading');
      else element.classList.remove('is-loading');
    }
  };
}

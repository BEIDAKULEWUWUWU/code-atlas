import type { Task } from '../api';
import { formatDue } from '../format';

export type Row = {
  element: HTMLElement;
  render(task: Task): void;
};

export function TaskRow(onToggle: (id: string) => void): Row {
  const element = document.createElement('li');
  element.className = 'task';

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'task-box';

  const title = document.createElement('span');
  title.className = 'task-title';

  const due = document.createElement('span');
  due.className = 'task-due';

  element.append(box, title, due);
  box.addEventListener('change', () => onToggle(element.dataset.id ?? ''));

  return {
    element,
    render(task) {
      /* The id lives on the element rather than in a closure per row, because rows are reused
         across renders — a closure would keep pointing at whichever task the row was first
         built for, and a toggle would then write to the wrong one. */
      element.dataset.id = task.id;
      element.classList.toggle('is-done', task.done);
      box.checked = task.done;
      title.textContent = task.title;
      due.textContent = formatDue(task.due);
    }
  };
}

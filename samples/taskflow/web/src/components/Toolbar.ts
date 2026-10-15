import { add, refresh, store } from '../store';
import { formatCount } from '../format';

export type Bar = {
  element: HTMLElement;
  render(state: typeof store): void;
};

export function Toolbar(): Bar {
  const element = document.createElement('header');
  element.className = 'toolbar';

  const count = document.createElement('span');
  count.className = 'toolbar-count';

  const input = document.createElement('input');
  input.className = 'toolbar-input';
  input.placeholder = 'What needs doing?';

  const button = document.createElement('button');
  button.className = 'toolbar-add';
  button.textContent = 'Add';

  const reload = document.createElement('button');
  reload.className = 'toolbar-reload';
  reload.textContent = 'Reload';

  element.append(count, input, button, reload);

  /* Submit on Enter as well as on the button: a one-field form is a form, and Enter is what
     people press. Leaving the input focused after an add is what makes adding five things in a
     row not require five clicks back into the box. */
  const submit = () => {
    const title = input.value.trim();
    if (!title) return;
    input.value = '';
    void add(title);
  };
  button.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });
  reload.addEventListener('click', () => void refresh());

  return {
    element,
    render(state) {
      const done = state.tasks.filter((task) => task.done).length;
      count.textContent = formatCount(state.tasks.length, done);
      button.disabled = state.loading;
      reload.disabled = state.loading;
    }
  };
}

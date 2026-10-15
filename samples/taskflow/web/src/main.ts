import { refresh, store, subscribe } from './store';
import { setUnauthorizedHandler } from './client';
import { TaskList } from './components/TaskList';
import { Toolbar } from './components/Toolbar';

const root = document.getElementById('app');
if (!root) throw new Error('#app is missing from index.html');

const toolbar = Toolbar();
const list = TaskList();
root.append(toolbar.element, list.element);

/* Every screen in this app is one render function over `store`, so there is no diffing to get
   wrong: the whole tree is rebuilt on change. It is fast enough at this size and it means a
   stale view is not a state that exists. */
function render(): void {
  toolbar.render(store);
  list.render(store);
}

subscribe(render);
setUnauthorizedHandler(() => {
  window.location.href = '/login';
});

refresh();
render();

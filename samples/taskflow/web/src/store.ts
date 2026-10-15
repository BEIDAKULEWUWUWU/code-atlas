import { createTask, listTasks, updateTask, type Task } from './api';

type Listener = () => void;

/* A single mutable object plus a set of subscribers. No framework, because the state is small
   enough that a framework would be the largest thing in the bundle — and the parts that are
   genuinely hard (patching one row without redrawing the list) are hard in a framework too. */
export const store = {
  tasks: [] as Task[],
  loading: false,
  error: null as string | null
};

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(): void {
  for (const listener of listeners) listener();
}

export async function refresh(): Promise<void> {
  store.loading = true;
  store.error = null;
  announce();
  try {
    store.tasks = await listTasks();
  } catch (error) {
    /* The message is shown as-is. A failed refresh is the one case where the raw text is more
       useful than anything friendlier we could write, because it is usually the API saying why. */
    store.error = error instanceof Error ? error.message : String(error);
  } finally {
    store.loading = false;
    announce();
  }
}

export async function add(title: string): Promise<void> {
  const created = await createTask({ title });
  store.tasks = [...store.tasks, created];
  announce();
}

export async function toggle(id: string): Promise<void> {
  const index = store.tasks.findIndex((task) => task.id === id);
  if (index < 0) return;
  const next = await updateTask(id, { done: !store.tasks[index].done });
  /* Replaced in place rather than re-fetched: the list does not reorder on a toggle, so a
     refetch would redraw every row to change one. */
  store.tasks = store.tasks.map((task) => (task.id === id ? next : task));
  announce();
}

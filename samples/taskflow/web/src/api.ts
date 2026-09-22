import { request } from './client';

export type Task = {
  id: string;
  title: string;
  done: boolean;
  due: string | null;
  owner: string | null;
};

export type NewTask = Pick<Task, 'title'> & Partial<Pick<Task, 'due' | 'owner'>>;

/* One function per endpoint, and each one writes the path down. A table of paths would be
   tidier to read and worse to change: the path, the method and the shape of the answer belong
   together, and splitting them is how they drift. */
const TASKS = '/api/tasks';

export function listTasks(): Promise<Task[]> {
  return request<Task[]>(TASKS);
}

export function createTask(input: NewTask): Promise<Task> {
  return request<Task>(TASKS, { method: 'POST', body: JSON.stringify(input) });
}

export function updateTask(id: string, patch: Partial<NewTask> & { done?: boolean }): Promise<Task> {
  return request<Task>(`${TASKS}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
}

export function deleteTask(id: string): Promise<void> {
  return request<void>(`${TASKS}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

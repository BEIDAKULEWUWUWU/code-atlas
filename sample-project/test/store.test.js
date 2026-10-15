import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createStore } from '../src/store.js';

test('store adds and completes tasks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-todo-'));
  const store = createStore(join(directory, 'tasks.json'));

  const created = await store.add('Write a visual map');
  assert.deepEqual(created, { id: 1, title: 'Write a visual map', done: false });
  assert.equal((await store.complete(1)).done, true);
  assert.equal((await store.all())[0].title, 'Write a visual map');
  assert.match(await readFile(join(directory, 'tasks.json'), 'utf8'), /visual map/);
});

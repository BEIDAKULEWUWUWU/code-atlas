import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from './store.js';
import { formatList } from './format.js';

/* This matches the README: the data file lives in the system temp directory, so running the
   sample never writes into your home directory or into the project tree. It used to use
   homedir(), which quietly contradicted the README and left a stray ~/.atlas-todo.json behind. */
const store = createStore(join(tmpdir(), 'atlas-todo.json'));
const [command, ...args] = process.argv.slice(2);

if (command === 'add') {
  const title = args.join(' ').trim();
  if (title) {
    const item = await store.add(title);
    console.log(`Added task #${item.id}: ${item.title}`);
  } else {
    /* A forgotten argument is a user mistake, not a crash. Reporting usage and setting a non-zero
       exit code is the whole fix; throwing a stack trace at someone who mistyped a command just
       buries the one line that tells them what to type instead. */
    console.error('A task title is required. Usage: npm start -- add <title>');
    process.exitCode = 1;
  }
} else if (command === 'list') {
  console.log(formatList(await store.all()));
} else if (command === 'done') {
  const id = Number(args[0]);
  if (Number.isInteger(id)) {
    const item = await store.complete(id);
    console.log(item ? `Completed: ${item.title}` : 'Task not found.');
  } else {
    console.error('A numeric task id is required. Usage: npm start -- done <id>');
    process.exitCode = 1;
  }
} else {
  console.log('Usage: npm start -- add <title> | list | done <id>');
}

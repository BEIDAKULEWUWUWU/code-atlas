import { readFile, writeFile } from 'node:fs/promises';

export function createStore(filePath) {
  async function read() {
    try {
      return JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function write(items) {
    await writeFile(filePath, `${JSON.stringify(items, null, 2)}\n`);
  }

  return {
    async all() {
      return read();
    },
    async add(title) {
      const items = await read();
      const item = { id: items.length + 1, title, done: false };
      items.push(item);
      await write(items);
      return item;
    },
    async complete(id) {
      const items = await read();
      const item = items.find((entry) => entry.id === id);
      if (!item) return null;
      item.done = true;
      await write(items);
      return item;
    }
  };
}

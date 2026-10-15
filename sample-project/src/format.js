export function formatItem(item) {
  const marker = item.done ? 'x' : ' ';
  return `${item.id}. [${marker}] ${item.title}`;
}

export function formatList(items) {
  if (items.length === 0) return 'No tasks yet.';
  return items.map(formatItem).join('\n');
}

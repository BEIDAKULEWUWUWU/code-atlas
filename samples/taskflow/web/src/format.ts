const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso: string | null): string {
  if (!iso) return 'no date';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'bad date';
  return `${MONTHS[at.getMonth()]} ${at.getDate()}`;
}

/* "3 days late" reads faster than a date when the date is in the past, and the whole point of
   the column is to answer "do I need to look at this today". */
export function formatDue(iso: string | null, now = new Date()): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'bad date';
  const days = Math.round((at.getTime() - now.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days < 0 ? `${-days} days late` : `in ${days} days`;
}

export function formatCount(total: number, done: number): string {
  if (!total) return 'nothing to do';
  return `${done} of ${total} done`;
}

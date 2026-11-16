const UNITS = [
  { unit: 'day', seconds: 86_400 },
  { unit: 'hour', seconds: 3_600 },
  { unit: 'minute', seconds: 60 },
] as const;

/** "2 hours ago", in the viewer's language. Only notifications use relative times (UX Brief §11.4). */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const largest = UNITS.find(({ seconds: size }) => Math.abs(seconds) >= size);
  return largest ? formatter.format(Math.trunc(seconds / largest.seconds), largest.unit) : formatter.format(0, 'second');
}

// A time typed on a clock in some time zone, and the moment it means. Built on Intl, so no date library is needed.

/** How far the zone's clock is ahead of UTC at that moment, in minutes. */
function offsetMinutes(ms: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(ms));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const clockAsUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return (clockAsUtc - Math.floor(ms / 1000) * 1000) / 60_000;
}

/**
 * `2026-12-01T23:59` read on the clock of `zone`, as a UTC timestamp. The offset is looked up twice, because the first
 * guess can be on the other side of a clock change. A time the clock skips (spring forward) lands an hour later; a time
 * it shows twice (fall back) is read as the first one.
 */
export function toInstant(local: string, zone: string): string {
  const [date = '', time = ''] = local.split('T');
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const clock = Date.UTC(year, month - 1, day, hour, minute);
  const guess = clock - offsetMinutes(clock, zone) * 60_000;
  return new Date(clock - offsetMinutes(guess, zone) * 60_000).toISOString();
}

/** A UTC timestamp as the zone's clock shows it, `YYYY-MM-DDTHH:mm`: the value of a date-time input. */
export function toLocalInput(iso: string, zone: string): string {
  const ms = new Date(iso).getTime();
  return new Date(ms + offsetMinutes(ms, zone) * 60_000).toISOString().slice(0, 16);
}

/** The zone this browser is set to. */
export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Every zone to choose from, plus the ones named in `extra` (a draft's own zone may not be in the browser's list, such as UTC). */
export function timeZoneOptions(...extra: string[]): string[] {
  return [...new Set([...Intl.supportedValuesOf('timeZone'), 'UTC', ...extra])].sort();
}

/** A due date for people to read, in the zone it was set in: "Dec 1, 2026, 11:59 PM (Asia/Manila)". */
export function formatDue(iso: string, zone: string): string {
  const when = new Intl.DateTimeFormat('en-US', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  return `${when} (${zone})`;
}

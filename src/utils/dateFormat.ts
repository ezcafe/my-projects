/**
 * Format a date as DD/MM/YY for display.
 * Accepts ISO date string (YYYY-MM-DD), full ISO datetime (e.g. with T00:00:00.000Z), or Date instance.
 * Uses the calendar date in local time so stored datetimes display correctly.
 */
export function formatDateDDMMYY(date: Date | string): string {
  let d: Date;
  if (typeof date === 'string') {
    const isoDateOnly = date.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(isoDateOnly)) {
      d = new Date(isoDateOnly + 'T00:00:00');
    } else {
      d = new Date(date);
    }
  } else {
    d = date;
  }
  if (Number.isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
}

/**
 * Parse a DD/MM/YY or DD/MM/YYYY string into ISO date (YYYY-MM-DD).
 * Also accepts existing ISO (YYYY-MM-DD) and returns as-is.
 * Returns null if invalid.
 */
export function parseDDMMYY(str: string): string | null {
  const trimmed = str.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, y, month, day] = isoMatch;
    const mo = parseInt(month, 10);
    const d = parseInt(day, 10);
    if (mo < 1 || mo > 12 || d < 1 || d > new Date(parseInt(y, 10), mo, 0).getDate()) return null;
    return trimmed;
  }
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, day, month, year] = m;
  const d = parseInt(day, 10);
  const mo = parseInt(month, 10);
  let y = parseInt(year, 10);
  if (year.length === 2) y = y >= 0 && y <= 99 ? 2000 + y : y;
  if (mo < 1 || mo > 12) return null;
  const lastDay = new Date(y, mo, 0).getDate();
  if (d < 1 || d > lastDay) return null;
  return `${y}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Convert a date-only string (YYYY-MM-DD) to an ISO string at UTC midnight.
 * Preserves the calendar date across timezones (avoids local-midnight → UTC shift).
 */
export function dateOnlyToUtcIso(isoDateOnly: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDateOnly)) return new Date(isoDateOnly).toISOString();
  return isoDateOnly + 'T00:00:00.000Z';
}

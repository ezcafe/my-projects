/** Milestone offsets in days before project end. 1 week, 2 weeks, 1 month (last day excluded). */
export const MILESTONE_OFFSETS_DAYS: number[] = [7, 14, 30];

function addDays(d: Date, days: number): Date {
  const t = new Date(d);
  t.setDate(t.getDate() + days);
  return t;
}

export function getMilestoneDates(
  endDate: Date,
  offsetsDays: number[] = MILESTONE_OFFSETS_DAYS,
): Date[] {
  return offsetsDays.map((days) => addDays(endDate, -days));
}

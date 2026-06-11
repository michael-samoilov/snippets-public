import { format, parse, isToday, isYesterday } from "date-fns";

/** Local-timezone day key. The calendar's single source of truth. */
export function dayKey(date: Date = new Date()): string {
  return format(date, "yyyy-MM-dd");
}

export function dateFromDayKey(day: string): Date {
  return parse(day, "yyyy-MM-dd", new Date());
}

/** "Wednesday, June 11" */
export function longDay(date: Date): string {
  return format(date, "EEEE, MMMM d");
}

/** "11 Jun 2026" — the margin voice */
export function marginDate(date: Date): string {
  return format(date, "d MMM yyyy");
}

/** "Today" / "Yesterday" / "Wednesday, June 11" */
export function friendlyDay(day: string): string {
  const date = dateFromDayKey(day);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return format(date, sameYear ? "EEEE, MMMM d" : "MMMM d, yyyy");
}

/** "9:41 pm" with oldstyle-friendly lowercase meridiem */
export function clockTime(epochMs: number): string {
  return format(new Date(epochMs), "h:mm aaa");
}

export function monthKey(date: Date): string {
  return format(date, "yyyy-MM");
}

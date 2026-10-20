const seasons = ["春", "夏", "秋", "冬"] as const;
const months = [4, 6, 10, 12] as const;

function tokyoParts(now: Date): { year: number; month: number } {
  const tokyo = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return { year: tokyo.getUTCFullYear(), month: tokyo.getUTCMonth() + 1 };
}

export function getAcademicYear(now: Date = new Date()): number {
  const { year, month } = tokyoParts(now);
  return month < 4 ? year - 1 : year;
}

export function getAcademicTermOptions(year: number = getAcademicYear()): string[] {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new Error("Invalid academic year");
  return seasons.map((season, index) => `${String(year).padStart(4, "0")}年度 ${index < 2 ? 1 : 2}学期（${season}ターム）`);
}

export function getCurrentTerm(now: Date = new Date()): string {
  const { month } = tokyoParts(now);
  const index = month < 4 || month >= 12 ? 3 : month < 6 ? 0 : month < 10 ? 1 : 2;
  return getAcademicTermOptions(getAcademicYear(now))[index];
}

/** Match the Web contract's UTC term anchors, independent of device timezone. */
export function getTermStartDate(term: string = getCurrentTerm()): string {
  const match = /^(\d{4})年度 ([12])学期（([春夏秋冬])ターム）$/.exec(term);
  if (!match) throw new Error("講義のタームを選び直してください。");
  const index = seasons.indexOf(match[3] as typeof seasons[number]);
  if (Number(match[1]) < 1 || Number(match[2]) !== (index < 2 ? 1 : 2)) {
    throw new Error("講義のタームを選び直してください。");
  }
  return `${match[1]}-${String(months[index]).padStart(2, "0")}-01T00:00:00.000Z`;
}

export function getTermFromSchedule(schedule: { period_start_daytime?: string | null }): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(schedule.period_start_daytime ?? "");
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 || year === 1 && month < 4) return undefined;
  const calendarDate = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.getUTCDate() !== day) return undefined;
  const index = month < 4 || month >= 12 ? 3 : month < 6 ? 0 : month < 10 ? 1 : 2;
  return getAcademicTermOptions(month < 4 ? year - 1 : year)[index];
}

// Undated records predate dynamic terms and must never move to a new academic year.
export const LEGACY_DEFAULT_TERM = "2026年度 1学期（夏ターム）";
export const DEFAULT_TERM = getCurrentTerm();
export const TERM_OPTIONS = getAcademicTermOptions();
export const TERM_START_DATES: Record<string, string> = Object.fromEntries(
  TERM_OPTIONS.map((term) => [term, getTermStartDate(term)]),
);

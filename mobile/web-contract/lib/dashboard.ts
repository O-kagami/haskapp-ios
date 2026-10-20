import type {
  DayOfWeek,
  JavaScriptDayOfWeek,
  PeriodNumber,
  ColorTheme,
  LectureWithDetails,
  TaskWithUI,
  CalendarEvent,
} from "./types";

export * from "./types";

export { getAcademicYear, getAcademicTermOptions, getCurrentTerm, getTermStartDate, getTermFromSchedule, TERM_START_DATES, LEGACY_DEFAULT_TERM } from "./academic-terms";

export const dayNamesJa: Record<DayOfWeek, string> = {
  Mon: "月",
  Tue: "火",
  Wed: "水",
  Thu: "木",
  Fri: "金",
};

/** Numeric weekday values follow JavaScript Date.getDay(): Sunday=0 through Saturday=6. */
export const javascriptDayOfWeekNamesJa: Record<JavaScriptDayOfWeek, string> = {
  0: "日",
  1: "月",
  2: "火",
  3: "水",
  4: "木",
  5: "金",
  6: "土",
};

export const javascriptDayOfWeekToDayOfWeek: Partial<Record<JavaScriptDayOfWeek, DayOfWeek>> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
};

export const dayOfWeekToJavaScriptDayOfWeek: Record<DayOfWeek, JavaScriptDayOfWeek> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
};

export function getThemeBySyllabusId(syllabusId: string | null | undefined): ColorTheme {
  if (!syllabusId) return "grey";
  const lastChar = syllabusId.trim().slice(-1);
  const num = parseInt(lastChar, 10);
  if (isNaN(num)) return "grey";

  switch (num) {
    case 0:
      return "teal";
    case 1:
      return "red";
    case 2:
      return "violet";
    case 3:
      return "orange";
    case 4:
      return "yellow";
    case 5:
      return "blue";
    case 6:
      return "green";
    case 7:
      return "pink";
    case 8:
      return "indigo";
    case 9:
      return "rose";
    default:
      return "grey";
  }
}

export const dayOfWeekList: DayOfWeek[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
export const periodList: PeriodNumber[] = [1, 2, 3, 4, 5];

export type PeriodTime = {
  period: PeriodNumber;
  startTime: string;
  endTime: string;
};

export const periodTimes: Record<PeriodNumber, PeriodTime> = {
  1: { period: 1, startTime: "08:45", endTime: "10:15" },
  2: { period: 2, startTime: "10:30", endTime: "12:00" },
  3: { period: 3, startTime: "13:00", endTime: "14:30" },
  4: { period: 4, startTime: "14:45", endTime: "16:15" },
  5: { period: 5, startTime: "16:30", endTime: "18:00" },
};

export function getSeedCalendarEvents(): CalendarEvent[] { return []; }

// 課題と講義スマートマッチング
export function isTaskRelatedToClass(task: TaskWithUI, cls: LectureWithDetails): boolean {
  if (task.lecture_id !== undefined) {
    if (task.lecture_id === null) {
      return false;
    }
    return cls.id === task.lecture_id || cls.lecture_list_id === task.lecture_id;
  }

  const tTitle = task.task_name.toLowerCase();
  const tDesc = (task.task_details || "").toLowerCase();
  const cSubject = cls.lecture_name.toLowerCase();

  if (tTitle.includes(cSubject) || tDesc.includes(cSubject)) {
    return true;
  }

  // キーワードマッチング
  if (cSubject.includes("電磁気学") && tTitle.includes("電磁気学")) return true;
  if (cSubject.includes("実験") && (tTitle.includes("実験") || tTitle.includes("制御"))) return true;
  if (cSubject.includes("最適化") && tTitle.includes("最適化")) return true;
  if (cSubject.includes("システムデザイン") && tTitle.includes("システムデザイン")) return true;
  if (cSubject.includes("形状設計") && (tTitle.includes("形状") || tTitle.includes("モデリング"))) return true;

  return false;
}

/** Resolve task accent color from the matched lecture, then stored theme. */
export function getTaskColorTheme(
  task: TaskWithUI,
  classes: LectureWithDetails[]
): ColorTheme | "violet" {
  const relatedClass = classes.find((cls) => isTaskRelatedToClass(task, cls));
  if (relatedClass) return relatedClass.colorTheme;
  return task.colorTheme || "violet";
}

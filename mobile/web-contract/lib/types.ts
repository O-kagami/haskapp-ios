export type DayOfWeek = "Mon" | "Tue" | "Wed" | "Thu" | "Fri";
/** JavaScript Date.getDay() convention: Sunday=0 through Saturday=6. */
export type JavaScriptDayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type PeriodNumber = 1 | 2 | 3 | 4 | 5;
export type ColorTheme = "red" | "teal" | "grey" | "orange" | "yellow" | "violet" | "blue" | "green" | "pink" | "indigo" | "rose";
export type TaskStatus = "todo" | "inProgress" | "done";
export { DEFAULT_TERM, TERM_OPTIONS } from "./academic-terms";

// =========================================
// 【データ（エンティティ）テーブル】
// =========================================

// ■ グループ [groups]
export interface Group {
  id: string; // uuid
  created_at: string; // timestamptz
  user_id: string; // uuid
  name: string; // text
}

// ■ グループの実施曜日・時刻 [schedules]
export interface Schedule {
  id: string; // uuid
  created_at: string; // timestamptz
  user_id: string; // uuid
  group_id: string; // uuid (外部キー: groups.id)
  day_of_week: JavaScriptDayOfWeek | null; // int (Date.getDay(): 日曜=0〜土曜=6)
  start_time: string; // time
  end_time: string; // time
  period_start_daytime?: string | null;
}

// ■ みんなで共有する講義データ [public_lecture_data]
export interface PublicLectureData {
  id: string; // uuid
  created_at: string; // timestamptz
  user_id: string; // uuid
  group_id: string; // uuid (外部キー: groups.id)
  name: string; // text
  syllabus_id: string; // text
  period_start_daytime: string; // timestamptz
  period_end_daytime: string; // timestamptz
  teacher?: string | null; // text
  classroom?: string | null; // text
  details?: string | null; // text
  department?: number | null; // int2 (開講学部)
  day_of_week?: JavaScriptDayOfWeek | null; // int2 (Date.getDay(): 日曜=0〜土曜=6)
  start_time?: string | null; // time
  end_time?: string | null; // time
}

export type PublicLectureSchedule = Pick<Schedule, "day_of_week" | "start_time" | "end_time" | "period_start_daytime"> & {
  day_of_week: JavaScriptDayOfWeek | null;
  start_time: string | null;
  end_time: string | null;
};

export type PublicLectureSummary = Pick<
  PublicLectureData,
  "id" | "name" | "teacher" | "syllabus_id" | "classroom" | "details"
>;

export interface PublicLectureSearchResult {
  id: string;
  name: string;
  public_lecture_data: PublicLectureSummary[] | null;
  schedules: PublicLectureSchedule[] | null;
}

export interface PublicLectureRegistration {
  group_id: string;
  name: string;
  classroom?: string | null;
  syllabus_id?: string | null;
  details?: string | null;
  teacher?: string | null;
  schedules?: PublicLectureSchedule[];
  day_of_week?: JavaScriptDayOfWeek | null;
  start_time?: string | null;
}

// ■ ユーザー固有の講義データ [user_lecture_data]
export interface UserLectureData {
  id: string; // uuid
  created_at: string; // timestamptz
  user_id: string; // uuid
  group_id: string; // uuid (外部キー: groups.id)
  grading_criteria?: string | null; // text
  classroom?: string | null; // text
  details?: string | null; // text
  attendance_count_needed?: number | null; // int2
  attendance_count?: number | null; // int2
  exam_date?: string | null; // date
  no_lecture_date?: string | null; // date
  report_rlate?: number | null; // int2 (レポートの評価割合％)
  exam_rate?: number | null; // int2 (試験の評価割合％)
  mini_exam_rate?: number | null; // int2 (小テストの評価割合％)
  lecture_count?: number | null; // int2 (講義回数)
}

// ■ ユーザー固有 of 講義データのテンプレート [user_lecture_data_template]
export interface UserLectureDataTemplate {
  id: string; // uuid
  created_at: string; // timestamptz
  user_id: string; // uuid
  affiliation_id: string; // uuid (外部キー: affiliation.id)
  group_id: string; // uuid (外部キー: groups.id)
  grading_criteria?: string | null; // text
  classroom?: string | null; // text
  details?: string | null; // text
  exam_date?: string | null; // date
  no_lecture_date?: string | null; // date
  report_rate?: number | null; // int2
  exam_rate?: number | null; // int2
  mini_exam_rate?: number | null; // int2
  lecture_count?: number | null; // int2
  attendance_count_needed?: number | null; // int2
  attendance_count?: number | null; // int2
}

// ■ ユーザー固有の講義データのテンプレートの評価 [user_lecture_data_template_late]
export interface UserLectureDataTemplateLate {
  id: string; // uuid
  created_at: string; // timestamptz
  user_id: string; // uuid
  late: number; // int2 (利用された数)
}

// ■ ユーザー固有の講義データのテンプレートの学部・学科／コース／クラスなどの選択肢 [affiliation]
export interface Affiliation {
  id: string; // uuid
  created_at: string; // timestamptz
  user_id: string; // uuid
  parent_id: string | null; // uuid (再帰的 parent_id)
  level: number; // int2 (初めの階層が1)
  name: string; // text (所属先の名前)
}

// ■ 課題 [tasks]
export interface Task {
  id: string; // uuid
  created_at: string; // timestamptz
  user_id: string; // uuid
  group_id: string | null; // uuid (外部キー: groups.id)。未紐付けは null
  name: string; // text
  details?: string | null; // text
  work_start_daytime?: string | null; // timestamptz
  work_end_daytime?: string | null; // timestamptz
  period_start_daytime?: string | null; // timestamptz
  period_end_daytime?: string | null; // timestamptz (デッドライン)
  work_interval_estimated?: string | null; // interval
  progress_percent: number; // int (進捗 %)
}

// ■ グループに所属するユーザー [group_users]
export interface GroupUser {
  id: string; // uuid
  created_at: string; // timestamptz
  user_id: string; // uuid (ユーザーid)
  group_id: string; // uuid (外部キー: groups.id)
}

// ■ 成績分布 [grade_distributions]
export interface GradeDistribution {
  id: string; // uuid
  created_at: string; // timestamptz
  user_id: string; // uuid
  group_id?: string | null; // uuid (外部キー: groups.id)
  academic_term: string; // 評価年度・学期
  course_program?: string | null; // 課程
  faculty?: string | null; // 開講学部
  data_type?: string | null; // データ種別
  subject_name: string; // 授業科目名
  lecture_title?: string | null; // 講義題目名
  class_code?: string | null; // クラス
  instructor_name?: string | null; // 担当教員名
  student_count: number; // 履修者数
  aplus_percent?: number | null; // numeric (秀 A+ の割合)
  a_percent?: number | null; // numeric (優 A の割合)
  aminus_percent?: number | null; // numeric (良 A- の割合)
  bplus_percent?: number | null; // numeric (可 B+ の割合)
  b_percent?: number | null; // numeric (B の割合)
  bminus_percent?: number | null; // numeric (不可 B- の割合)
  cplus_percent?: number | null; // numeric (C+ の割合)
  c_percent?: number | null; // numeric (C の割合)
  d_percent?: number | null; // numeric (D の割合)
  dminus_percent?: number | null; // numeric (D- の割合)
  f_percent?: number | null; // numeric (F の割合)
  gpa?: number | null; // numeric (GPA)
}

// ■ 用語と説明 [word_and_descriptions]
export interface WordAndDescription {
  id: string; // uuid
  created_at: string; // timestamptz
  user_id: string; // uuid
  word: string; // text (用語)
  description: string; // text (説明)
}

// ■ プレイグラウンド [playgrounds]
export interface Playground {
  id: string; // uuid
  created_at: string; // timestamptz
  user_id: string; // uuid
  text: string; // text
}

// ■ 管理ユーザー [admin_users]
export interface AdminUser {
  user_id: string; // uuid (主キー)
  created_at: string; // timestamptz
  note?: string | null; // text (運営者の名前・メモ)
}


// =========================================
// === UI表示用の拡張型（結合データ用） ===
// =========================================

export interface LectureWithDetails {
  sharing_group_id?: string;
  id: string; // 講義リストID + schedule_id (ユニークキー)
  lecture_list_id?: string; // group_id と同等
  term?: string; // 登録対象のターム
  schedule_is_shared?: boolean; // Canonical admin-managed schedule; user edits enrollment metadata only
  lecture_name: string; // 講義名
  classroom?: string; // 教室
  day_of_the_week: JavaScriptDayOfWeek; // Date.getDay()と同じ数値 (日曜=0〜土曜=6)
  period: PeriodNumber; // コマ番号 (1-5)
  colorTheme: ColorTheme; // UIテーマカラー

  // 評価基準 / 詳細
  grading_criteria?: string;
  lecture_details?: string;

  // 出欠・メモ
  absences?: number; // 欠席数
  memo?: string; // 講義のメモ
  belongings?: string; // 授業のもちもの
  grading_attendance_required?: number; // 単位取得に必要な最低出席回数
  grading_attendance_total?: number; // 講義回数
  grading_report?: number;
  grading_test?: number;
  grading_quiz?: number;
  grading_memo?: string;

  // 学部・シラバスなどの詳細情報
  instructor: string;
  credits?: string;
  gpa?: string;
  aRate?: string;
  passRate?: string;
  discipline?: string;
  historicalInstructor?: string;
  historicalEnrollment?: string;
  gradeDistribution?: number[];
  department?: number;
  test_datetime?: string | null;
  syllabus_id?: string | null;
  cancelled_date?: string | null;
}

export interface TaskWithUI {
  related_lecture_id?: string | null;
  id: string;
  created_at: string;
  user_id: string;
  task_name: string;
  deadline: string; // 期日/期末時間
  task_details?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  estimated_duration?: string | null;
  progress_percent: number;
  status: TaskStatus; // progress_percent からマッピング
  colorTheme: ColorTheme | "violet";
  assigned_date?: string | null;
  scheduled_date?: string | null;
  lecture_id?: string | null; // group_id とマッピング
  syllabus_id?: string | null;
}

export interface CalendarEvent {
  relatedLectureID?: string;
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  colorTheme: ColorTheme | "violet";
}

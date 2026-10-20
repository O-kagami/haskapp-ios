import { configured, getCurrentUserId, supabase } from '../web-contract/lib/supabase';
import type { ResourceStatus } from './lecture-insights';
import type { GradeDistribution, LectureWithDetails } from '../web-contract/lib/types';

export type GradeHistoryRow = {
  id: string;
  academicTerm: string;
  instructor: string | null;
  lectureTitle: string | null;
  faculty: string | null;
  enrollment: number | null;
  gpa: number | null;
  distribution: (number | null)[];
  preferred: boolean;
  subjectName: string | null;
  courseProgram: string | null;
  dataType: string | null;
  classCode: string | null;
  matchKind: 'instructor-and-title' | 'instructor' | 'title' | 'subject';
  source: 'grade_distributions';
  sourceLabel: string;
};

const buckets = ['aplus_percent', 'a_percent', 'aminus_percent', 'bplus_percent', 'b_percent', 'bminus_percent', 'cplus_percent', 'c_percent', 'd_percent', 'dminus_percent', 'f_percent'] as const;
export type GradeHistoryStatus = ResourceStatus;
export type LectureIdentity = Pick<LectureWithDetails, 'lecture_name' | 'instructor'>;

export function cleanSubjectName(name: string): string {
  let cleaned = name.replace(/^\d{5,6}\s+/, '');
  const ascii = /^(.*?)\s+[a-zA-Z]/.exec(cleaned);
  if (ascii) cleaned = ascii[1];
  return cleaned.trim().split(/[\s　]+/)[0] ?? '';
}

export function gradeHistoryContext(lecture: LectureIdentity): string {
  return JSON.stringify([cleanSubjectName(lecture.lecture_name), lecture.lecture_name, lecture.instructor]);
}

export const gradeHistoryColumns = ['id', 'academic_term', 'subject_name', 'instructor_name', 'lecture_title', 'faculty', 'course_program', 'data_type', 'class_code', 'student_count', 'gpa', ...buckets].join(',');

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function number(value: unknown, maximum = Infinity, integer = false): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 && result <= maximum && (!integer || Number.isInteger(result)) ? result : null;
}

export function mapGradeHistory(records: GradeDistribution[], lecture: LectureIdentity): GradeHistoryRow[] {
  const sorted = [...records].sort((a, b) => (b.academic_term ?? '').localeCompare(a.academic_term ?? '') || a.id.localeCompare(b.id));
  const subtitle = lecture.lecture_name.replace(/^\d{5,6}\s+/, '').trim().split(/[\s　]+/).slice(1).join(' ');
  const instructor = lecture.instructor.trim().split(/\s+/)[0];
  const matchesTitle = (row: GradeDistribution) => !!subtitle && !!row.lecture_title && (row.lecture_title.includes(subtitle) || subtitle.includes(row.lecture_title));
  const matchesInstructor = (row: GradeDistribution) => !!instructor && instructor !== '未登録教員' && !!row.instructor_name?.includes(instructor);
  let preferred = sorted.findIndex(row => matchesInstructor(row) && matchesTitle(row));
  if (preferred < 0) preferred = sorted.findIndex(matchesInstructor);
  if (preferred < 0) preferred = sorted.findIndex(matchesTitle);
  if (preferred < 0 && sorted.length) preferred = 0;
  return sorted.map((row, index) => ({
    id: row.id,
    academicTerm: row.academic_term ?? '',
    instructor: text(row.instructor_name),
    lectureTitle: text(row.lecture_title),
    faculty: text(row.faculty),
    enrollment: number(row.student_count, Infinity, true),
    gpa: number(row.gpa),
    distribution: buckets.map(key => number(row[key], 100)),
    preferred: index === preferred,
    subjectName: text(row.subject_name),
    courseProgram: text(row.course_program),
    dataType: text(row.data_type),
    classCode: text(row.class_code),
    matchKind: matchesInstructor(row) && matchesTitle(row) ? 'instructor-and-title' : matchesInstructor(row) ? 'instructor' : matchesTitle(row) ? 'title' : 'subject',
    source: 'grade_distributions',
    sourceLabel: '過去の履修者全体の成績分布（科目名で検索）',
  }));
}

export async function fetchGradeHistory(lecture: LectureIdentity, expectedOwner?: string): Promise<GradeHistoryRow[]> {
  const owner = await getCurrentUserId();
  if (expectedOwner !== undefined && expectedOwner !== owner) throw new Error('アカウントが変更されました。講義を読み直してください。');
  if (!configured) throw new Error('成績分布の取得にはクラウド接続設定が必要です。');
  const subject = cleanSubjectName(lecture.lecture_name);
  if (!subject) return [];
  const { data, error } = await supabase.from('grade_distributions').select(gradeHistoryColumns).eq('subject_name', subject);
  if (await getCurrentUserId() !== owner) throw new Error('アカウントが変更されました。講義を読み直してください。');
  if (error) throw new Error('過去の成績分布を取得できませんでした。接続を確認して再試行してください。');
  return mapGradeHistory((data ?? []) as unknown as GradeDistribution[], lecture);
}

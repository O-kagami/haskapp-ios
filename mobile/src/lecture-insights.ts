import { configured, getCurrentUserId, supabase } from '../web-contract/lib/supabase';
import { assertExpectedOwner } from '../web-contract/lib/api/owner-guard';
import type { LectureWithDetails } from '../web-contract/lib/types';

export const suggestionFields = [
  'classroom', 'lecture_details', 'grading_criteria', 'grading_attendance_required',
  'grading_attendance_total', 'grading_report', 'grading_test', 'grading_quiz',
] as const;
export type SuggestionFieldKey = typeof suggestionFields[number];
type SuggestionValue = string | number;
export type SuggestionValues = Partial<Record<SuggestionFieldKey, SuggestionValue>>;
export type ResourceStatus = {
  requestId?: string;
  status: 'loading' | 'ready' | 'empty' | 'error';
  source: 'live' | 'cache';
  fetchedAt?: string;
  stale: boolean;
  error?: string;
};
/** Creator IDs are internal provenance only. Do not put them in the native preview. */
export type TemplateLectureEvidence = {
  templateId: string;
  creatorId: string | null;
  groupId: string;
  affiliationId: string;
  createdAt: string | null;
  values: SuggestionValues;
};
export type TemplateSuggestionField = {
  key: SuggestionFieldKey;
  label: string;
  value: SuggestionValue;
  currentValue: SuggestionValue | null;
  eligible: boolean;
  sourceTemplateId: string;
  sourceCreatedAt: string | null;
  conflictCount: number;
};
export type TemplateSuggestionPreview = {
  id: string;
  ownerId: string;
  lectureId: string;
  groupId: string;
  affiliationId: string;
  createdAt: string;
  fields: TemplateSuggestionField[];
  sourceLabel: string;
  warning: string;
  /** The persisted API aliases grading_memo to grading_criteria; protect both. */
  baseGradingMemo: string | null;
};
export type InsightStatus = ResourceStatus;
export type TemplateSuggestionState = ResourceStatus & { proposal?: TemplateSuggestionPreview };

type RawTemplate = Record<string, unknown>;
const labels: Record<SuggestionFieldKey, string> = {
  classroom: '教室', lecture_details: '講義詳細', grading_criteria: '評価基準・共有メモ',
  grading_attendance_required: '必要出席回数', grading_attendance_total: '講義回数',
  grading_report: 'レポート', grading_test: '試験', grading_quiz: '小テスト',
};
const sourceFields: Record<SuggestionFieldKey, string> = {
  classroom: 'classroom', lecture_details: 'details', grading_criteria: 'grading_criteria',
  grading_attendance_required: 'attendance_count_needed', grading_attendance_total: 'lecture_count',
  grading_report: 'report_rate', grading_test: 'exam_rate', grading_quiz: 'mini_exam_rate',
};
const percentages: readonly string[] = ['grading_report', 'grading_test', 'grading_quiz'];
const counts: readonly string[] = ['grading_attendance_required', 'grading_attendance_total'];
const textOrNull = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const dateOrNull = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function validValue(key: SuggestionFieldKey, raw: unknown): SuggestionValue | null {
  if (!percentages.includes(key) && !counts.includes(key)) return textOrNull(raw);
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string' && !raw.trim()) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  if (percentages.includes(key)) return Number.isInteger(value) && value <= 100 ? value : null;
  return Number.isInteger(value) ? value : null;
}

/** Map only the columns actually present in the shared schema; no invented year or grade. */
export function mapTemplateLectureEvidence(records: RawTemplate[]): TemplateLectureEvidence[] {
  return records.flatMap(row => {
    const templateId = textOrNull(row.id), groupId = textOrNull(row.group_id), affiliationId = textOrNull(row.affiliation_id);
    if (!templateId || !groupId || !affiliationId) return [];
    const values: SuggestionValues = {};
    for (const key of suggestionFields) {
      const value = validValue(key, row[sourceFields[key]]);
      if (value !== null) values[key] = value;
    }
    return [{ templateId, creatorId: textOrNull(row.user_id), groupId, affiliationId, createdAt: dateOrNull(row.created_at), values }];
  });
}

export const templateEvidenceColumns = 'id,user_id,group_id,affiliation_id,created_at,classroom,details,grading_criteria,lecture_count,attendance_count_needed,report_rate,exam_rate,mini_exam_rate';
/** Read-only. In particular, do not call the legacy affiliation helper, which may upsert. */
export async function fetchTemplateLectureEvidence(groupId: string, affiliationId: string, expectedOwner: string): Promise<TemplateLectureEvidence[]> {
  const owner = await getCurrentUserId();
  assertExpectedOwner(owner, expectedOwner);
  if (!groupId || groupId === '00000000-0000-0000-0000-000000000000' || !affiliationId) return [];
  if (!isUuid(groupId) || !isUuid(affiliationId)) throw new Error('講義グループと所属を確認してから候補を取得してください。');
  if (!configured) throw new Error('共有候補の取得にはクラウド接続設定が必要です。');
  const { data, error } = await supabase.from('user_lecture_data_template')
    .select(templateEvidenceColumns).eq('group_id', groupId).eq('affiliation_id', affiliationId)
    .order('created_at', { ascending: false, nullsFirst: false }).order('id', { ascending: true }).limit(100);
  assertExpectedOwner(await getCurrentUserId(), owner);
  if (error) throw new Error('共有テンプレートを取得できませんでした。接続を確認して再試行してください。');
  return mapTemplateLectureEvidence((data ?? []) as RawTemplate[])
    .filter(row => row.groupId === groupId && row.affiliationId === affiliationId);
}

function currentValue(lecture: LectureWithDetails, key: SuggestionFieldKey): SuggestionValue | null {
  const value = lecture[key];
  // Preserve exact text for stale-base checks, even whitespace-only user changes.
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}
const blank = (value: SuggestionValue | null): boolean => value === null || typeof value === 'string' && !value.trim();
const gradingMemo = (lecture: LectureWithDetails): string | null => typeof lecture.grading_memo === 'string' ? lecture.grading_memo : null;
function recordScore(row: TemplateLectureEvidence): number {
  return suggestionFields.filter(key => key.startsWith('grading_') && row.values[key] !== undefined).length;
}
function hash(text: string): string {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return `${(value >>> 0).toString(36)}-${text.length.toString(36)}`;
}

/** Choose one coherent source record. Completeness is a tie-breaker, not a truth score. */
export function buildTemplateSuggestionPreview(
  lecture: LectureWithDetails, records: TemplateLectureEvidence[], ownerId: string, affiliationId: string,
  createdAt = new Date().toISOString(),
): TemplateSuggestionPreview | null {
  const groupId = lecture.lecture_list_id;
  if (!ownerId || !groupId || groupId === '00000000-0000-0000-0000-000000000000' || !affiliationId) return null;
  const ranked = records.filter(row => row.groupId === groupId && row.affiliationId === affiliationId)
    .map(row => ({ ...row, values: Object.fromEntries(suggestionFields.flatMap(key => {
      const value = validValue(key, row.values[key]);
      return value === null ? [] : [[key, value]];
    })) as SuggestionValues }))
    .sort((a, b) => recordScore(b) - recordScore(a) || Object.keys(b.values).length - Object.keys(a.values).length ||
      compare(b.createdAt ?? '', a.createdAt ?? '') || compare(a.templateId, b.templateId));
  const source = ranked[0];
  if (!source || !Object.keys(source.values).length) return null;
  const fields = suggestionFields.flatMap(key => {
    const value = source.values[key];
    if (value === undefined) return [];
    const current = currentValue(lecture, key);
    return [{ key, label: labels[key], value, currentValue: current,
      eligible: blank(current) && (key !== 'grading_criteria' || blank(gradingMemo(lecture))),
      sourceTemplateId: source.templateId, sourceCreatedAt: source.createdAt,
      conflictCount: ranked.filter(row => row.templateId !== source.templateId && row.values[key] !== undefined && row.values[key] !== value).length,
    }];
  });
  const baseGradingMemo = gradingMemo(lecture);
  const id = `suggestion-${hash(JSON.stringify([ownerId, lecture.id, groupId, affiliationId, fields, baseGradingMemo]))}`;
  return { id, ownerId, lectureId: lecture.id, groupId, affiliationId, createdAt, fields, baseGradingMemo,
    sourceLabel: '共有テンプレート（同じ講義グループ・所属）',
    warning: '共有された参考情報です。対象年度は不明で、登録日時は授業年度を示しません。シラバスと照合して、使う空欄の項目だけ選んでください。成績の予測ではありません。',
  };
}

/** A review generates only a local patch. The engine owns persistence, owner guards and its existing journal. */
export function applyTemplateSuggestion(
  preview: TemplateSuggestionPreview, current: LectureWithDetails, selectedFields: string[], ownerId: string, affiliationId: string,
): Partial<LectureWithDetails> {
  if (preview.ownerId !== ownerId || !ownerId) throw new Error('アカウントが変更されました。候補を読み直してください。');
  if (preview.lectureId !== current.id || preview.groupId !== current.lecture_list_id || preview.affiliationId !== affiliationId)
    throw new Error('講義または所属が変更されました。候補を読み直してください。');
  if (!Array.isArray(selectedFields) || !selectedFields.length) throw new Error('取り込む項目を選んでください。');
  const patch: SuggestionValues = {};
  for (const selected of new Set(selectedFields)) {
    const field = preview.fields.find(row => row.key === selected);
    if (!field || !suggestionFields.includes(field.key) || !field.eligible) throw new Error('選択できない項目が含まれています。候補を読み直してください。');
    const value = currentValue(current, field.key);
    if (value !== field.currentValue || !blank(value) ||
      field.key === 'grading_criteria' && (gradingMemo(current) !== preview.baseGradingMemo || !blank(gradingMemo(current))))
      throw new Error('候補の表示後に内容が変更されました。入力内容を保持しているので、候補を読み直してください。');
    if (validValue(field.key, field.value) !== field.value) throw new Error('共有候補の値を確認できません。候補を読み直してください。');
    patch[field.key] = field.value;
  }
  const merged = { ...current, ...patch };
  const rates = [merged.grading_report, merged.grading_test, merged.grading_quiz];
  if (rates.reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0) > 100)
    throw new Error('評価割合の合計が100%を超えます。共有候補と入力内容を確認してください。');
  if (typeof merged.grading_attendance_required === 'number' && typeof merged.grading_attendance_total === 'number' &&
    merged.grading_attendance_required > merged.grading_attendance_total)
    throw new Error('必要出席回数が講義回数を超えます。共有候補と入力内容を確認してください。');
  // These two UI aliases serialize to one user_lecture_data.grading_criteria
  // column. Once the user explicitly selects this blank field, synchronize the
  // protected blank alias too; retained whitespace must not win during saving.
  if (Object.hasOwn(patch, 'grading_criteria')) {
    return { ...patch, grading_memo: patch.grading_criteria as string } as Partial<LectureWithDetails>;
  }
  return patch as Partial<LectureWithDetails>;
}

export type InsightCache<T> = { version: 1; ownerId: string; contextKey: string; fetchedAt: string; value: T };
export function templateEvidenceContext(groupId: string, affiliationId: string): string { return JSON.stringify([groupId, affiliationId]); }
export function insightCacheKey(kind: 'grades' | 'templates', ownerId: string, contextKey: string): string {
  return `haskapp_lecture_insights_${kind}_${encodeURIComponent(ownerId)}_${encodeURIComponent(contextKey)}`;
}
export function makeInsightCache<T>(ownerId: string, contextKey: string, value: T, fetchedAt = new Date().toISOString()): InsightCache<T> {
  if (!ownerId || !contextKey || !dateOrNull(fetchedAt)) throw new Error('キャッシュの保存元を確認できません。');
  return { version: 1, ownerId, contextKey, fetchedAt, value: JSON.parse(JSON.stringify(value)) as T };
}
export function readInsightCache<T>(raw: unknown, ownerId: string, contextKey: string, now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000): { value: T; fetchedAt: string; stale: boolean } | null {
  if (!raw || typeof raw !== 'object' || !ownerId || !contextKey) return null;
  const cache = raw as Partial<InsightCache<T>>;
  if (cache.version !== 1 || cache.ownerId !== ownerId || cache.contextKey !== contextKey || !dateOrNull(cache.fetchedAt) || cache.value === undefined) return null;
  const age = now - Date.parse(cache.fetchedAt!);
  if (!Number.isFinite(age) || age < 0) return null;
  try {
    return { value: JSON.parse(JSON.stringify(cache.value)) as T, fetchedAt: cache.fetchedAt!, stale: age >= Math.max(0, maxAgeMs) };
  } catch { return null; }
}

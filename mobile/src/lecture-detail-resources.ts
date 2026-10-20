import { faculties } from '../web-contract/lib/setup-templates';
import { getLocal, setLocal } from '../web-contract/lib/api/offline-sync';
import type { LectureWithDetails } from '../web-contract/lib/types';
import { fetchGradeHistory, gradeHistoryContext, type GradeHistoryRow } from './grade-history';
import {
  applyTemplateSuggestion, buildTemplateSuggestionPreview, fetchTemplateLectureEvidence,
  insightCacheKey, makeInsightCache, readInsightCache, templateEvidenceContext,
  type ResourceStatus, type TemplateLectureEvidence, type TemplateSuggestionState,
} from './lecture-insights';

export type LectureDetailResourcesState = {
  gradeHistory: Record<string, GradeHistoryRow[]>;
  gradeHistoryStatus: Record<string, ResourceStatus>;
  templateSuggestions: Record<string, TemplateSuggestionState>;
};
type Context = {
  state: () => LectureDetailResourcesState;
  owner: () => string;
  assertOwner: (owner: string) => Promise<void>;
  lecture: (id: string) => LectureWithDetails | undefined;
  historyLecture?: (id: string) => Pick<LectureWithDetails, 'id' | 'lecture_name' | 'instructor'> | undefined;
  affiliation: () => string | null;
  publish: () => void;
};

/** Unlike the legacy setup helper, an unknown choice must never select a default course. */
export function verifiedSuggestionAffiliation(department: string, major: string): string | null {
  for (const faculty of faculties) {
    if (![faculty.name, faculty.id].includes(department)) continue;
    for (const department of faculty.departments) for (const course of department.courses) {
      if ([course.name, `${department.name} ${course.name}`, course.id, course.affiliationCode].includes(major)) return course.affiliationId;
    }
  }
  return null;
}

function gradeRows(value: unknown): value is GradeHistoryRow[] {
  return Array.isArray(value) && value.every(row => row && typeof row === 'object' &&
    typeof row.id === 'string' && typeof row.academicTerm === 'string' && typeof row.preferred === 'boolean' &&
    ['instructor', 'lectureTitle', 'faculty', 'subjectName', 'courseProgram', 'dataType', 'classCode', 'matchKind', 'source', 'sourceLabel'].every(key => row[key] == null || typeof row[key] === 'string') &&
    ['gpa', 'enrollment'].every(key => row[key] == null || typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] >= 0) &&
    Array.isArray(row.distribution) && row.distribution.length === 11 && row.distribution.every((number: unknown) => number === null || typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 100));
}
function templateRows(value: unknown): value is TemplateLectureEvidence[] {
  return Array.isArray(value) && value.every(row => row && typeof row === 'object' &&
    typeof row.templateId === 'string' && typeof row.groupId === 'string' && typeof row.affiliationId === 'string' &&
    (row.createdAt === null || typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt))) &&
    (row.creatorId == null || typeof row.creatorId === 'string') &&
    row.values && typeof row.values === 'object' && !Array.isArray(row.values));
}

/** Read-only resources and proposal preparation. Saving remains in the existing owner-bound engine path. */
export class LectureDetailResources {
  private readonly historyContexts = new Map<string, string>();
  private readonly proposalContexts = new Map<string, string>();
  constructor(private readonly context: Context) {}

  private historyLecture(id: string) {
    const lecture = this.context.historyLecture?.(id) ?? this.context.lecture(id);
    if (!lecture) throw new Error('講義が見つかりません。');
    return lecture;
  }
  private historyIdentity(id: string) { return JSON.stringify([this.context.owner(), gradeHistoryContext(this.historyLecture(id))]); }
  private proposalIdentity(id: string) { return JSON.stringify([this.context.owner(), this.context.affiliation(), this.context.lecture(id)]); }
  /** Invalidate visible resources after an edit, refresh or account change. Never relabel old data as a new offering. */
  reconcile() {
    const state = this.context.state();
    for (const [id, identity] of this.historyContexts) {
      let same = false;
      try { same = this.historyIdentity(id) === identity; } catch { /* Removed lecture. */ }
      if (!same) { delete state.gradeHistory[id]; delete state.gradeHistoryStatus[id]; this.historyContexts.delete(id); }
    }
    for (const [id, identity] of this.proposalContexts) {
      if (this.proposalIdentity(id) !== identity) { delete state.templateSuggestions[id]; this.proposalContexts.delete(id); }
    }
  }

  private lecture(id: string): LectureWithDetails {
    const lecture = this.context.lecture(id);
    if (!lecture) throw new Error('講義が見つかりません。');
    return lecture;
  }
  private async current(owner: string) {
    await this.context.assertOwner(owner);
    if (this.context.owner() !== owner) throw new Error('アカウントが変更されました。講義を読み直してください。');
  }

  async history(id: string, owner: string): Promise<void> {
    await this.current(owner);
    const lecture = this.historyLecture(id);
    const contextKey = gradeHistoryContext(lecture);
    const key = insightCacheKey('grades', owner, contextKey);
    const stored = readInsightCache<GradeHistoryRow[]>(getLocal(key), owner, contextKey);
    const cache = stored && gradeRows(stored.value) ? stored : null;
    const state = this.context.state();
    this.historyContexts.set(id, this.historyIdentity(id));
    if (cache) state.gradeHistory = { ...state.gradeHistory, [id]: cache.value };
    else delete state.gradeHistory[id];
    state.gradeHistoryStatus = { ...state.gradeHistoryStatus, [id]: { status: 'loading', source: cache ? 'cache' : 'live', fetchedAt: cache?.fetchedAt, stale: cache?.stale ?? false } };
    this.context.publish();
    try {
      const rows = await fetchGradeHistory(lecture, owner);
      await this.current(owner);
      if (gradeHistoryContext(this.historyLecture(id)) !== contextKey) throw new Error('講義情報が変更されました。再読み込みしてください。');
      const saved = makeInsightCache(owner, contextKey, rows);
      setLocal(key, saved);
      const state = this.context.state();
      state.gradeHistory = { ...state.gradeHistory, [id]: rows };
      state.gradeHistoryStatus = { ...state.gradeHistoryStatus, [id]: { status: rows.length ? 'ready' : 'empty', source: 'live', fetchedAt: saved.fetchedAt, stale: false } };
    } catch {
      await this.current(owner);
      const state = this.context.state();
      state.gradeHistoryStatus = { ...state.gradeHistoryStatus, [id]: { status: 'error', source: cache ? 'cache' : 'live', fetchedAt: cache?.fetchedAt, stale: !!cache, error: cache ? '更新できませんでした。保存済みの集計データを表示しています。' : '過去の成績データを取得できませんでした。接続を確認して再試行してください。' } };
    }
    this.context.publish();
  }

  async suggestions(id: string, owner: string, requestId?: string): Promise<void> {
    try { await this.loadSuggestions(id, owner, requestId); }
    catch (error) {
      // A terminal request identity survives coalesced native renders, including
      // failures before loading (auth transport/context validation).
      this.suggestionFailed(id, owner, requestId);
      throw error;
    }
  }

  suggestionFailed(id: string, owner: string, requestId?: string) {
    if (this.context.owner() !== owner || !this.context.lecture(id)) return;
    this.proposalContexts.set(id, this.proposalIdentity(id));
    this.context.state().templateSuggestions = { ...this.context.state().templateSuggestions, [id]: {
      requestId, status: 'error', source: 'live', stale: false, error: '候補の更新を完了できませんでした。内容は保持しています。再試行してください。',
    } };
    this.context.publish();
  }

  private async loadSuggestions(id: string, owner: string, requestId?: string): Promise<void> {
    await this.current(owner);
    const lecture = this.lecture(id);
    this.proposalContexts.set(id, this.proposalIdentity(id));
    const affiliation = this.context.affiliation();
    const group = lecture.lecture_list_id;
    if (!group || !affiliation) {
      this.context.state().templateSuggestions = { ...this.context.state().templateSuggestions, [id]: {
        requestId, status: 'error', source: 'live', stale: false,
        error: !group ? '共有講義IDを確認できないため、名前だけでテンプレートを結び付けません。' : '設定で学部とコースを選択してから候補を確認してください。',
      } };
      this.context.publish(); return;
    }
    const contextKey = templateEvidenceContext(group, affiliation);
    const key = insightCacheKey('templates', owner, contextKey);
    const stored = readInsightCache<TemplateLectureEvidence[]>(getLocal(key), owner, contextKey);
    const cache = stored && templateRows(stored.value) ? stored : null;
    const cachedProposal = cache ? buildTemplateSuggestionPreview(lecture, cache.value, owner, affiliation) ?? undefined : undefined;
    this.context.state().templateSuggestions = { ...this.context.state().templateSuggestions, [id]: { requestId, status: 'loading', source: cache ? 'cache' : 'live', fetchedAt: cache?.fetchedAt, stale: cache?.stale ?? false, proposal: cachedProposal } };
    this.context.publish();
    try {
      const evidence = await fetchTemplateLectureEvidence(group, affiliation, owner);
      await this.current(owner);
      const current = this.lecture(id);
      if (current.lecture_list_id !== group || this.context.affiliation() !== affiliation) throw new Error('所属または講義情報が変更されました。候補を読み直してください。');
      const saved = makeInsightCache(owner, contextKey, evidence);
      setLocal(key, saved);
      const proposal = buildTemplateSuggestionPreview(current, evidence, owner, affiliation) ?? undefined;
      this.proposalContexts.set(id, this.proposalIdentity(id));
      this.context.state().templateSuggestions = { ...this.context.state().templateSuggestions, [id]: { requestId, status: proposal ? 'ready' : 'empty', source: 'live', fetchedAt: saved.fetchedAt, stale: false, proposal } };
    } catch {
      await this.current(owner);
      const current = this.lecture(id);
      const sameContext = current.lecture_list_id === group && this.context.affiliation() === affiliation;
      const proposal = sameContext && cache ? buildTemplateSuggestionPreview(current, cache.value, owner, affiliation) ?? undefined : undefined;
      this.context.state().templateSuggestions = { ...this.context.state().templateSuggestions, [id]: { requestId, status: 'error', source: cache && sameContext ? 'cache' : 'live', fetchedAt: sameContext ? cache?.fetchedAt : undefined, stale: !!proposal, proposal, error: proposal ? '更新できませんでした。保存済みの共有候補です。内容を確認してから選択してください。' : '候補を取得できませんでした。所属と接続を確認して再試行してください。' } };
    }
    this.context.publish();
  }

  async approvedPatch(id: string, proposalId: string, fields: string[], owner: string): Promise<Partial<LectureWithDetails>> {
    await this.current(owner);
    const current = this.lecture(id);
    const affiliation = this.context.affiliation();
    const state = this.context.state().templateSuggestions[id];
    if (!affiliation || !state?.proposal || state.proposal.id !== proposalId || state.status === 'loading') throw new Error('候補が更新されています。内容を再確認してください。');
    return applyTemplateSuggestion(state.proposal, current, fields, owner, affiliation);
  }

  applied(id: string) {
    const { [id]: _, ...remaining } = this.context.state().templateSuggestions;
    this.context.state().templateSuggestions = remaining;
  }
}

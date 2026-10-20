import {assertNoNewConflicts} from '../../../src/planner-rules';
import { assertExpectedOwner } from "./owner-guard";
import { createLocalId } from "@/lib/local-id";
import type {
  GradeDistribution,
  LectureWithDetails,
  JavaScriptDayOfWeek,
  PublicLectureData,
  PublicLectureSearchResult,
} from "@/lib/dashboard";
import { periodTimes, PeriodNumber, getThemeBySyllabusId, LEGACY_DEFAULT_TERM, getTermFromSchedule } from "@/lib/dashboard";
import { supabase, getCurrentUserId, getSupabaseStatus } from "@/lib/supabase";
import {
  fetchWithFallback,
  getLocal,
  cacheOnlineResult,
  mutateWithFallback,
  setLocal,
  handleNetworkError,
  isNetworkError,
} from "./offline-sync";
import { getCurrentAffiliationId } from "./user-settings";
import { toError } from "@/lib/error-utils";

function validGradePercentage(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}
function completeLegacyDistribution(grade: GradeDistribution | null | undefined): number[] | undefined {
  if (!grade) return undefined;
  const values = [grade.aplus_percent, grade.a_percent, grade.aminus_percent, grade.bplus_percent, grade.b_percent,
    grade.bminus_percent, grade.cplus_percent, grade.c_percent, grade.d_percent, grade.dminus_percent, grade.f_percent];
  // Legacy lecture payloads cannot express unknown buckets. The dedicated history
  // resource preserves partial distributions; never turn missing values into zero.
  return values.every(validGradePercentage) ? values as number[] : undefined;
}

function isUuid(id: string | null): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function isUsableSchedule(schedule: { day_of_week: number | null; start_time?: string | null }): boolean {
  return schedule.day_of_week !== null && Number.isInteger(schedule.day_of_week) &&
    schedule.day_of_week >= 0 && schedule.day_of_week <= 6 &&
    typeof schedule.start_time === "string" && schedule.start_time.trim().length > 0;
}

function getPeriodFromSchedule(schedule: { start_time: string }): PeriodNumber {
  const entry = Object.values(periodTimes).find(period => schedule.start_time.startsWith(period.startTime));
  return entry?.period ?? 1;
}

export async function getUserStorageKey(): Promise<string> {
  const userId = await getCurrentUserId();
  return `haskapp_classes_${userId}`;
}


export type TemplateSyncResult = {
  synced: number;
  skipped: number;
};

/**
 * Synchronizes existing lectures when template sharing is enabled.
 * This is separate from lecture saving so existing records are included.
 */
export async function syncCurrentUserLectureTemplates(expectedOwner?: string): Promise<TemplateSyncResult> {
  const userId = await getCurrentUserId();
  assertExpectedOwner(userId, expectedOwner);
  if (
    typeof window === "undefined" ||
    !getSupabaseStatus() ||
    localStorage.getItem("haskapp_share_templates") === "false"
  ) {
    return { synced: 0, skipped: 0 };
  }

  const affiliationId = await getCurrentAffiliationId(userId);
  if (!userId || !affiliationId) {
    throw new Error("Required user or affiliation information is unavailable for template sharing.");
  }

  const { data: lectures, error: lecturesError } = await supabase
    .from("user_lecture_data")
    .select("group_id, classroom, details, grading_criteria, exam_date, no_lecture_date, report_rlate, exam_rate, mini_exam_rate, lecture_count, attendance_count_needed")
    .eq("user_id", userId);
  if (lecturesError) throw lecturesError;

  let synced = 0;
  let skipped = 0;
  const activeGroupIds = new Set<string>();
  for (const lecture of lectures || []) {
    if (!isUuid(lecture.group_id) || lecture.group_id === "00000000-0000-0000-0000-000000000000") {
      skipped += 1;
      continue;
    }

    activeGroupIds.add(lecture.group_id);

    const payload = {
      user_id: userId,
      group_id: lecture.group_id,
      affiliation_id: affiliationId,
      classroom: lecture.classroom || null,
      // Mobile consent covers structured teaching settings only. Never publish
      // free text, personal dates, notes, grades, or feed contents.
      details: null,
      grading_criteria: null,
      exam_date: null,
      no_lecture_date: null,
      report_rate: lecture.report_rlate ?? null,
      exam_rate: lecture.exam_rate ?? null,
      mini_exam_rate: lecture.mini_exam_rate ?? null,
      lecture_count: lecture.lecture_count ?? null,
      attendance_count_needed: lecture.attendance_count_needed ?? null,
    };
    const { data: existing, error: existingError } = await supabase
      .from("user_lecture_data_template")
      .select("id")
      .eq("user_id", userId)
      .eq("group_id", lecture.group_id)
      .eq("affiliation_id", affiliationId)
      .maybeSingle();
    if (existingError) throw existingError;

    const { error } = existing
      ? await supabase.from("user_lecture_data_template").update(payload).eq("id", existing.id).eq("user_id", userId)
      : await supabase.from("user_lecture_data_template").insert(payload);
    if (error) throw error;
    synced += 1;
  }

  const { data: existingTemplates, error: existingTemplatesError } = await supabase
    .from("user_lecture_data_template")
    .select("id, group_id")
    .eq("user_id", userId)
    .eq("affiliation_id", affiliationId);
  if (existingTemplatesError) throw existingTemplatesError;

  const staleTemplateIds = (existingTemplates || [])
    .filter((template) => !activeGroupIds.has(template.group_id))
    .map((template) => template.id);
  if (staleTemplateIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("user_lecture_data_template")
      .delete()
      .in("id", staleTemplateIds)
      .eq("user_id", userId)
      .eq("affiliation_id", affiliationId);
    if (deleteError) throw deleteError;
  }

  return { synced, skipped };
}
export const lecturesApi = {
  /**
   * 初回訪問かどうかを判定する。
   * LocalStorage に haskapp_classes_${userId} が存在しない場合は初回訪問。
   */
  async isFirstVisit(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    const storageKey = await getUserStorageKey();
    return localStorage.getItem(storageKey) === null;
  },

  /**
   * セットアップが完了済みかどうかを判定する。
   */
  async isSetupDone(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    const userId = await getCurrentUserId();
    if (localStorage.getItem(`haskapp_setup_pending_${userId}`) === "true") return false;
    if (localStorage.getItem(`haskapp_setup_done_${userId}`) === "true") {
      return true;
    }
    const storageKey = await getUserStorageKey();
    return localStorage.getItem(storageKey) !== null;
  },

  async isSetupPending(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    const userId = await getCurrentUserId();
    return localStorage.getItem(`haskapp_setup_pending_${userId}`) === "true";
  },

  /** Partial saves must not be mistaken for completed setup after a reload. */
  async markSetupStarted(signal?: AbortSignal, expectedOwner?: string): Promise<void> {
    if (typeof window === "undefined") return;
    const userId = await getCurrentUserId();
    assertExpectedOwner(userId, expectedOwner);
    if (signal?.aborted) return;
    localStorage.setItem(`haskapp_setup_pending_${userId}`, "true");
  },

  /**
   * セットアップ完了フラグを設定する。
   */
  async markSetupDone(signal?: AbortSignal, expectedOwner?: string): Promise<void> {
    if (typeof window === "undefined") return;
    const userId = await getCurrentUserId();
    assertExpectedOwner(userId, expectedOwner);
    if (signal?.aborted) return;
    localStorage.setItem(`haskapp_setup_done_${userId}`, "true");
    localStorage.removeItem(`haskapp_setup_pending_${userId}`);
  },

  async fetchLectures(): Promise<LectureWithDetails[]> {
    const userId = await getCurrentUserId();
    const storageKey = `haskapp_classes_${userId}`;

    const lectures = !isUuid(userId) ? getLocal<LectureWithDetails[]>(storageKey) ?? [] : await fetchWithFallback<LectureWithDetails[]>(
      storageKey,
      async () => {
        const [
          { data: groups, error: e1 },
          { data: schedules, error: e2 },
          { data: publicLectures, error: e3 },
          { data: userLectures, error: e4 }
        ] = await Promise.all([
          supabase.from("groups").select("*"),
          supabase.from("schedules").select("*"),
          supabase.from("public_lecture_data").select("*"),
          supabase.from("user_lecture_data").select("*").eq("user_id", userId)
        ]);

      if (e1 || e2 || e3 || e4) {
        console.error("Error fetching lectures from Supabase, falling back:", {
          groups_error: e1 ? { code: e1.code, message: e1.message } : null,
          schedules_error: e2 ? { code: e2.code, message: e2.message } : null,
          public_error: e3 ? { code: e3.code, message: e3.message } : null,
          user_error: e4 ? { code: e4.code, message: e4.message } : null,
        });
        throw new Error("Supabase query errors"); // fetchWithFallback がフォールバックを処理
      }

      // Query grade distributions
      const subjectNames = Array.from(
        new Set(
          (userLectures || [])
            .map((ulect) => {
              const publect = (publicLectures || []).find((p) => p.group_id === ulect.group_id);
              const group = (groups || []).find((g) => g.id === ulect.group_id);
              const rawName = publect?.name || group?.name || "";
              if (!rawName) return "";
              let cleaned = rawName.replace(/^\d{5,6}\s+/, "");
              const asciiMatch = cleaned.match(/^(.*?)\s+[a-zA-Z]/);
              if (asciiMatch) {
                cleaned = asciiMatch[1];
              }
              cleaned = cleaned.trim();
              const parts = cleaned.split(/[\s　]+/);
              return parts[0];
            })
            .filter((name) => name !== "")
        )
      );

      let gradeDists: GradeDistribution[] = [];
      if (subjectNames.length > 0) {
        const { data, error: e5 } = await supabase
          .from("grade_distributions")
          .select("*")
          .in("subject_name", subjectNames);
        if (!e5 && data) {
          gradeDists = data;
        } else if (e5) {
          console.error("Error fetching grade_distributions from Supabase:", e5);
        }
      }

      const result: LectureWithDetails[] = [];

      for (const ulect of (userLectures || [])) {
        const isNullGroup = !ulect.group_id || ulect.group_id === "00000000-0000-0000-0000-000000000000";
        const publect = isNullGroup ? null : (publicLectures || []).find(p => p.group_id === ulect.group_id);
        const group = isNullGroup ? null : (groups || []).find(g => g.id === ulect.group_id);
        const linkedSchedules = isNullGroup ? [] : (schedules || []).filter(
          (s) => s.group_id === ulect.group_id && isUsableSchedule(s)
        );

        const lectureName = publect?.name || group?.name || "無題の講義";
        const syllabusId = publect?.syllabus_id || null;
        const absences = ulect.absence_count ?? undefined;
        const grading_attendance_required = ulect.attendance_count_needed ?? undefined;
        const grading_attendance_total = ulect.lecture_count ?? undefined;
        const grading_report = ulect.report_rlate ?? undefined;
        const grading_test = ulect.exam_rate ?? undefined;
        const grading_quiz = ulect.mini_exam_rate ?? undefined;
        const grading_memo = ulect.grading_criteria || undefined;

        // Clean and split subject name for matching
        let cleanName = lectureName.replace(/^\d{5,6}\s+/, "");
        const asciiMatch = cleanName.match(/^(.*?)\s+[a-zA-Z]/);
        if (asciiMatch) {
          cleanName = asciiMatch[1];
        }
        cleanName = cleanName.trim().split(/[\s　]+/)[0];

        const currentInstructor = publect?.teacher || "未登録教員";
        const cleanInstructor = currentInstructor.split(/\s+/)[0];

        const matchedDists = gradeDists.filter(g => g.subject_name === cleanName);
        let gradeDist = null;
        if (matchedDists.length > 0) {
          // Sort by term descending
          const sortedDists = [...matchedDists].sort((a, b) => {
            const termA = a.academic_term || "";
            const termB = b.academic_term || "";
            return termB.localeCompare(termA);
          });

          if (cleanInstructor && cleanInstructor !== "未登録教員") {
            gradeDist = sortedDists.find(g => g.instructor_name && g.instructor_name.includes(cleanInstructor));
          }
          if (!gradeDist) {
            gradeDist = sortedDists[0]; // Fallback to newest record
          }
        }

        // Meta details config
        const rawTeacher = publect?.teacher || "未登録教員";
        const truncatedTeacher = rawTeacher.length >= 90 ? rawTeacher.slice(0, 90) + "..." : rawTeacher;
        const meta = {
          instructor: truncatedTeacher,
          credits: undefined,
          gpa: gradeDist && gradeDist.gpa !== null && gradeDist.gpa !== undefined ? gradeDist.gpa.toFixed(2) : undefined,
          aRate: gradeDist && [gradeDist.aplus_percent, gradeDist.a_percent, gradeDist.aminus_percent].every(validGradePercentage) ? `${(gradeDist.aplus_percent! + gradeDist.a_percent! + gradeDist.aminus_percent!).toFixed(1)} %` : undefined,
          passRate: gradeDist && validGradePercentage(gradeDist.f_percent) ? `${(100 - gradeDist.f_percent!).toFixed(1)} %` : undefined,
          discipline: gradeDist?.faculty || undefined,
          historicalInstructor: gradeDist?.instructor_name || undefined,
          historicalEnrollment: gradeDist?.student_count !== null && gradeDist?.student_count !== undefined ? `${gradeDist.student_count} 人` : undefined,
          gradeDistribution: completeLegacyDistribution(gradeDist),
          colorTheme: getThemeBySyllabusId(syllabusId),
          test_datetime: ulect.exam_date || null,
          syllabus_id: syllabusId,
          cancelled_date: ulect.no_lecture_date || null,
          schedule_is_shared: true
        };

        if (linkedSchedules.length === 0) {
          result.push({
            id: ulect.id,
            lecture_list_id: ulect.group_id,
            term: ulect.term || LEGACY_DEFAULT_TERM,
            lecture_name: lectureName,
            classroom: ulect.classroom || publect?.classroom || "",
            day_of_the_week: 1, // デフォルト月曜
            period: 1,
            grading_criteria: ulect.grading_criteria || "",
            lecture_details: ulect.details || publect?.details || "",
            memo: ulect.memo || "",
            absences,
            grading_attendance_required,
            grading_attendance_total,
            grading_report,
            grading_test,
            grading_quiz,
            grading_memo,
            ...meta
          });
        } else {
          linkedSchedules.forEach(s => {
            if (s.day_of_week === null) return;
            const dayNum = s.day_of_week as JavaScriptDayOfWeek;

            // start_time から時限（1〜5限）へのマッピング
            let period: PeriodNumber = 1;
            if (s.start_time.startsWith("10:30")) period = 2;
            else if (s.start_time.startsWith("13:00")) period = 3;
            else if (s.start_time.startsWith("14:45")) period = 4;
            else if (s.start_time.startsWith("16:30")) period = 5;

            result.push({
              id: `${ulect.id}_${s.id}`,
              lecture_list_id: ulect.group_id,
              term: getTermFromSchedule(s) || ulect.term || LEGACY_DEFAULT_TERM,
              lecture_name: lectureName,
              classroom: ulect.classroom || publect?.classroom || "",
              day_of_the_week: dayNum,
              period,
              grading_criteria: ulect.grading_criteria || "",
              lecture_details: ulect.details || publect?.details || "",
              memo: ulect.memo || "",
              absences,
              grading_attendance_required,
              grading_attendance_total,
              grading_report,
              grading_test,
              grading_quiz,
              grading_memo,
              ...meta
            });
          });
        }
      }

        return result;
      },
      [],
    );

    // 旧キャッシュは日曜を7として保存していたため、JavaScript規約へ一度だけ移行する。
    const normalizedLectures = lectures.map((lecture) => {
      const cachedDay = Number(lecture.day_of_the_week);
      return cachedDay === 7
        ? { ...lecture, day_of_the_week: 0 as JavaScriptDayOfWeek }
        : lecture;
    });
    cacheOnlineResult(storageKey, normalizedLectures);
    return normalizedLectures;
  },

  async saveLecture(dataInput: Omit<LectureWithDetails, "id"> & { id?: string }, currentClasses: LectureWithDetails[], expectedOwner?: string, occupiedClasses: LectureWithDetails[] = currentClasses): Promise<LectureWithDetails> {
    const userId = await getCurrentUserId();
    assertExpectedOwner(userId, expectedOwner);
    const storageKey = `haskapp_classes_${userId}`;
    const rawInstructor = dataInput.instructor || "";
    const data = { ...dataInput, instructor: rawInstructor.length >= 90 ? rawInstructor.slice(0, 90) + "..." : rawInstructor };
    const buildOffline = (): LectureWithDetails => ({ ...data, id: data.id || createLocalId("class") });
    const buildOfflineList = (saved: LectureWithDetails) => {
      const enrollmentId = saved.id.split("_")[0];
      const shared = {
        classroom: saved.classroom, grading_criteria: saved.grading_criteria,
        lecture_details: saved.lecture_details, memo: saved.memo, absences: saved.absences,
        grading_attendance_required: saved.grading_attendance_required,
        grading_attendance_total: saved.grading_attendance_total,
        grading_report: saved.grading_report, grading_test: saved.grading_test,
        grading_quiz: saved.grading_quiz, grading_memo: saved.grading_memo,
        test_datetime: saved.test_datetime, cancelled_date: saved.cancelled_date,
      };
      const updated = currentClasses.map(c => c.id === data.id ? saved :
        (isUuid(enrollmentId) && c.id.split("_")[0].toLowerCase() === enrollmentId.toLowerCase() ||
          isUuid(userId) && !!saved.lecture_list_id && isUuid(saved.lecture_list_id) && c.lecture_list_id === saved.lecture_list_id)
          ? { ...c, ...shared } : c);
      return updated.some(c => c.id === saved.id) ? updated : [...updated, saved];
    };
    if (!isUuid(userId) || !getSupabaseStatus()) {
      const saved = buildOffline();
      setLocal(storageKey, buildOfflineList(saved));
      return saved;
    }

    try {
      let groupId = data.lecture_list_id || null;
      if (!groupId || !isUuid(groupId)) {
        const { data: group, error } = await supabase.from("groups").select("id")
          .eq("name", data.lecture_name).limit(1).maybeSingle();
        if (error) throw toError(error, "講義グループの確認に失敗しました");
        groupId = group?.id ?? null;
      }
      if (!groupId || !isUuid(groupId) || groupId === "00000000-0000-0000-0000-000000000000") {
        throw new Error("この講義に対応する共有グループがありません。共有講義検索から登録してください。");
      }
      groupId = groupId.toLowerCase();
      // The deployed Web schema owns schedules centrally. Ordinary users may edit
      // their enrollment metadata, but must never write these shared canonical rows.
      const [groupResult, publicResult, scheduleResult] = await Promise.all([
        supabase.from("groups").select("id, name").eq("id", groupId).maybeSingle(),
        supabase.from("public_lecture_data").select("*").eq("group_id", groupId).limit(1).maybeSingle(),
        supabase.from("schedules").select("*").eq("group_id", groupId),
      ]);
      if (groupResult.error || publicResult.error || scheduleResult.error) {
        throw toError(groupResult.error ?? publicResult.error ?? scheduleResult.error, "共有時間割を確認できませんでした");
      }
      if (!groupResult.data) throw new Error("共有講義グループが見つかりません。");
      const canonicalName = publicResult.data?.name || groupResult.data.name;
      const rawTeacher = publicResult.data?.teacher || "未登録教員";
      const canonicalTeacher = rawTeacher.length >= 90 ? rawTeacher.slice(0, 90) + "..." : rawTeacher;
      const canonicalSchedules = (scheduleResult.data ?? []).filter(schedule =>
        schedule.group_id === groupId && isUsableSchedule(schedule));
      if (!canonicalSchedules.length) throw new Error("共有時限が未登録です。個人の時限は現在のデータベースに保存できません。");
      if (!currentClasses.some(row => row.lecture_list_id === groupId)) {
        assertNoNewConflicts(canonicalSchedules.map(schedule => ({ id: `incoming-${schedule.id}`, lecture_name: canonicalName, term: getTermFromSchedule(schedule) ?? LEGACY_DEFAULT_TERM, day_of_the_week: schedule.day_of_week, period: getPeriodFromSchedule(schedule) })), occupiedClasses);
      }
      const [, schedulePart] = (data.id ?? "").split("_");
      const selected = canonicalSchedules.find(schedule =>
        (!isUuid(schedulePart ?? null) || schedule.id.toLowerCase() === schedulePart.toLowerCase()) &&
        schedule.day_of_week === data.day_of_the_week && getPeriodFromSchedule(schedule) === data.period &&
        (data.term === undefined || (getTermFromSchedule(schedule) ?? LEGACY_DEFAULT_TERM) === data.term));
      const teacherMatches = data.instructor === canonicalTeacher || !publicResult.data?.teacher &&
        ["", "未登録教員", "担当教員"].includes(data.instructor);
      if (!selected || data.lecture_name.trim() !== canonicalName.trim() || !teacherMatches) {
        throw new Error("講義名・教員・曜日・時限・タームは共有時間割のため変更できません。共有講義を読み直してください。");
      }

      const userLecturePart = data.id?.split("_")[0];
      const userLectureId = userLecturePart && isUuid(userLecturePart) ? userLecturePart.toLowerCase() : null;
      let query = supabase.from("user_lecture_data").select("id, group_id").eq("user_id", userId);
      query = userLectureId ? query.eq("id", userLectureId) : query.eq("group_id", groupId);
      const { data: existing, error: lookupError } = await query.limit(1).maybeSingle();
      if (lookupError) throw toError(lookupError, "講義情報の確認に失敗しました");
      if (userLectureId && (!existing || existing.group_id !== groupId)) {
        throw new Error("講義情報が見つからないか、更新する権限がありません。");
      }
      const payload = {
        user_id: userId, group_id: groupId,
        grading_criteria: data.grading_memo || data.grading_criteria || null,
        classroom: data.classroom || null, details: data.lecture_details || null, memo: data.memo || null,
        exam_date: data.test_datetime?.slice(0, 10) || null, no_lecture_date: data.cancelled_date?.slice(0, 10) || null,
        absence_count: data.absences ?? null,
        attendance_count_needed: data.grading_attendance_required ?? null,
        lecture_count: data.grading_attendance_total ?? null,
        report_rlate: data.grading_report ?? null, exam_rate: data.grading_test ?? null, mini_exam_rate: data.grading_quiz ?? null,
      };
      const result = existing
        ? await supabase.from("user_lecture_data").update(payload).eq("id", existing.id).eq("user_id", userId).select("id").single()
        : await supabase.from("user_lecture_data").insert(payload).select("id").single();
      if (result.error || !result.data?.id) throw toError(result.error, "講義情報を保存できませんでした");
      const finalId = result.data.id;
      const slots: LectureWithDetails[] = canonicalSchedules.map(schedule => ({
        ...data, id: `${finalId}_${schedule.id}`, lecture_list_id: groupId!,
        lecture_name: canonicalName, instructor: canonicalTeacher,
        day_of_the_week: schedule.day_of_week as JavaScriptDayOfWeek,
        period: getPeriodFromSchedule(schedule), term: getTermFromSchedule(schedule) ?? LEGACY_DEFAULT_TERM,
        schedule_is_shared: true,
        syllabus_id: publicResult.data?.syllabus_id ?? null,
        colorTheme: getThemeBySyllabusId(publicResult.data?.syllabus_id),
      }));
      const saved = slots.find(slot => slot.id === `${finalId}_${selected.id}`)!;
      const others = currentClasses.filter(c => c.id !== data.id && c.id.split("_")[0] !== finalId && c.lecture_list_id !== groupId);
      cacheOnlineResult(storageKey, [...others, ...slots]);
      return saved;
    } catch (err) {
      if (!isNetworkError(err)) throw toError(err, "講義を保存できませんでした");
      handleNetworkError(err);
      const saved = buildOffline();
      setLocal(storageKey, buildOfflineList(saved));
      return saved;
    }
  },

  /** Apply reviewed template fields only. Never send unrelated personal or canonical columns. */
  async applyLectureFields(id: string, patch: Partial<LectureWithDetails>, currentClasses: LectureWithDetails[], expectedOwner?: string): Promise<LectureWithDetails> {
    const userId = await getCurrentUserId();
    assertExpectedOwner(userId, expectedOwner);
    const storageKey = `haskapp_classes_${userId}`;
    const current = currentClasses.find(lecture => lecture.id === id);
    const invocationBase = new Map(currentClasses.map(lecture => [lecture.id, { ...lecture }]));
    if (!current) throw new Error("講義が見つかりません。内容を読み直してください。");
    const columns: Record<string, string> = {
      classroom: "classroom", lecture_details: "details", grading_criteria: "grading_criteria", grading_memo: "grading_criteria",
      grading_attendance_required: "attendance_count_needed", grading_attendance_total: "lecture_count",
      grading_report: "report_rlate", grading_test: "exam_rate", grading_quiz: "mini_exam_rate",
    };
    if (!patch || typeof patch !== "object" || Array.isArray(patch) || !Object.keys(patch).length)
      throw new Error("取り込む項目を選んでください。");
    const values: Record<string, string | number> = {};
    const localPatch: Partial<LectureWithDetails> = {};
    for (const [key, value] of Object.entries(patch)) {
      const column = columns[key];
      if (!Object.hasOwn(columns, key)) throw new Error("共有候補から変更できない項目が含まれています。");
      if (["classroom", "details", "grading_criteria"].includes(column)) {
        if (typeof value !== "string" || !value.trim()) throw new Error("共有候補の文字列を確認してください。");
      } else if (typeof value !== "number" || !Number.isInteger(value) || value < 0 ||
        value > (["report_rlate", "exam_rate", "mini_exam_rate"].includes(column) ? 100 : 32767)) {
        throw new Error("共有候補の割合・回数を確認してください。");
      }
      if (Object.hasOwn(values, column) && values[column] !== value)
        throw new Error("評価基準と評価メモが一致していません。候補を読み直してください。");
      values[column] = value as string | number;
      Object.assign(localPatch, { [key]: value });
      if (column === "grading_criteria") Object.assign(localPatch, { grading_criteria: value, grading_memo: value });
    }
    const selected = Object.keys(values);
    const enrollmentId = id.split("_")[0].toLowerCase();
    const groupId = current.lecture_list_id?.toLowerCase();
    const blank = (value: unknown): boolean => value == null || typeof value === "string" && !value.trim();
    const same = (a: unknown, b: unknown): boolean => a === b;
    const conflict = () => new Error("選択した項目は別の端末または操作で変更されています。入力内容を保持しているので、候補を読み直してください。");
    const checkCombined = (row: Record<string, unknown>) => {
      if (selected.some(column => ["report_rlate", "exam_rate", "mini_exam_rate"].includes(column))) {
        const sum = ["report_rlate", "exam_rate", "mini_exam_rate"].reduce<number>((total, column) => {
          const value = Object.hasOwn(values, column) ? values[column] : row[column];
          return total + (typeof value === "number" ? value : 0);
        }, 0);
        if (sum > 100) throw new Error("評価割合の合計が100%を超えます。入力内容を確認してください。");
      }
      if (selected.some(column => ["attendance_count_needed", "lecture_count"].includes(column))) {
        const needed = values.attendance_count_needed ?? row.attendance_count_needed;
        const total = values.lecture_count ?? row.lecture_count;
        if (typeof needed === "number" && typeof total === "number" && needed > total)
          throw new Error("必要出席回数が講義回数を超えます。入力内容を確認してください。");
      }
    };
    const matches = (lecture: LectureWithDetails) => lecture.id === id ||
      isUuid(enrollmentId) && lecture.id.split("_")[0].toLowerCase() === enrollmentId ||
      !!groupId && isUuid(groupId) && groupId !== "00000000-0000-0000-0000-000000000000" && lecture.lecture_list_id?.toLowerCase() === groupId;
    const localValues = (lecture: LectureWithDetails) => Object.fromEntries(Object.entries(columns).map(([key, column]) =>
      [column, column === "grading_criteria" ? lecture.grading_memo?.trim() ? lecture.grading_memo : lecture.grading_criteria : lecture[key as keyof LectureWithDetails]]));
    const unchangedColumn = (lecture: LectureWithDetails, column: string): boolean => {
      const base = invocationBase.get(lecture.id);
      return !!base && Object.entries(columns).filter(([, mapped]) => mapped === column).every(([key]) =>
        lecture[key as keyof LectureWithDetails] === base[key as keyof LectureWithDetails]);
    };
    const mergeCache = async (offline: boolean): Promise<LectureWithDetails> => {
      assertExpectedOwner(await getCurrentUserId(), userId);
      // Read the latest owner cache, so an in-flight response cannot replace unrelated newer edits.
      const latest = getLocal<LectureWithDetails[]>(storageKey) ?? currentClasses;
      const latestCurrent = latest.find(lecture => lecture.id === id);
      // A successful earlier journal operation may precede a queued deletion.
      // Never resurrect that enrollment in the final local cache; allow replay
      // to advance to its delete. Offline fallback cannot confirm that prefix.
      if (!latestCurrent && !offline) return current;
      if (!latestCurrent || latestCurrent.lecture_list_id?.toLowerCase() !== groupId)
        throw new Error("講義が削除または変更されました。内容を読み直してください。");
      if (offline) {
        for (const lecture of latest.filter(matches)) {
          const row = localValues(lecture);
          for (const column of selected) {
            if (!blank(row[column]) && !same(row[column], values[column])) throw conflict();
            if (!unchangedColumn(lecture, column) && !same(row[column], values[column])) throw conflict();
          }
          checkCombined(row);
        }
      }
      const updated = latest.map(lecture => {
        if (!matches(lecture)) return lecture;
        const result = { ...lecture };
        const row = localValues(lecture);
        for (const [key, value] of Object.entries(localPatch)) {
          // An old journal entry may finish while a later local edit is pending. Keep that edit.
          const column = columns[key];
          if ((blank(row[column]) && unchangedColumn(lecture, column)) || same(row[column], value)) Object.assign(result, { [key]: value });
        }
        return result;
      });
      if (offline) setLocal(storageKey, updated); else cacheOnlineResult(storageKey, updated);
      return updated.find(lecture => lecture.id === id)!;
    };
    if (!isUuid(userId) || !getSupabaseStatus()) return mergeCache(true);
    if (!isUuid(enrollmentId) || !groupId || !isUuid(groupId) || groupId === "00000000-0000-0000-0000-000000000000")
      throw new Error("登録済みの講義グループを確認できません。共有講義を読み直してください。");
    try {
      // Guard related totals as well: another device must not invalidate their combined constraints.
      const guarded = new Set(selected);
      if (selected.some(column => ["report_rlate", "exam_rate", "mini_exam_rate"].includes(column)))
        for (const column of ["report_rlate", "exam_rate", "mini_exam_rate"]) guarded.add(column);
      if (selected.some(column => ["attendance_count_needed", "lecture_count"].includes(column)))
        for (const column of ["attendance_count_needed", "lecture_count"]) guarded.add(column);
      const { data, error } = await supabase.from("user_lecture_data")
        .select(["id", "group_id", ...guarded].join(",")).eq("id", enrollmentId).eq("user_id", userId).eq("group_id", groupId).maybeSingle();
      assertExpectedOwner(await getCurrentUserId(), userId);
      if (error) throw toError(error, "講義情報を確認できませんでした。");
      const existing = data as unknown as Record<string, unknown> | null;
      if (!existing || existing.id !== enrollmentId || existing.group_id !== groupId)
        throw new Error("講義情報が見つからないか、更新する権限がありません。");
      const changed: Record<string, string | number> = {};
      for (const column of selected) {
        if (!Object.hasOwn(existing, column) || existing[column] === undefined) throw conflict();
        if (!same(existing[column], values[column])) {
          if (!blank(existing[column])) throw conflict();
          changed[column] = values[column];
        }
      }
      checkCombined(existing);
      if (Object.keys(changed).length) {
        // All selected values, even already-equal ones, participate in this atomic compare-and-set.
        let query = supabase.from("user_lecture_data").update(changed)
          .eq("id", enrollmentId).eq("user_id", userId).eq("group_id", groupId);
        for (const column of guarded) {
          if (!Object.hasOwn(existing, column) || existing[column] === undefined) throw conflict();
          query = existing[column] === null ? query.is(column, null) : query.eq(column, existing[column]);
        }
        const result = await query.select("*").single();
        assertExpectedOwner(await getCurrentUserId(), userId);
        if (result.error) {
          if (isNetworkError(result.error)) throw toError(result.error, "講義情報を保存できませんでした。");
          throw conflict();
        }
        if (!result.data || result.data.id !== enrollmentId || result.data.group_id !== groupId ||
          selected.some(column => result.data[column] !== values[column])) throw conflict();
      }
      return await mergeCache(false);
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      assertExpectedOwner(await getCurrentUserId(), userId);
      handleNetworkError(error);
      return mergeCache(true);
    }
  },

  async deleteLecture(id: string, currentClasses: LectureWithDetails[], expectedOwner?: string): Promise<void> {
    const userId = await getCurrentUserId();
    assertExpectedOwner(userId, expectedOwner);
    const storageKey = `haskapp_classes_${userId}`;
    const part = id.split("_")[0];
    const userLectureId = isUuid(part) ? part.toLowerCase() : null;
    const targetGroup = currentClasses.find(c => c.id === id)?.lecture_list_id;
    const removeGroup = isUuid(userId) && !!targetGroup && isUuid(targetGroup) && targetGroup !== "00000000-0000-0000-0000-000000000000";
    const buildUpdated = () => currentClasses.filter(c => c.id !== id &&
      !(userLectureId && c.id.split("_")[0].toLowerCase() === userLectureId) &&
      !(removeGroup && c.lecture_list_id === targetGroup));
    if (!isUuid(userId) || !userLectureId) {
      setLocal(storageKey, buildUpdated());
      return;
    }
    await mutateWithFallback<LectureWithDetails[]>(storageKey, async () => {
      const { error } = await supabase.from("user_lecture_data").delete()
        .eq("id", userLectureId).eq("user_id", userId);
      if (error) throw toError(error, "講義の登録を削除できませんでした");
      const { data: remaining, error: readError } = await supabase.from("user_lecture_data")
        .select("id").eq("id", userLectureId).eq("user_id", userId).maybeSingle();
      if (readError) throw toError(readError, "講義の登録解除を確認できませんでした");
      if (remaining) throw new Error("講義の登録解除が確認できませんでした。");
      return buildUpdated();
    }, buildUpdated);
  },

  async updateAbsences(id: string, absences: number, currentClasses: LectureWithDetails[], expectedOwner?: string): Promise<void> {
    const userId = await getCurrentUserId();
    assertExpectedOwner(userId, expectedOwner);
    const storageKey = `haskapp_classes_${userId}`;
    const currentClass = currentClasses.find((c) => c.id === id);
    if (!currentClass) return;
    if (!Number.isFinite(absences)) throw new Error("欠席数は数値で入力してください。");
    const maximum = currentClass.grading_attendance_total == null ? Number.MAX_SAFE_INTEGER : Math.max(0, currentClass.grading_attendance_total);
    const clampedAbsences = Math.min(maximum, Math.max(0, Math.trunc(absences)));
    const userLectureId = id.split("_")[0];
    const buildUpdated = () => currentClasses.map((c) => c.id === id ||
      isUuid(userLectureId) && c.id.split("_")[0] === userLectureId ||
      isUuid(userId) && !!currentClass.lecture_list_id && isUuid(currentClass.lecture_list_id) &&
        currentClass.lecture_list_id !== "00000000-0000-0000-0000-000000000000" && c.lecture_list_id === currentClass.lecture_list_id
      ? { ...c, absences: clampedAbsences } : c);
    if (!isUuid(userId) || !isUuid(userLectureId)) {
      setLocal(storageKey, buildUpdated());
      return;
    }
    await mutateWithFallback<LectureWithDetails[]>(storageKey, async () => {
      const { data: updated, error } = await supabase.from("user_lecture_data")
        .update({ absence_count: clampedAbsences }).eq("id", userLectureId).eq("user_id", userId)
        .select("id").single();
      if (error || !updated) throw toError(error, "欠席数を保存できませんでした");
      return buildUpdated();
    }, buildUpdated);
  },

  async searchPublicLectures(query: string): Promise<PublicLectureSearchResult[]> {
    if (typeof window === "undefined" || !query.trim()) return [];
    if (!getSupabaseStatus()) {
      return [];
    }

    try {
      const { data, error } = await supabase
        .from("groups")
        .select(`
          id,
          name,
          public_lecture_data (
            id,
            name,
            teacher,
            syllabus_id,
            classroom,
            details
          ),
          schedules (
            day_of_week,
            start_time,
            end_time,
            period_start_daytime
          )
        `)
        .ilike("name", `%${query}%`)
        .limit(20);

      if (error) {
        console.error("Error searching groups from Supabase:", error);
        return [];
      }
      return ((data || []) as PublicLectureSearchResult[]).map(result => ({
        ...result,
        schedules: (result.schedules ?? []).filter(isUsableSchedule),
      }));
    } catch (err) {
      console.error("Unexpected failure in searchPublicLectures:", err);
      return [];
    }
  },

  async getPublicLectureBySyllabusId(syllabusId: string): Promise<PublicLectureData | null> {
    if (typeof window === "undefined" || !syllabusId) return null;
    if (!getSupabaseStatus()) return null;

    try {
      const { data, error } = await supabase
        .from("public_lecture_data")
        .select("*")
        .eq("syllabus_id", syllabusId)
        .limit(1);

      if (error) {
        console.error("Error fetching public lecture by syllabus_id:", error);
        return null;
      }

      return data && data.length > 0 ? (data[0] as PublicLectureData) : null;
    } catch (err) {
      console.error("Unexpected failure in getPublicLectureBySyllabusId:", err);
      return null;
    }
  },

  async saveAllLectures(newClasses: LectureWithDetails[], expectedOwner?: string): Promise<void> {
    if (typeof window === "undefined") return;
    const userId = await getCurrentUserId();
    assertExpectedOwner(userId, expectedOwner);
    const storageKey = `haskapp_classes_${userId}`;
    if (!newClasses.length) { setLocal(storageKey, []); return; }
    let currentClasses: LectureWithDetails[] = [];
    for (const cls of newClasses) {
      const saved = await this.saveLecture(cls, currentClasses, userId);
      const cached = getLocal<LectureWithDetails[]>(storageKey);
      // One enrollment expands to all canonical slots; never overwrite that cache
      // with only the selected return row at the end of the batch.
      currentClasses = cached?.some(c => c.id === saved.id) ? cached :
        [...currentClasses.filter(c => c.id !== cls.id && c.id !== saved.id), saved];
    }
  }
};

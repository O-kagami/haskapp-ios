import { getTermFromSchedule, LEGACY_DEFAULT_TERM } from "@/lib/dashboard";
import { AccountOwnerChangedError, assertExpectedOwner } from "./owner-guard";
import { getAffiliationId } from "@/lib/setup-templates";
import { supabase, getCurrentUserId, getSupabaseStatus } from "@/lib/supabase";
import type { GradeDistribution, JavaScriptDayOfWeek, PublicLectureData, Schedule } from "@/lib/dashboard";

function getGroupName(groups: unknown): string {
  if (!groups || typeof groups !== "object" || !("name" in groups)) return "";
  const name = (groups as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}

/**
 * 学部・学科・コース情報を Supabase の department_and_major テーブルに保存/取得します。
 */
export async function saveDepartmentAndMajorToSupabase(
  department: string,
  major: string,
  expectedOwner?: string
): Promise<string | null> {
  const userId = await getCurrentUserId();
  assertExpectedOwner(userId, expectedOwner);
  if (!department || !major || typeof window === "undefined") return null;
  if (!getSupabaseStatus()) return null;
  if (!userId) return null;
  try {

    // すでに同じ組み合わせが存在するか確認 (public/admin作成のレコードを検索)
    const { data: existing } = await supabase
      .from("department_and_major")
      .select("id")
      .eq("department", department)
      .eq("major", major)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      return existing.id;
    }

    const { data: newRow, error } = await supabase
      .from("department_and_major")
      .insert({
        department,
        major,
        user_id: userId,
      })
      .select("id")
      .single();

    if (error) {
      console.warn("Notice: department_and_major insert restricted by policy or skipped:", error.message || error);
      return null;
    }
    return newRow?.id || null;
  } catch (err) {
    console.error("Exception in saveDepartmentAndMajorToSupabase:", err);
    return null;
  }
}

/** Read only the signed-in user's iCal URL from Supabase. */
export async function getIcalUrlFromSupabase(): Promise<{ userId: string; icalUrl: string | null }> {
  if (typeof window === "undefined" || !getSupabaseStatus()) {
    throw new Error("iCal database is unavailable.");
  }

  const userId = await getCurrentUserId();
  if (!userId) throw new Error("A signed-in user is required to read the iCal URL.");

  const { data, error } = await supabase
    .from("ical_url_users")
    .select("ical_url")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error("Could not read the iCal URL from the database.");
  return {
    userId,
    icalUrl: typeof data?.ical_url === "string" && data.ical_url.trim() ? data.ical_url.trim() : null,
  };
}

/** Save or clear the signed-in user's iCal URL in Supabase. */
export async function saveIcalUrlToSupabase(icalUrl: string, expectedOwner?: string): Promise<string> {
  const userId = await getCurrentUserId();
  assertExpectedOwner(userId, expectedOwner);
  if (typeof window === "undefined" || !getSupabaseStatus()) {
    throw new Error("iCal database is unavailable.");
  }

  if (!userId) throw new Error("A signed-in user is required to save the iCal URL.");

  const trimmed = icalUrl.trim();
  const { data: existing, error: selectError } = await supabase
    .from("ical_url_users")
    .select("id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (selectError) throw new Error("Could not find the iCal settings row.");
  if (!existing && !trimmed) return userId;

  const { error } = existing
    ? await supabase
        .from("ical_url_users")
        .update({ ical_url: trimmed })
        .eq("id", existing.id)
        .eq("user_id", userId)
    : await supabase
        .from("ical_url_users")
        .insert({ user_id: userId, ical_url: trimmed });

  if (error) throw new Error("Could not save the iCal URL to the database.");
  return userId;
}

/**
 * Supabase からユーザーの設定情報 (学部学科, iCal URL) を取得します。
 */
export async function getUserSettingsFromSupabase(): Promise<{
  department: string | null;
  major: string | null;
}> {
  if (typeof window === "undefined" || !getSupabaseStatus()) {
    return { department: null, major: null };
  }

  try {
    const userId = await getCurrentUserId();
    if (!userId) return { department: null, major: null };

    const { data: deptData } = await supabase
      .from("department_and_major")
      .select("department, major")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      department: deptData?.department || null,
      major: deptData?.major || null,
    };
  } catch (err) {
    console.error("Exception in getUserSettingsFromSupabase:", err);
    return { department: null, major: null };
  }
}


function isUuid(id: string | null): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * 学部・学科・コース情報に対応する確定 affiliation_id (UUID) をプロジェクト内定義から取得します。
 * （例: 工学部(1)-情エレ(1)-電気制御(3) => "00000001-0001-0003-0000-000000000000"）
 */
export async function getOrCreateAffiliation(
  faculty: string,
  major: string,
  expectedOwner?: string
): Promise<string> {
  const userId = await getCurrentUserId();
  assertExpectedOwner(userId, expectedOwner);
  const affUuid = getAffiliationId(faculty, major);
  if (typeof window !== "undefined") {
    localStorage.setItem("haskapp_affiliation_id", affUuid);
  }

  // FK制約を満たすため affiliation テーブルに確定レコードを確保
  if (getSupabaseStatus()) {
    try {
      if (userId && isUuid(userId)) {
        await supabase
          .from("affiliation")
          .upsert({
            id: affUuid,
            user_id: userId,
            name: `${faculty} ${major}`.trim() || "全学共通",
            level: 1,
          }, { onConflict: "id" });
      }
    } catch (e) {
      console.warn("Notice: affiliation ensure:", e);
    }
  }

  return affUuid;
}

/**
 * 現在のユーザーの affiliation_id を取得します。
 */
export async function getCurrentAffiliationId(expectedOwner?: string): Promise<string | null> {
  const userId = await getCurrentUserId();
  assertExpectedOwner(userId, expectedOwner);
  if (typeof window !== "undefined") {
    const cachedId = localStorage.getItem("haskapp_affiliation_id");
    if (cachedId && isUuid(cachedId)) {
      return cachedId;
    }
  }

  const faculty = (typeof window !== "undefined" && localStorage.getItem("haskapp_faculty_name")) || "工学部";
  const major = (typeof window !== "undefined" && localStorage.getItem("haskapp_major_name")) || "情報エレクトロニクス学科 情報理工学コース";
  return await getOrCreateAffiliation(faculty, major, userId ?? undefined);
}

export interface SupabaseTemplateLecture {
  id: string;
  template_id: string;
  creator_id: string;
  lecture_name: string;
  group_id: string;
  affiliation_id: string;
  classroom?: string | null;
  details?: string | null;
  grading_criteria?: string | null;
  report_rate?: number | null;
  exam_rate?: number | null;
  mini_exam_rate?: number | null;
  lecture_count?: number | null;
  attendance_count_needed?: number | null;
  slots: { day_of_the_week: JavaScriptDayOfWeek; period: number; term: string }[];
  syllabus_id?: string;
  instructor: string;
  credits?: string;
  gpa?: string;
  aRate?: string;
  passRate?: string;
  discipline?: string;
  historicalInstructor?: string;
  historicalEnrollment?: string;
  gradeDistribution?: number[];
  rate: number;
}

export type TemplateLectureSuggestion = {
  classroom?: string;
  lecture_details?: string;
  grading_criteria?: string;
  grading_attendance_required?: number;
  grading_attendance_total?: number;
  grading_report?: number;
  grading_test?: number;
  grading_quiz?: number;
};

/**
 * 現在の講義に対応する共有テンプレートから、未入力項目の候補を取得します。
 */
export async function fetchTemplateLectureSuggestion(
  groupId: string | undefined,
  expectedOwner?: string
): Promise<TemplateLectureSuggestion | null> {
  if (typeof window === "undefined" || !groupId || !getSupabaseStatus()) return null;

  const userId = await getCurrentUserId();
  assertExpectedOwner(userId, expectedOwner);
  const affiliationId = await getCurrentAffiliationId(userId ?? undefined);
  if (!affiliationId) return null;

  const { data, error } = await supabase
    .from("user_lecture_data_template")
    .select("classroom, details, grading_criteria, lecture_count, attendance_count_needed, report_rate, exam_rate, mini_exam_rate")
    .eq("group_id", groupId)
    .eq("affiliation_id", affiliationId)
    .limit(50);

  if (error || !data || data.length === 0) return null;

  const suggestion: TemplateLectureSuggestion = {};
  const firstText = (key: "classroom" | "details" | "grading_criteria") =>
    data.find((template) => typeof template[key] === "string" && template[key].trim())?.[key]?.trim();
  const firstNumber = (key: "lecture_count" | "attendance_count_needed" | "report_rate" | "exam_rate" | "mini_exam_rate") =>
    data.find((template) => typeof template[key] === "number" && template[key] !== null)?.[key];

  const classroom = firstText("classroom");
  const lectureDetails = firstText("details");
  const gradingCriteria = firstText("grading_criteria");
  const attendanceRequired = firstNumber("attendance_count_needed");
  const attendanceTotal = firstNumber("lecture_count");
  const reportRate = firstNumber("report_rate");
  const examRate = firstNumber("exam_rate");
  const miniExamRate = firstNumber("mini_exam_rate");

  if (classroom) suggestion.classroom = classroom;
  if (lectureDetails) suggestion.lecture_details = lectureDetails;
  if (gradingCriteria) suggestion.grading_criteria = gradingCriteria;
  if (attendanceRequired !== undefined) suggestion.grading_attendance_required = attendanceRequired;
  if (attendanceTotal !== undefined) suggestion.grading_attendance_total = attendanceTotal;
  if (reportRate !== undefined) suggestion.grading_report = reportRate;
  if (examRate !== undefined) suggestion.grading_test = examRate;
  if (miniExamRate !== undefined) suggestion.grading_quiz = miniExamRate;

  return Object.keys(suggestion).length > 0 ? suggestion : null;
}

function getPeriodFromTime(startTime?: string | null): number {
  if (!startTime) return 1;
  const time = startTime.slice(0, 5);
  if (time <= "09:30") return 1;
  if (time <= "11:30") return 2;
  if (time <= "14:00") return 3;
  if (time <= "15:45") return 4;
  if (time <= "17:30") return 5;
  return 6;
}

/**
 * 選択された学部・学科に対応する user_lecture_data_template および関連データを取得します。
 */
export async function fetchTemplatesForDepartment(
  department: string,
  major: string,
  expectedOwner?: string
): Promise<{
  hasData: boolean;
  departmentMajorId: string | null;
  affiliationId: string | null;
  templates: SupabaseTemplateLecture[];
}> {
  if (typeof window === "undefined") {
    return { hasData: false, departmentMajorId: null, affiliationId: null, templates: [] };
  }

  const userId = await getCurrentUserId();
  assertExpectedOwner(userId, expectedOwner);
  try {
    // 1. affiliation_id (確定UUID: 例 "00000001-0001-0003-0000-000000000000") の取得
    const affiliationId = await getOrCreateAffiliation(department, major, userId ?? undefined);

    // 2. department_and_major から一致するレコードを検索
    let deptMajorId: string | null = null;
    try {
      const { data: deptMajor } = await supabase
        .from("department_and_major")
        .select("id")
        .eq("department", department)
        .eq("major", major)
        .limit(1)
        .maybeSingle();
      deptMajorId = deptMajor?.id || null;
    } catch (e) {
      console.warn("department_and_major search notice:", e);
    }

    // 3. user_lecture_data_template からデータ一覧を取得
    let query = supabase
      .from("user_lecture_data_template")
      .select(`
        id,
        user_id,
        group_id,
        affiliation_id,
        classroom,
        details,
        grading_criteria,
        report_rate,
        exam_rate,
        mini_exam_rate,
        lecture_count,
        attendance_count_needed,
        groups (
          id,
          name
        )
      `)
      .limit(50);

    if (affiliationId) {
      query = query.eq("affiliation_id", affiliationId);
    }
    query = query.neq("group_id", "00000000-0000-0000-0000-000000000000");

    const { data: templatesData, error: tErr } = await query;

    if (tErr) {
      console.error("Error fetching user_lecture_data_template:", tErr);
      return { hasData: false, departmentMajorId: deptMajorId, affiliationId, templates: [] };
    }

    if (!templatesData || templatesData.length === 0) {
      return { hasData: false, departmentMajorId: deptMajorId, affiliationId, templates: [] };
    }

    // 4. user_lecture_data_template_rate からテンプレート提供者ごとのレートを取得
    const ratesByCreator = new Map<string, number>();
    try {
      const { data: ratesData } = await supabase
        .from("user_lecture_data_template_rate")
        .select("creator_id, rate");

      if (ratesData && ratesData.length > 0) {
        ratesData.forEach((r) => {
          if (r.creator_id) {
            ratesByCreator.set(r.creator_id, (ratesByCreator.get(r.creator_id) || 0) + (r.rate || 0));
          }
        });
      }
    } catch (e) {
      console.warn("user_lecture_data_template_rate read notice:", e);
    }

    // 5. 関連する group_id 群から public_lecture_data, schedules を一括取得
    const groupIds = Array.from(new Set(templatesData.map((t) => t.group_id).filter((gid) => !!gid && gid !== "00000000-0000-0000-0000-000000000000")));
    const publicLecturesMap: Record<string, PublicLectureData> = {};
    const schedulesMap: Record<string, Schedule[]> = {};

    if (groupIds.length > 0) {
      const [pubRes, schedRes] = await Promise.all([
        supabase.from("public_lecture_data").select("*").in("group_id", groupIds),
        // ダッシュボードと同じく、授業グループに紐づく予定をすべて取得する。
        // テンプレート提供者だけに絞ると、同じ授業の追加時限を取りこぼすことがある。
        supabase.from("schedules").select("*").in("group_id", groupIds),
      ]);

      if (pubRes.data) {
        pubRes.data.forEach((p) => {
          publicLecturesMap[p.group_id] = p as PublicLectureData;
        });
      }
      if (schedRes.data) {
        schedRes.data.forEach((s) => {
          if (s.day_of_week === null || s.day_of_week === undefined || !s.start_time) return;
          const key = s.group_id;
          if (!schedulesMap[key]) schedulesMap[key] = [];
          schedulesMap[key].push(s as Schedule);
        });
      }
    }

    // 6. 成績分布 (grade_distributions) の取得
    const subjectNames = Array.from(
      new Set(
        templatesData.map((t) => {
          const pub = publicLecturesMap[t.group_id];
          const groupName = getGroupName(t.groups);
          const rawName = pub?.name || groupName || "";
          let cleaned = rawName.replace(/^\d{5,6}\s+/, "");
          const asciiMatch = cleaned.match(/^(.*?)\s+[a-zA-Z]/);
          if (asciiMatch) cleaned = asciiMatch[1];
          return cleaned.trim().split(/[\s　]+/)[0];
        }).filter(Boolean)
      )
    );

    const gradeDistsMap: Record<string, GradeDistribution> = {};
    if (subjectNames.length > 0) {
      const { data: gradeDists } = await supabase
        .from("grade_distributions")
        .select("*")
        .in("subject_name", subjectNames);

      if (gradeDists) {
        gradeDists.forEach((g) => {
          if (!gradeDistsMap[g.subject_name]) {
            gradeDistsMap[g.subject_name] = g as GradeDistribution;
          }
        });
      }
    }

    // 7. 完全なテンプレート講義オブジェクトを生成
    const templates: SupabaseTemplateLecture[] = templatesData.map((t) => {
      const pub = publicLecturesMap[t.group_id];
      const schedList = schedulesMap[t.group_id] || [];
      const groupName = getGroupName(t.groups);
      const rawLectureName = pub?.name || groupName || "講義";

      let cleanName = rawLectureName.replace(/^\d{5,6}\s+/, "");
      const asciiMatch = cleanName.match(/^(.*?)\s+[a-zA-Z]/);
      if (asciiMatch) cleanName = asciiMatch[1];
      cleanName = cleanName.trim().split(/[\s　]+/)[0];

      const gradeDist = gradeDistsMap[cleanName];
      const percent = (value: unknown): number | undefined =>
        typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
      const distribution = gradeDist ? [gradeDist.aplus_percent, gradeDist.a_percent, gradeDist.aminus_percent,
        gradeDist.bplus_percent, gradeDist.b_percent, gradeDist.bminus_percent, gradeDist.cplus_percent,
        gradeDist.c_percent, gradeDist.d_percent, gradeDist.dminus_percent, gradeDist.f_percent].map(percent) : [];
      const aBuckets = distribution.slice(0, 3);
      const aRate = aBuckets.length === 3 && aBuckets.every(value => value !== undefined)
        ? `${aBuckets.reduce((sum, value) => sum + value, 0).toFixed(1)} %` : undefined;
      const fPercent = percent(gradeDist?.f_percent);

      // スロット情報 (曜日・時限) の算出
      const slots: { day_of_the_week: JavaScriptDayOfWeek; period: number; term: string }[] = [];
      if (schedList.length > 0) {
        schedList.forEach((s) => {
          const day = s.day_of_week as JavaScriptDayOfWeek;
          const period = getPeriodFromTime(s.start_time);
          slots.push({ day_of_the_week: day, period, term: getTermFromSchedule(s) ?? LEGACY_DEFAULT_TERM });
        });
      }
      // No invented fallback slots: registration requires an existing canonical schedule.

      const teacher = pub?.teacher || "担当教員";
      const truncatedTeacher = teacher.length >= 90 ? teacher.slice(0, 90) + "..." : teacher;

      return {
        id: t.id,
        template_id: t.id,
        creator_id: t.user_id,
        lecture_name: rawLectureName,
        group_id: t.group_id,
        affiliation_id: t.affiliation_id,
        classroom: t.classroom,
        details: t.details,
        grading_criteria: t.grading_criteria,
        report_rate: t.report_rate,
        exam_rate: t.exam_rate,
        mini_exam_rate: t.mini_exam_rate,
        lecture_count: t.lecture_count,
        attendance_count_needed: t.attendance_count_needed,
        slots,
        syllabus_id: pub?.syllabus_id || undefined,
        instructor: truncatedTeacher,
        credits: undefined, // No credit-count column exists in public_lecture_data.
        // Missing historical data must stay missing, including when cached by setup.
        gpa: typeof gradeDist?.gpa === "number" && Number.isFinite(gradeDist.gpa) && gradeDist.gpa >= 0 ? gradeDist.gpa.toFixed(2) : undefined,
        aRate,
        passRate: fPercent !== undefined ? `${(100 - fPercent).toFixed(1)} %` : undefined,
        discipline: gradeDist?.faculty || department,
        historicalInstructor: gradeDist?.instructor_name || undefined,
        historicalEnrollment: gradeDist?.student_count != null ? `${gradeDist.student_count} 人` : undefined,
        // The legacy number[] cannot represent unknown buckets. Detailed history keeps nulls.
        gradeDistribution: distribution.length === 11 && distribution.every(value => value !== undefined) ? distribution : undefined,
        rate: ratesByCreator.get(t.user_id) || 0,
      };
    });

    return {
      hasData: templates.length > 0,
      departmentMajorId: deptMajorId,
      affiliationId,
      templates,
    };
  } catch (err) {
    if (err instanceof AccountOwnerChangedError) throw err;
    console.error("Exception in fetchTemplatesForDepartment:", err);
    return { hasData: false, departmentMajorId: null, affiliationId: null, templates: [] };
  }
}

/**
 * 選択されたテンプレート提供者の rate を +1 更新します。
 */
export async function updateTemplateRates(
  department: string,
  major: string,
  creatorId: string,
  expectedOwner?: string
): Promise<void> {
  const userId = await getCurrentUserId();
  assertExpectedOwner(userId, expectedOwner);
  if (typeof window === "undefined" || !getSupabaseStatus()) return;
  if (!userId) return;
  try {

    // affiliation の確保
    await getOrCreateAffiliation(department, major, userId);
    // department_and_major の確保
    await saveDepartmentAndMajorToSupabase(department, major, userId);

    // user_lecture_data_template_rate テーブルの更新 (ユーザーごとのレート管理)
    const { data: existingRate } = await supabase
      .from("user_lecture_data_template_rate")
      .select("id, rate")
      .eq("user_id", userId)
      .eq("creator_id", creatorId)
      .limit(1)
      .maybeSingle();

    if (existingRate) {
      const currentRate = existingRate.rate || 0;
      await supabase
        .from("user_lecture_data_template_rate")
        .update({ rate: currentRate + 1 })
        .eq("id", existingRate.id)
        .eq("user_id", userId);
    } else {
      await supabase
        .from("user_lecture_data_template_rate")
        .insert({
          user_id: userId,
          creator_id: creatorId,
          rate: 1,
        });
    }
  } catch (err) {
    if (err instanceof AccountOwnerChangedError) throw err;
    console.error("Exception in updateTemplateRates:", err);
  }
}

import { equivalentIntervals } from "@/lib/interval";
import { assertExpectedOwner } from "./owner-guard";
import { createLocalId } from "@/lib/local-id";
import type { Task, TaskWithUI, TaskStatus, LectureWithDetails } from "@/lib/dashboard";
import { toError } from "@/lib/error-utils";
import { supabase, getCurrentUserId } from "@/lib/supabase";
import { fetchWithFallback, getLocal, setLocal, writeWithFallback, mutateWithFallback } from "./offline-sync";

export async function getTasksStorageKey(): Promise<string> {
  const userId = await getCurrentUserId();
  return `haskapp_tasks_${userId}`;
}

function statusToProgress(status: TaskStatus): number {
  return status === "done" ? 100 : status === "inProgress" ? 50 : 0;
}

// The form and all-day calendar use date-only values, while Postgres returns timestamps.
// Keep the stored calendar date rather than shifting it through the browser's timezone.
function toTaskDate(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

type TaskInput = Pick<TaskWithUI, "task_name" | "deadline" | "status" | "colorTheme"> &
  Partial<Pick<TaskWithUI, "id" | "task_details" | "estimated_duration" | "assigned_date" | "scheduled_date" |
    "lecture_id" | "scheduled_start_at" | "scheduled_end_at" | "start_at" | "end_at" | "progress_percent">> & {
    mobile_insert_id?: string;
  };

function timestampForDate(date: string | null | undefined, raw: string | null | undefined): string | null {
  return date && toTaskDate(raw) === date ? raw! : date || null;
}

function taskFields(task: TaskInput, existing?: TaskWithUI) {
  const original = { ...existing, ...task };
  const recordedProgress = original.progress_percent;
  const progress = recordedProgress != null && Number.isFinite(recordedProgress) &&
    (task.status === "done" && recordedProgress === 100 || task.status === "todo" && recordedProgress === 0 ||
      task.status === "inProgress" && recordedProgress > 0 && recordedProgress < 100)
    ? recordedProgress : statusToProgress(task.status);
  return {
    work_start_daytime: timestampForDate(task.scheduled_date, original.scheduled_start_at),
    // The planned work end is independent of the task deadline.
    work_end_daytime: original.scheduled_end_at || null,
    period_start_daytime: timestampForDate(task.assigned_date, original.start_at),
    period_end_daytime: timestampForDate(task.deadline, original.end_at),
    progress_percent: progress,
  };
}

function normalizedTask(task: TaskInput, existing?: TaskWithUI): TaskInput & { progress_percent: number } {
  const original = { ...existing, ...task };
  const fields = taskFields(task, existing);
  return {
    ...task,
    ...(original.start_at !== undefined ? { start_at: fields.period_start_daytime } : {}),
    ...(original.end_at !== undefined ? { end_at: fields.period_end_daytime } : {}),
    ...(original.scheduled_start_at !== undefined ? { scheduled_start_at: fields.work_start_daytime } : {}),
    ...(original.scheduled_end_at !== undefined ? { scheduled_end_at: fields.work_end_daytime } : {}),
    progress_percent: fields.progress_percent,
  };
}

function buildOfflineTask(taskData: TaskInput, userId: string, existing?: TaskWithUI): TaskWithUI {
  return {
    ...normalizedTask(taskData, existing),
    id: taskData.id || createLocalId("task"),
    created_at: existing?.created_at ?? new Date().toISOString(),
    user_id: userId,
  };
}

function isUuid(id: string | null): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

const taskTimestampColumns = new Set([
  "work_start_daytime", "work_end_daytime", "period_start_daytime", "period_end_daytime",
]);

function timestampMicroseconds(value: string): bigint | null {
  // Preserve PostgreSQL's six fractional digits; Date.parse alone truncates them.
  // Only compare unambiguous timezone-bearing timestamps or date-only values.
  const match = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}(?::?\d{2})?))?$/i.exec(value);
  if (!match) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const remainder = (match[1] ?? "").padEnd(6, "0").slice(3);
  return BigInt(milliseconds) * 1000n + BigInt(remainder);
}

function matchesInsertedTask(row: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  return Object.entries(payload).every(([column, attempted]) => {
    const stored = row[column];
    if (stored === attempted) return true;
    if (column === "work_interval_estimated" && typeof stored === "string" && typeof attempted === "string") {
      return equivalentIntervals(stored, attempted);
    }
    if (taskTimestampColumns.has(column) && typeof stored === "string" && typeof attempted === "string") {
      const storedTime = timestampMicroseconds(stored);
      const attemptedTime = timestampMicroseconds(attempted);
      return storedTime !== null && attemptedTime !== null && storedTime === attemptedTime;
    }
    return false;
  });
}

export const tasksApi = {
  async fetchTasks(): Promise<TaskWithUI[]> {
    const userId = await getCurrentUserId();
    const tasksKey = `haskapp_tasks_${userId}`;
    const classesKey = `haskapp_classes_${userId}`;

    if (!isUuid(userId)) {
      if (typeof window !== "undefined") {
        const saved = localStorage.getItem(tasksKey);
        if (saved) {
          try {
            return JSON.parse(saved);
          } catch {
            return [];
          }
        }
      }
      return [];
    }

    return fetchWithFallback<TaskWithUI[]>(
      tasksKey,
      async () => {
        const { data: tasks, error } = await supabase
          .from("tasks")
          .select("*")
          .eq("user_id", userId);

        if (error) {
          console.warn("Notice: fetchTasks from Supabase fallback:", error.message || error);
          throw error; // fetchWithFallback がフォールバックを処理
        }

        // クラスキャッシュからカラーテーマを引く
        const lectures = getLocal<LectureWithDetails[]>(classesKey) ?? [];

        return ((tasks || []) as Task[]).map((item) => {
          let status: TaskStatus = "todo";
          if (item.progress_percent === 100) {
            status = "done";
          } else if (item.progress_percent > 0) {
            status = "inProgress";
          }

          const linkedLecture = lectures.find(l => l.lecture_list_id === item.group_id);
          const colorTheme = linkedLecture?.colorTheme || "violet";

          return {
            id: item.id,
            created_at: item.created_at,
            user_id: item.user_id,
            task_name: item.name,
            deadline: toTaskDate(item.period_end_daytime) || "",
            task_details: item.details || "",
            assigned_date: toTaskDate(item.period_start_daytime),
            scheduled_date: toTaskDate(item.work_start_daytime),
            scheduled_start_at: item.work_start_daytime || null,
            scheduled_end_at: item.work_end_daytime || null,
            start_at: item.period_start_daytime || null,
            end_at: item.period_end_daytime || null,
            estimated_duration: item.work_interval_estimated || null,
            progress_percent: item.progress_percent,
            status,
            colorTheme,
            lecture_id: item.group_id || null,
          } as TaskWithUI;
        });
      },
      [],
    );
  },

  async saveTask(taskData: TaskInput, currentTasks: TaskWithUI[], expectedOwner?: string): Promise<TaskWithUI> {
    const userId = await getCurrentUserId();
    assertExpectedOwner(userId, expectedOwner);
    const tasksKey = `haskapp_tasks_${userId}`;
    const existingTask = currentTasks.find((task) => task.id === taskData.id);
    const offlineFallback = () => buildOfflineTask(taskData, userId, existingTask);

    const buildUpdatedList = (savedTask: TaskWithUI) => {
      return existingTask
        ? currentTasks.map((t) => (t.id === taskData.id ? savedTask : t))
        : [...currentTasks, savedTask];
    };

    if (!isUuid(userId)) {
      const saved = offlineFallback();
      setLocal(tasksKey, buildUpdatedList(saved));
      return saved;
    }

    return writeWithFallback<TaskWithUI, TaskWithUI[]>(
      tasksKey,
      async () => {
        const fields = taskFields(taskData, existingTask);

        const taskPayload = {
          user_id: userId,
          group_id: taskData.lecture_id && isUuid(taskData.lecture_id) ? taskData.lecture_id.toLowerCase() : taskData.lecture_id || null,
          name: taskData.task_name,
          details: taskData.task_details || null,
          ...fields,
          work_interval_estimated: taskData.estimated_duration || null,
        };

        let persistedTask: { id: string; created_at: string };
        if (taskData.id) {
          const { data, error } = await supabase
            .from("tasks")
            .update(taskPayload)
            .eq("id", taskData.id)
            .eq("user_id", userId)
            .select("id, created_at")
            .single();
          if (error) throw toError(error, "課題の更新に失敗しました");
          persistedTask = data;
        } else {
          // A stable UUID makes a native retry safe even when the server committed
          // an insert but the response was lost. Existing rows remain owner-scoped.
          const candidate = taskData.mobile_insert_id;
          const insertId = candidate && isUuid(candidate) ? candidate.toLowerCase() : undefined;
          const insertPayload: typeof taskPayload & { id?: string } = { ...taskPayload };
          if (insertId) insertPayload.id = insertId;
          const { data: newRec, error } = await supabase
            .from("tasks")
            .insert(insertPayload)
            .select("id, created_at")
            .single();
          if (error?.code === "23505" && insertId) {
            const { data: existing, error: lookupError } = await supabase.from("tasks")
              .select("*").eq("id", insertId).eq("user_id", userId).single();
            if (lookupError || !existing) throw toError(lookupError ?? error, "課題の追加結果を確認できませんでした");
            if (typeof existing.id !== "string" || existing.id.toLowerCase() !== insertId || !matchesInsertedTask(existing, taskPayload)) {
              throw new Error("同じ課題IDの内容がクラウドで異なります。変更内容を保存待ちに残し、課題を読み直してください。");
            }
            persistedTask = existing;
          } else {
            if (error) throw toError(error, "課題の追加に失敗しました");
            persistedTask = newRec;
          }
        }

        const savedTask: TaskWithUI = {
          ...normalizedTask(taskData, existingTask),
          id: persistedTask.id,
          created_at: persistedTask.created_at,
          user_id: userId,
          status: taskData.status,
        } as TaskWithUI;

        return savedTask;
      },
      offlineFallback,
      buildUpdatedList,
    );
  },

  async deleteTask(id: string, currentTasks: TaskWithUI[], expectedOwner?: string): Promise<void> {
    const buildUpdated = () => currentTasks.filter((t) => t.id !== id);
    const userId = await getCurrentUserId();
    assertExpectedOwner(userId, expectedOwner);
    const tasksKey = `haskapp_tasks_${userId}`;

    if (!isUuid(userId)) {
      setLocal(tasksKey, buildUpdated());
      return;
    }

    await mutateWithFallback<TaskWithUI[]>(
      tasksKey,
      async () => {
        const { error } = await supabase
          .from("tasks")
          .delete()
          .eq("id", id)
          .eq("user_id", userId);
        if (error) throw toError(error, "課題の削除に失敗しました");
        return buildUpdated();
      },
      buildUpdated,
    );
  },

  async updateTaskStatus(id: string, nextStatus: TaskStatus, currentTasks: TaskWithUI[], expectedOwner?: string): Promise<void> {
    const progress = statusToProgress(nextStatus);
    const buildUpdated = () =>
      currentTasks.map((t) =>
        t.id === id ? { ...t, status: nextStatus, progress_percent: progress } : t,
      );
    const userId = await getCurrentUserId();
    assertExpectedOwner(userId, expectedOwner);
    const tasksKey = `haskapp_tasks_${userId}`;

    if (!isUuid(userId)) {
      setLocal(tasksKey, buildUpdated());
      return;
    }

    await mutateWithFallback<TaskWithUI[]>(
      tasksKey,
      async () => {
        const { error } = await supabase
          .from("tasks")
          .update({ progress_percent: progress })
          .eq("id", id)
          .eq("user_id", userId)
          .select("id")
          .single();
        if (error) throw toError(error, "課題の進捗更新に失敗しました");
        return buildUpdated();
      },
      buildUpdated,
    );
  },

  async saveAllTasks(newTasks: TaskWithUI[], expectedOwner?: string): Promise<void> {
    if (typeof window === "undefined") return;

    const owner = await getCurrentUserId();
    assertExpectedOwner(owner, expectedOwner);
    const tasksKey = `haskapp_tasks_${owner}`;
    if (newTasks.length === 0) {
      setLocal(tasksKey, []);
      return;
    }

    const taskIds = new Set(newTasks.map((task) => task.id));
    let currentTasks = (getLocal<TaskWithUI[]>(tasksKey) ?? []).filter((task) => taskIds.has(task.id));

    for (const task of newTasks) {
      const saved = await this.saveTask(task, currentTasks, owner);
      currentTasks = currentTasks.some((existing) => existing.id === task.id)
        ? currentTasks.map((existing) => existing.id === task.id ? saved : existing)
        : [...currentTasks, saved];
    }

    // Each successful save caches the accumulated list. Let validation/permission
    // errors reach the caller rather than caching the unpersisted remainder.
  }
};

import type { CalendarEvent, ColorTheme, TaskWithUI } from "@/lib/dashboard";

export type CalendarItemKind = "event" | "task";

export type CalendarItemProps = {
  kind: CalendarItemKind;
  item: CalendarEvent | TaskWithUI;
};

/** Structural subset produced by this adapter; native clients need no Web UI package. */
export type CalendarEventInput = {
  id: string;
  title: string;
  start: string;
  allDay: boolean;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  classNames?: string[];
  extendedProps: CalendarItemProps;
};

/** FullCalendar event colors — synced with --*-accent-border in globals.css */
export const calendarThemeStyles: Record<
  ColorTheme | "violet",
  { backgroundColor: string; borderColor: string; textColor: string }
> = {
  red: {
    backgroundColor: "rgba(254, 242, 242, 0.85)",
    borderColor: "rgba(239, 68, 68, 0.28)",
    textColor: "#7f1d1d",
  },
  teal: {
    backgroundColor: "rgba(240, 253, 250, 0.85)",
    borderColor: "rgba(13, 148, 136, 0.28)",
    textColor: "#115e59",
  },
  grey: {
    backgroundColor: "rgba(248, 250, 252, 0.85)",
    borderColor: "rgba(148, 163, 184, 0.35)",
    textColor: "#0f172a",
  },
  orange: {
    backgroundColor: "rgba(255, 247, 237, 0.85)",
    borderColor: "rgba(249, 115, 22, 0.28)",
    textColor: "#7c2d12",
  },
  yellow: {
    backgroundColor: "rgba(254, 252, 232, 0.85)",
    borderColor: "rgba(234, 179, 8, 0.32)",
    textColor: "#713f12",
  },
  violet: {
    backgroundColor: "rgba(245, 243, 255, 0.85)",
    borderColor: "rgba(139, 92, 246, 0.28)",
    textColor: "#4c1d95",
  },
  blue: {
    backgroundColor: "rgba(239, 246, 255, 0.85)",
    borderColor: "rgba(59, 130, 246, 0.28)",
    textColor: "#1e3a8a",
  },
  green: {
    backgroundColor: "rgba(240, 253, 244, 0.85)",
    borderColor: "rgba(34, 197, 94, 0.28)",
    textColor: "#14532d",
  },
  pink: {
    backgroundColor: "rgba(253, 242, 248, 0.85)",
    borderColor: "rgba(236, 72, 153, 0.28)",
    textColor: "#831843",
  },
  indigo: {
    backgroundColor: "rgba(238, 242, 255, 0.85)",
    borderColor: "rgba(99, 102, 241, 0.28)",
    textColor: "#312e81",
  },
  rose: {
    backgroundColor: "rgba(255, 241, 242, 0.85)",
    borderColor: "rgba(244, 63, 94, 0.28)",
    textColor: "#881337",
  },
};

const doneTaskStyle = {
  backgroundColor: "rgba(241, 245, 249, 0.55)",
  borderColor: "rgba(148, 163, 184, 0.35)",
  textColor: "#94a3b8",
};

function toFcEvent(
  id: string,
  title: string,
  start: string,
  theme: { backgroundColor: string; borderColor: string; textColor: string },
  extendedProps: CalendarItemProps,
  extraClassNames?: string[]
): CalendarEventInput {
  return {
    id,
    title,
    start,
    allDay: true,
    backgroundColor: theme.backgroundColor,
    borderColor: theme.borderColor,
    textColor: theme.textColor,
    classNames: extraClassNames,
    extendedProps,
  };
}

export function buildFullCalendarEvents(
  events: CalendarEvent[],
  tasks: TaskWithUI[]
): CalendarEventInput[] {
  const calendarEvents: CalendarEventInput[] = events.map((ev) =>
    toFcEvent(
      `event-${ev.id}`,
      ev.title,
      ev.date,
      calendarThemeStyles[ev.colorTheme],
      { kind: "event", item: ev },
      [`fc-event-theme-${ev.colorTheme}`]
    )
  );

  const taskEvents: CalendarEventInput[] = [];
  tasks.forEach((task) => {
    const isDone = task.status === "done";
    const theme = isDone
      ? doneTaskStyle
      : calendarThemeStyles[task.colorTheme || "violet"];

    // 1. 締切日に表示
    if (task.deadline) {
      taskEvents.push(
        toFcEvent(
          `task-deadline-${task.id}`,
          `${isDone ? "✓ " : ""}[締切] ${task.task_name}`,
          task.deadline,
          theme,
          { kind: "task", item: task },
          isDone ? ["fc-event-task-done"] : [`fc-event-theme-${task.colorTheme || "violet"}`]
        )
      );
    }

    // 2. 課題予定日に表示
    if (task.scheduled_date) {
      taskEvents.push(
        toFcEvent(
          `task-scheduled-${task.id}`,
          `${isDone ? "✓ " : ""}[予定] ${task.task_name}`,
          task.scheduled_date,
          theme,
          { kind: "task", item: task },
          isDone ? ["fc-event-task-done"] : [`fc-event-theme-${task.colorTheme || "violet"}`]
        )
      );
    }
  });

  return [...calendarEvents, ...taskEvents];
}

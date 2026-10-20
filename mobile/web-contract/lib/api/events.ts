import { assertExpectedOwner } from "./owner-guard";
import { createLocalId } from "@/lib/local-id";
import type { CalendarEvent, ColorTheme } from "@/lib/dashboard";
import { getSeedCalendarEvents } from "@/lib/dashboard";
import { getCurrentUserId } from "@/lib/supabase";
import { getLocal, setLocal } from "./offline-sync";

async function getEventsStorageKey(expectedOwner?: string): Promise<string> {
  const userId = await getCurrentUserId();
  assertExpectedOwner(userId, expectedOwner);
  return `haskapp_calendar_events_${userId}`;
}

export const eventsApi = {
  async fetchEvents(expectedOwner?: string): Promise<CalendarEvent[]> {
    if (typeof window === "undefined") return [];
    const key = await getEventsStorageKey(expectedOwner);
    const saved = getLocal<CalendarEvent[]>(key);
    if (saved) {
      return saved;
    } else {
      const seed = getSeedCalendarEvents();
      setLocal(key, seed);
      return seed;
    }
  },

  async saveEvent(eventData: {
    id?: string;
    relatedLectureID?: string;
    title: string;
    date: string;
    colorTheme: ColorTheme | "violet";
  }, currentEvents: CalendarEvent[], expectedOwner?: string): Promise<CalendarEvent> {
    const key = await getEventsStorageKey(expectedOwner);
    let saved: CalendarEvent;

    if (eventData.id) {
      saved = { ...eventData } as CalendarEvent;
    } else {
      saved = {
        id: createLocalId("ev"),
        ...(eventData.relatedLectureID ? { relatedLectureID: eventData.relatedLectureID } : {}),
        title: eventData.title,
        date: eventData.date,
        colorTheme: eventData.colorTheme,
      };
    }

    const updated = eventData.id && currentEvents.some((event) => event.id === eventData.id)
      ? currentEvents.map((ev) => (ev.id === eventData.id ? saved : ev))
      : [...currentEvents, saved];

    if (typeof window !== "undefined") setLocal(key, updated);
    return saved;
  },

  async deleteEvent(id: string, currentEvents: CalendarEvent[], expectedOwner?: string): Promise<void> {
    const updated = currentEvents.filter((ev) => ev.id !== id);
    if (typeof window !== "undefined") {
      const key = await getEventsStorageKey(expectedOwner);
      setLocal(key, updated);
    }
  },

  async saveAllEvents(newEvents: CalendarEvent[], expectedOwner?: string): Promise<void> {
    if (typeof window !== "undefined") {
      const key = await getEventsStorageKey(expectedOwner);
      setLocal(key, newEvents);
    }
  }
};

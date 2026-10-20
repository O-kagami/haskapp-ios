import ICAL from "ical.js";

type IcalDate = {
  year: number;
  month: number;
  day: number;
};

export type ParsedIcalEntry = {
  summary: string;
  date: string;
  uid: string | null;
  categories: string[];
};

function isIcalDate(value: unknown): value is IcalDate {
  if (typeof value !== "object" || value === null) return false;
  return ["year", "month", "day"].every(
    (key) => key in value && typeof (value as Record<string, unknown>)[key] === "number",
  );
}

function getStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

export function parseIcalEntries(icsText: string): ParsedIcalEntry[] {
  const calendar = new ICAL.Component(ICAL.parse(icsText));

  return calendar.getAllSubcomponents("vevent").flatMap((eventComponent) => {
    const dateValue = eventComponent.getFirstPropertyValue("dtstart");
    if (!isIcalDate(dateValue)) return [];

    const summaryValue = eventComponent.getFirstPropertyValue("summary");
    const uidValue = eventComponent.getFirstPropertyValue("uid");
    const categoriesValue = eventComponent.getFirstPropertyValue("categories");

    return [{
      summary: typeof summaryValue === "string" && summaryValue ? summaryValue : "無題",
      date: [
        String(dateValue.year).padStart(4, "0"),
        String(dateValue.month).padStart(2, "0"),
        String(dateValue.day).padStart(2, "0"),
      ].join("-"),
      uid: typeof uidValue === "string" && uidValue ? uidValue : null,
      categories: getStrings(categoriesValue),
    }];
  });
}

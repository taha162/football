import { describe, expect, it } from "vitest";
import { buildIcs, calendarDate, escapeText, foldLine, googleCalendarUrl } from "@/lib/calendar";

const event = {
  uid: "booking-1@al-malab",
  title: "حجز ملعب: ملعب الزهور",
  startsAt: "2026-11-03T17:00:00.000Z",
  endsAt: "2026-11-03T18:30:00.000Z",
  location: "ملعب الزهور، شارع الجامعة، الزهور، الموصل",
  description: "الملعب: الملعب 1\nالحجز بانتظار تثبيت الملعب.",
  url: "https://al-malab.vercel.app/ar/my/bookings",
  alarmMinutes: 120,
};

/** Undoes folding, as calendar apps do. */
const unfold = (ics: string) => ics.replace(/\r\n /g, "");

describe("booking in a calendar", () => {
  it("writes times in UTC, as calendars expect", () => {
    expect(calendarDate("2026-11-03T20:00:00+03:00")).toBe("20261103T170000Z");
  });

  it("escapes commas, semicolons, backslashes and line breaks", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });

  it("folds long lines at 75 bytes without splitting an Arabic letter", () => {
    const line = `SUMMARY:${"ملعب ".repeat(30)}`;
    const folded = foldLine(line).split("\r\n");
    expect(folded.length).toBeGreaterThan(1);
    for (const part of folded) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    // Nothing is lost or broken: unfolding gives the line back.
    expect(folded.map((p, i) => (i === 0 ? p : p.slice(1))).join("")).toBe(line);
  });

  it("builds an event with the place, the details and a reminder two hours before", () => {
    const ics = buildIcs(event, new Date("2026-11-02T08:00:00Z"));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    const text = unfold(ics);
    expect(text).toContain("UID:booking-1@al-malab");
    expect(text).toContain("DTSTAMP:20261102T080000Z");
    expect(text).toContain("DTSTART:20261103T170000Z");
    expect(text).toContain("DTEND:20261103T183000Z");
    expect(text).toContain("SUMMARY:حجز ملعب: ملعب الزهور");
    expect(text).toContain("LOCATION:ملعب الزهور، شارع الجامعة، الزهور، الموصل");
    expect(text).toContain("DESCRIPTION:الملعب: الملعب 1\\nالحجز بانتظار تثبيت الملعب.");
    expect(text).toContain("BEGIN:VALARM\r\nACTION:DISPLAY");
    expect(text).toContain("TRIGGER:-PT120M");
  });

  it("opens Google Calendar with the event filled in", () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe(event.title);
    expect(url.searchParams.get("dates")).toBe("20261103T170000Z/20261103T183000Z");
    expect(url.searchParams.get("location")).toBe(event.location);
    expect(url.searchParams.get("details")).toContain(event.url);
  });
});

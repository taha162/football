import "server-only";
import { getTranslations } from "next-intl/server";
import { googleCalendarUrl, type CalendarEvent } from "@/lib/calendar";
import { publicEnv } from "@/lib/env";
import { mapsUrl } from "@/lib/geo";

/** What a booking's calendar event needs from its venue (for a bookings select). */
export const BOOKING_PLACE = "name, address, latitude, longitude, area:areas(name_ar), city:cities(name_ar, timezone)";

export interface BookingForCalendar {
  id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  field: { name: string } | null;
  venue: {
    name: string;
    address?: string | null;
    latitude?: number | string | null;
    longitude?: number | string | null;
    area?: { name_ar: string } | null;
    city?: { name_ar: string } | null;
  } | null;
}

/** Only a booking that still holds its time belongs in a calendar. */
export function calendarWorthy(b: { status: string; ends_at: string }): boolean {
  return (b.status === "requested" || b.status === "confirmed") && Date.parse(b.ends_at) > Date.now();
}

/** The booking as an event, in Arabic, with a reminder two hours before. */
export async function bookingEvent(b: BookingForCalendar): Promise<CalendarEvent> {
  const t = await getTranslations({ locale: "ar", namespace: "bookings.calendar" });
  const venue = b.venue?.name ?? "";
  const place = [b.venue?.address, b.venue?.area?.name_ar, b.venue?.city?.name_ar].filter(Boolean).join("، ");
  const hasPoint = b.venue?.latitude != null && b.venue?.longitude != null;
  const map = hasPoint ? mapsUrl(Number(b.venue!.latitude), Number(b.venue!.longitude)) : null;
  return {
    uid: `booking-${b.id}@al-malab`,
    title: t("title", { venue }),
    startsAt: b.starts_at,
    endsAt: b.ends_at,
    location: place ? `${venue}، ${place}` : venue,
    description: [b.field?.name ? t("field", { field: b.field.name }) : null, b.status === "requested" ? t("pending") : null, map ? t("map", { url: map }) : null]
      .filter(Boolean)
      .join("\n"),
    url: `${publicEnv.siteUrl}/ar/my/bookings`,
    alarmMinutes: 120,
  };
}

/** The phone's calendar (an .ics file this site serves) and Google Calendar. */
export async function calendarLinks(b: BookingForCalendar): Promise<{ ics: string; google: string }> {
  return { ics: `/api/calendar/booking/${b.id}`, google: googleCalendarUrl(await bookingEvent(b)) };
}

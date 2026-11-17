import { buildIcs } from "@/lib/calendar";
import { API_LIMITS, hit, limitAddress, tooManyRequests } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { BOOKING_PLACE, bookingEvent, calendarWorthy, type BookingForCalendar } from "@/server/venues/calendar";

export const dynamic = "force-dynamic";

/**
 * A booking as an iCalendar file, for the phone's calendar ("Add to
 * Calendar" on iPhone). Only the customer who booked and the venue's staff
 * can read the booking (RLS), and only while it still holds its time.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const limit = hit(API_LIMITS.calendar, limitAddress(request.headers));
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response(null, { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select(`id, status, starts_at, ends_at, field:venue_fields(name), venue:venues(${BOOKING_PLACE})`)
    .eq("id", id)
    .maybeSingle();
  const booking = data as unknown as BookingForCalendar | null;
  if (!booking || !calendarWorthy(booking)) return new Response(null, { status: 404 });
  return new Response(buildIcs(await bookingEvent(booking)), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="al-malab-booking.ics"',
      "Cache-Control": "private, no-store",
    },
  });
}

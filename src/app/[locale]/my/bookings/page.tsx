import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/auth";
import { getNow } from "@/lib/now";
import { createClient } from "@/lib/supabase/server";
import { BookingRow, type BookingRowData } from "@/components/venue/booking-row";
import { DepositCard } from "@/components/venue/deposit-card";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, Container, EmptyState, PageHeader, Section } from "@/components/ui/primitives";
import { AddToCalendar } from "@/components/venue/add-to-calendar";
import { calendarLinks, calendarWorthy, type BookingForCalendar } from "@/server/venues/calendar";
import { LinkButton } from "@/components/ui/link-button";

export default async function MyBookingsPage({ params, searchParams }: PageProps<"/[locale]/my/bookings">) {
  const { locale } = await params;
  const booked = (await searchParams).booked;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, "/my/bookings");
  const t = await getTranslations("bookings");
  const c = await getTranslations("bookings.calendar");
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select("*, field:venue_fields(name), venue:venues(id, name, deposit_instructions, address, latitude, longitude, area:areas(name_ar), city:cities(timezone, name_ar))")
    .eq("requested_by", user.id)
    .order("starts_at", { ascending: false })
    .limit(100);
  const now = getNow();
  // A hold past its time is released the moment anyone books that field, or by
  // the scheduled job; show it as such right away, as the database will.
  const rows = ((data ?? []) as unknown as (BookingRowData & { venue: { city: { timezone: string } | null } | null })[]).map((b) =>
    b.status === "requested" && b.deposit_status && b.expires_at && Date.parse(b.expires_at) <= now
      ? { ...b, status: "expired" as const, deposit_status: b.deposit_status === "reported" ? ("refund_due" as const) : b.deposit_status }
      : b,
  );
  // Bookings holding their time while the deposit is on its way come first.
  const holding = rows
    .filter((b) => b.status === "requested" && (b.deposit_status === "pending" || b.deposit_status === "reported"))
    .sort((a, b) => Date.parse(a.expires_at ?? a.starts_at) - Date.parse(b.expires_at ?? b.starts_at));
  const others = rows.filter((b) => !holding.includes(b));
  const { data: convs } = rows.length
    ? await supabase.from("conversations").select("id, booking_id").in("booking_id", rows.map((b) => b.id))
    : { data: [] };
  const convByBooking = new Map((convs ?? []).map((c) => [c.booking_id, c.id]));
  // Bookings still holding their time can go in a calendar.
  const calendars = new Map(
    await Promise.all(
      rows.filter(calendarWorthy).map(async (b) => [b.id, await calendarLinks(b as unknown as BookingForCalendar)] as const),
    ),
  );
  // Just booked (the booking page sends people here): offer the calendar first.
  const fresh = typeof booked === "string" ? rows.find((b) => b.id === booked && calendars.has(b.id)) : undefined;
  return (
    <Container className="max-w-3xl py-10">
      <PageHeader title={t("mineTitle")} description={t("mineDescription")} actions={<LinkButton href="/venues" className={buttonClass("primary", "md")}>{t("findVenue")}</LinkButton>} />
      {rows.length === 0 ? <EmptyState title={t("noneMine")} /> : null}
      {fresh ? (
        <Card className="mb-8 border-accent/40" data-testid="booked-prompt">
          <CardBody className="flex flex-col gap-3">
            <h2 className="font-display text-xl font-bold text-ink">
              {fresh.status === "confirmed" ? c("confirmedTitle") : fresh.deposit_status ? c("heldTitle") : c("requestedTitle")}
            </h2>
            <p className="text-sm text-muted">{c("promptBody")}</p>
            <AddToCalendar links={calendars.get(fresh.id)!} prominent />
          </CardBody>
        </Card>
      ) : null}
      {holding.length > 0 ? (
        <Section title={t("awaitingTitle")} id="deposit" className="mb-8">
          <ul className="flex flex-col gap-3">
            {holding.map((b) => (
              <DepositCard key={b.id} b={b} tz={b.venue?.city?.timezone ?? "Asia/Baghdad"} conversationId={convByBooking.get(b.id)} calendar={calendars.get(b.id)} />
            ))}
          </ul>
        </Section>
      ) : null}
      {others.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {others.map((b) => (
            <BookingRow key={b.id} b={b} mode="customer" tz={b.venue?.city?.timezone ?? "Asia/Baghdad"} conversationId={convByBooking.get(b.id)} calendar={calendars.get(b.id)} />
          ))}
        </ul>
      ) : null}
    </Container>
  );
}

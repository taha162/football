import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BookingRow, type BookingRowData } from "@/components/venue/booking-row";
import { buttonClass } from "@/components/ui/button";
import { Container, EmptyState, PageHeader } from "@/components/ui/primitives";

export default async function MyBookingsPage({ params }: PageProps<"/[locale]/my/bookings">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, "/my/bookings");
  const t = await getTranslations("bookings");
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select("*, field:venue_fields(name), venue:venues(id, name, city:cities(timezone))")
    .eq("requested_by", user.id)
    .order("starts_at", { ascending: false })
    .limit(100);
  const rows = data ?? [];
  const { data: convs } = rows.length
    ? await supabase.from("conversations").select("id, booking_id").in("booking_id", rows.map((b) => b.id))
    : { data: [] };
  const convByBooking = new Map((convs ?? []).map((c) => [c.booking_id, c.id]));
  return (
    <Container className="max-w-3xl py-10">
      <PageHeader title={t("mineTitle")} description={t("mineDescription")} actions={<Link href="/venues" className={buttonClass("primary", "md")}>{t("findVenue")}</Link>} />
      {rows.length === 0 ? (
        <EmptyState title={t("noneMine")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((b) => (
            <BookingRow
              key={b.id}
              b={b as unknown as BookingRowData}
              mode="customer"
              tz={b.venue?.city?.timezone ?? "Asia/Baghdad"}
              conversationId={convByBooking.get(b.id)}
            />
          ))}
        </ul>
      )}
    </Container>
  );
}

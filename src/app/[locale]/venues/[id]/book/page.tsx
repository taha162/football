import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Form from "next/form";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { dbErrorCode } from "@/lib/actions";
import { requireOnboardedUser } from "@/lib/auth";
import { formatMoney } from "@/lib/domain/money";
import { acceptsPlatformBookings } from "@/lib/domain/venue";
import { formatTime, todayIn } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { busyIntervals, getDepositSettings, getVenue } from "@/server/venues/queries";
import { requestBookingAction } from "@/server/venues/actions";
import { OpeningHours } from "@/components/venue/opening-hours";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Alert, Card, CardBody, Container, PageHeader } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/link-button";

export default async function BookVenuePage({ params, searchParams }: PageProps<"/[locale]/venues/[id]/book">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, `/venues/${id}/book`);
  const venue = await getVenue(id);
  if (!venue) notFound();
  const t = await getTranslations("booking");
  const errors = await getTranslations("errors");
  const sp = await searchParams;
  const tz = venue.city?.timezone ?? "Asia/Baghdad";
  const fields = (venue.fields ?? []).filter((f) => f.is_active);
  const fieldId = typeof sp.field === "string" && fields.some((f) => f.id === sp.field) ? sp.field : fields[0]?.id;
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayIn(tz, 1);
  const time = typeof sp.time === "string" && /^\d{2}:\d{2}$/.test(sp.time) ? sp.time : null;
  const duration = [60, 90, 120, 150, 180].includes(Number(sp.duration)) ? Number(sp.duration) : 60;
  const matchId = typeof sp.match === "string" && /^[0-9a-f-]{36}$/.test(sp.match) ? sp.match : undefined;

  const deposits = await getDepositSettings();
  if (!acceptsPlatformBookings(venue, deposits.on)) {
    return (
      <Container className="max-w-2xl py-10">
        <PageHeader title={t("title", { name: venue.name })} />
        <Alert tone="info" title={t("notBookableTitle")}>{t("notBookableBody")}</Alert>
        <LinkButton href={`/venues/${id}`} className={buttonClass("outline", "md", "mt-4")}>{t("back")}</LinkButton>
      </Container>
    );
  }

  const busy = fieldId ? (await busyIntervals([fieldId], date))[fieldId] : [];
  type Quote = { price_total: number; currency: string; available: boolean; starts_at: string; ends_at: string; deposit_amount: number | null; deposit_hold_minutes: number };
  let quote: Quote | null = null;
  let quoteError: string | null = null;
  if (fieldId && time) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("quote_booking", { p_field_id: fieldId, p_start_local: `${date} ${time}`, p_duration_minutes: duration });
    if (error) quoteError = dbErrorCode(error, "quote_booking");
    else quote = data as Quote;
  }

  return (
    <Container className="max-w-3xl py-10">
      <PageHeader title={t("title", { name: venue.name })} description={fields.length > 1 ? t("description") : t("descriptionOne")} />
      {matchId ? <Alert tone="info" className="mb-4">{t("forMatch")}</Alert> : null}
      <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardBody>
              <Form action="" scroll={false} className="grid gap-4 sm:grid-cols-2">
                {matchId ? <input type="hidden" name="match" value={matchId} /> : null}
                {/* One court: booked straight away, without a choice. Several: the customer picks. */}
                {fields.length > 1 ? (
                  <label className="flex flex-col gap-1 text-sm">
                    {t("field")}
                    <Select name="field" defaultValue={fieldId}>
                      {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </Select>
                  </label>
                ) : fieldId ? (
                  <input type="hidden" name="field" value={fieldId} />
                ) : null}
                <label className="flex flex-col gap-1 text-sm">
                  {t("date")}
                  <Input type="date" name="date" defaultValue={date} min={todayIn(tz)} dir="ltr" required />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {t("time")}
                  <Input type="time" name="time" defaultValue={time ?? "20:00"} step={1800} dir="ltr" required />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {t("duration")}
                  <Select name="duration" defaultValue={String(duration)}>
                    {[60, 90, 120, 150, 180].map((d) => <option key={d} value={d}>{t("minutes", { count: d })}</option>)}
                  </Select>
                </label>
                <button type="submit" className={buttonClass("secondary", "md", "sm:col-span-2")}>{t("check")}</button>
              </Form>
            </CardBody>
          </Card>

          <section aria-labelledby="busy-title" className="flex flex-col gap-2">
            <h2 id="busy-title" className="font-semibold">{t("busyTitle")}</h2>
            {busy.length === 0 ? (
              <p className="text-sm text-muted">{t("noBusy")}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {busy.map((b, i) => (
                  <li key={i} className="num rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1 text-xs text-danger" dir="ltr">
                    {formatTime(b.starts_at, locale, tz)} – {formatTime(b.ends_at, locale, tz)}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted">{t("busyNote")}</p>
          </section>

          <div aria-live="polite">
            {quoteError ? <Alert tone="warning">{errors.has(quoteError) ? errors(quoteError) : errors("generic")}</Alert> : null}
            {quote ? (
              <Card>
                <CardBody className="flex flex-col gap-4">
                  {quote.available ? (
                    <>
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm text-muted">{t("price")}</span>
                        <span className="num font-display text-2xl font-bold">{formatMoney(quote.price_total, quote.currency, locale)}</span>
                      </div>
                      {quote.deposit_amount ? (
                        <>
                          <div className="flex items-baseline justify-between">
                            <span className="text-sm text-muted">{t("depositTitle")}</span>
                            <span className="num font-display text-xl font-bold text-accent">{formatMoney(quote.deposit_amount, quote.currency, locale)}</span>
                          </div>
                          <div className="flex items-baseline justify-between text-sm text-muted">
                            <span>{t("remaining")}</span>
                            <span className="num">{formatMoney(quote.price_total - quote.deposit_amount, quote.currency, locale)}</span>
                          </div>
                          <p className="text-xs text-muted">{t("depositNote", { minutes: quote.deposit_hold_minutes })}</p>
                          {venue.deposit_instructions ? (
                            <div className="rounded-lg border border-line bg-surface-2 p-3">
                              <p className="text-xs font-semibold text-muted">{t("howToPay")}</p>
                              <p className="mt-1 whitespace-pre-line text-sm" dir="auto">{venue.deposit_instructions}</p>
                            </div>
                          ) : null}
                          <p className="text-xs text-muted">{t("depositPolicy")}</p>
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-muted">{venue.auto_confirm_bookings ? t("autoConfirmNote") : t("requestNote")}</p>
                          <p className="text-xs text-muted">{t("paymentNote")}</p>
                        </>
                      )}
                      <ActionForm action={requestBookingAction}>
                        <Hidden values={{ field_id: fieldId, start: `${date}T${time}`, duration, match_id: matchId }} />
                        <label className="flex flex-col gap-1 text-sm">
                          {t("note")}
                          <Textarea name="note" maxLength={500} />
                        </label>
                        <SubmitButton size="lg">{quote.deposit_amount ? t("holdAndPay") : venue.auto_confirm_bookings ? t("bookNow") : t("sendRequest")}</SubmitButton>
                      </ActionForm>
                      <Link href="/my/bookings" className="text-sm text-accent hover:underline">{t("myBookings")}</Link>
                    </>
                  ) : (
                    <Alert tone="warning">{t("unavailable")}</Alert>
                  )}
                </CardBody>
              </Card>
            ) : null}
          </div>
        </div>
        <aside className="flex flex-col gap-3">
          <h2 className="font-semibold">{t("hours")}</h2>
          <OpeningHours hours={venue.hours ?? []} />
          <p className="text-xs text-muted">{t("noticeRule", { minutes: venue.min_notice_minutes, days: venue.max_advance_days })}</p>
          <p className="text-xs text-muted">{t(deposits.on ? "cancellationRuleDeposit" : "cancellationRule", { hours: venue.cancellation_deadline_hours })}</p>
          <p className="text-xs text-muted">{t("signedInAs", { name: user.profile.display_name })}</p>
        </aside>
      </div>
    </Container>
  );
}

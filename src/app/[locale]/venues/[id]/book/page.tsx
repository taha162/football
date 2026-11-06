import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Form from "next/form";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { dbErrorCode } from "@/lib/actions";
import { requireOnboardedUser } from "@/lib/auth";
import { formatMoney } from "@/lib/domain/money";
import { acceptsPlatformBookings } from "@/lib/domain/venue";
import { formatDate, formatDateTime, formatTime, todayIn } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getNow } from "@/lib/now";
import { freeStartTimes, getDepositSettings, getVenue, pendingRequests } from "@/server/venues/queries";
import { requestBookingAction } from "@/server/venues/actions";
import { OpeningHours } from "@/components/venue/opening-hours";
import { BringIntoView } from "@/components/venue/bring-into-view";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Alert, Card, CardBody, Container, PageHeader } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/link-button";
import { SubmitOnChange } from "@/components/ui/submit-on-change";

const DURATIONS = [60, 90, 120, 150, 180];

/** quote_booking: the price, and when the time is taken, what it runs into. */
type Quote = {
  price_total: number;
  currency: string;
  available: boolean;
  starts_at: string;
  ends_at: string;
  conflict: "mine" | "held" | "closed" | "booked" | "gap" | null;
  held_until: string | null;
  gap_minutes: number;
  deposit_amount: number | null;
  deposit_hold_minutes: number;
};

export default async function BookVenuePage({ params, searchParams }: PageProps<"/[locale]/venues/[id]/book">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, `/venues/${id}/book`);
  const [venue, deposits] = await Promise.all([getVenue(id), getDepositSettings()]);
  if (!venue) notFound();
  const t = await getTranslations("booking");
  const errors = await getTranslations("errors");
  const sp = await searchParams;
  const tz = venue.city?.timezone ?? "Asia/Baghdad";
  const fields = (venue.fields ?? []).filter((f) => f.is_active);
  const fieldId = typeof sp.field === "string" && fields.some((f) => f.id === sp.field) ? sp.field : fields[0]?.id;
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayIn(tz, 1);
  const time = typeof sp.time === "string" && /^\d{2}:\d{2}$/.test(sp.time) ? sp.time : null;
  const duration = DURATIONS.includes(Number(sp.duration)) ? Number(sp.duration) : 60;
  const matchId = typeof sp.match === "string" && /^[0-9a-f-]{36}$/.test(sp.match) ? sp.match : undefined;

  if (!acceptsPlatformBookings(venue, deposits.on)) {
    return (
      <Container className="max-w-2xl py-10">
        <PageHeader title={t("title", { name: venue.name })} />
        <Alert tone="info" title={t("notBookableTitle")}>{t("notBookableBody")}</Alert>
        <LinkButton href={`/venues/${id}`} className={buttonClass("outline", "md", "mt-4")}>{t("back")}</LinkButton>
      </Container>
    );
  }
  // Bookings are only within opening hours: without any, no time can be booked.
  if ((venue.hours ?? []).length === 0) {
    return (
      <Container className="max-w-2xl py-10">
        <PageHeader title={t("title", { name: venue.name })} />
        <Alert tone="info" title={t("noHoursTitle")}>{t("noHoursBody")}</Alert>
        <LinkButton href={`/venues/${id}`} className={buttonClass("outline", "md", "mt-4")}>{t("back")}</LinkButton>
      </Container>
    );
  }

  // The times that can really be booked, so the customer picks one rather than guessing.
  const [free, pending] = await Promise.all([fieldId ? freeStartTimes(fieldId, date, duration) : [], pendingRequests(user.id, getNow())]);
  // As many requests waiting for an answer as allowed: another would be refused, so say so first.
  const atLimit = pending.count >= pending.max;
  let quote: Quote | null = null;
  let quoteError: string | null = null;
  if (fieldId && time) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("quote_booking", { p_field_id: fieldId, p_start_local: `${date} ${time}`, p_duration_minutes: duration });
    if (error) quoteError = dbErrorCode(error, "quote_booking");
    else quote = data as Quote;
  }

  // This page for a start time, keeping the court, the day, the duration and the match.
  const pick = (start: string) => ({
    pathname: `/venues/${id}/book`,
    query: { ...(fieldId ? { field: fieldId } : {}), date, time: start, duration: String(duration), ...(matchId ? { match: matchId } : {}) },
  });
  // Noon UTC is the same calendar day in every venue's timezone.
  const day = formatDate(`${date}T12:00:00Z`, locale, tz, { weekday: "long", day: "numeric", month: "long", year: undefined });
  const taken = (q: Quote) => {
    switch (q.conflict) {
      case "mine":
        return t("conflict.mine");
      case "held":
        // The hold can end on another day than the booking, so the day is said too.
        return q.held_until
          ? t("conflict.held", { time: formatDateTime(q.held_until, locale, tz, { day: undefined, month: undefined }) })
          : t("conflict.heldReported");
      case "closed":
        return t("conflict.closed");
      case "gap":
        return t("conflict.gap", { minutes: q.gap_minutes });
      default:
        return t("conflict.booked");
    }
  };

  return (
    <Container className="max-w-3xl py-10">
      <PageHeader title={t("title", { name: venue.name })} description={fields.length > 1 ? t("description") : t("descriptionOne")} />
      {matchId ? <Alert tone="info" className="mb-4">{t("forMatch")}</Alert> : null}
      {atLimit ? (
        <Alert tone="warning" className="mb-4" title={t("pendingLimitTitle", { count: pending.count })}>
          <p>{t("pendingLimitBody")}</p>
          <Link href="/my/bookings" className="mt-1 inline-block text-accent hover:underline">{t("myBookings")}</Link>
        </Alert>
      ) : null}
      <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardBody>
              <Form action="" scroll={false} className="grid gap-4 sm:grid-cols-2">
                <SubmitOnChange />
                {matchId ? <input type="hidden" name="match" value={matchId} /> : null}
                {/* One court: booked straight away, without a choice. Several: the customer picks. */}
                {fields.length > 1 ? (
                  <label className="flex flex-col gap-1 text-sm sm:col-span-2">
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
                  {t("duration")}
                  <Select name="duration" defaultValue={String(duration)}>
                    {DURATIONS.map((d) => <option key={d} value={d}>{t("minutes", { count: d })}</option>)}
                  </Select>
                </label>
                <button type="submit" className={buttonClass("secondary", "md", "sm:col-span-2")}>{t("check")}</button>
              </Form>
            </CardBody>
          </Card>

          <section aria-labelledby="free-title" className="flex flex-col gap-3" data-testid="free-times">
            <h2 id="free-title" className="font-semibold">{free === null ? t("typeTitle", { day }) : t("freeTitle", { day })}</h2>
            {free === null ? (
              // The free times couldn't be listed (the database lacks them until its update is run): type the time instead.
              <Form action="" scroll={false} className="flex flex-wrap items-end gap-2">
                {fieldId ? <input type="hidden" name="field" value={fieldId} /> : null}
                <input type="hidden" name="date" value={date} />
                <input type="hidden" name="duration" value={duration} />
                {matchId ? <input type="hidden" name="match" value={matchId} /> : null}
                <label className="flex flex-col gap-1 text-sm">
                  {t("time")}
                  <Input type="time" name="time" defaultValue={time ?? "20:00"} step={1800} dir="ltr" required />
                </label>
                <button type="submit" className={buttonClass("secondary", "md")}>{t("checkTime")}</button>
              </Form>
            ) : free.length === 0 ? (
              <p className="text-sm text-muted">{t("freeNone")}</p>
            ) : (
              <>
                <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {free.map((s) => (
                    <li key={s.start_local}>
                      <LinkButton
                        href={pick(s.start_local)}
                        replace
                        scroll={false}
                        aria-current={s.start_local === time ? "true" : undefined}
                        className={buttonClass(s.start_local === time ? "primary" : "outline", "sm", "num w-full px-1")}
                      >
                        {formatTime(s.starts_at, locale, tz)}
                      </LinkButton>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted">{t("freeHint")}</p>
              </>
            )}
          </section>

          {time ? (
            <BringIntoView key={`${fieldId}|${date}|${time}|${duration}`}>
              <div aria-live="polite">
                {quoteError ? <Alert tone="warning">{errors.has(quoteError) ? errors(quoteError) : errors("generic")}</Alert> : null}
                {quote && !quote.available ? (
                  <Alert tone="warning" title={t("takenTitle", { time: formatTime(quote.starts_at, locale, tz) })}>
                    <p>{taken(quote)}</p>
                    {quote.conflict === "mine" ? (
                      <Link href="/my/bookings" className="mt-1 inline-block text-accent hover:underline">{t("myBookings")}</Link>
                    ) : free && free.length > 0 ? (
                      <p className="mt-1">{t("pickFree")}</p>
                    ) : null}
                  </Alert>
                ) : null}
                {quote?.available ? (
                  <Card>
                    <CardBody className="flex flex-col gap-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm text-muted">{t("chosen")}</span>
                        <span className="num font-semibold">
                          {formatTime(quote.starts_at, locale, tz)} – {formatTime(quote.ends_at, locale, tz)}
                        </span>
                      </div>
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
                      {atLimit ? (
                        // Refused anyway: the note at the top says why and where to look.
                        <p className="text-sm text-warning">{t("pendingLimitTitle", { count: pending.count })}</p>
                      ) : (
                        <ActionForm action={requestBookingAction}>
                          <Hidden values={{ field_id: fieldId, start: `${date}T${time}`, duration, match_id: matchId }} />
                          <label className="flex flex-col gap-1 text-sm">
                            {t("note")}
                            <Textarea name="note" maxLength={500} />
                          </label>
                          <SubmitButton size="lg">{quote.deposit_amount ? t("holdAndPay") : venue.auto_confirm_bookings ? t("bookNow") : t("sendRequest")}</SubmitButton>
                        </ActionForm>
                      )}
                      <Link href="/my/bookings" className="text-sm text-accent hover:underline">{t("myBookings")}</Link>
                    </CardBody>
                  </Card>
                ) : null}
              </div>
            </BringIntoView>
          ) : null}
        </div>
        <aside className="flex flex-col gap-3">
          <h2 className="font-semibold">{t("hours")}</h2>
          <OpeningHours hours={venue.hours ?? []} timeZone={tz} />
          <p className="text-xs text-muted">{t("noticeRule", { minutes: venue.min_notice_minutes, days: venue.max_advance_days })}</p>
          <p className="text-xs text-muted">{t(deposits.on ? "cancellationRuleDeposit" : "cancellationRule", { hours: venue.cancellation_deadline_hours })}</p>
          <p className="text-xs text-muted">{t("signedInAs", { name: user.profile.display_name })}</p>
        </aside>
      </div>
    </Container>
  );
}

import { notFound } from "next/navigation";
import { getNow } from "@/lib/now";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link, redirect } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { MATCH_FORMATS } from "@/lib/domain/match";
import { formatMoney } from "@/lib/domain/money";
import { SURFACES } from "@/lib/domain/venue";
import { formatTime, todayIn } from "@/lib/format";
import { publicStorageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { getAreas, getCities } from "@/server/reference";
import { getVenue, myVenueRole } from "@/server/venues/queries";
import {
  addStaffAction,
  manualBookingAction,
  removeStaffAction,
  removeVenueImageAction,
  requestVerificationAction,
  setOpeningHoursAction,
  setPricingRulesAction,
  upsertFieldAction,
  uploadVenueImageAction,
} from "@/server/venues/actions";
import { BookingRow, type BookingRowData } from "@/components/venue/booking-row";
import { VenueForm } from "@/components/venue/venue-form";
import { ActionForm, FormField, Hidden, InlineAction, SubmitButton } from "@/components/ui/action-form";
import { Avatar, StorageImage } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Checkbox, ChoiceChips, Input, Select, controlProps } from "@/components/ui/field";
import { Alert, Badge, Card, CardBody, Container, PageHeader, Section, Stat } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

const TABS = ["bookings", "fields", "hours", "profile", "staff", "reports"] as const;
type Tab = (typeof TABS)[number];

export default async function ManageVenuePage({ params, searchParams }: PageProps<"/[locale]/manage/venues/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, `/manage/venues/${id}`);
  const venue = await getVenue(id);
  if (!venue) notFound();
  const role = await myVenueRole(id, user.id);
  // UI guard only — every action is authorized again in the database.
  if (!role) redirect({ href: `/venues/${id}`, locale });
  const canManage = role === "owner" || role === "manager";
  const sp = await searchParams;
  const tab: Tab = TABS.find((x) => x === sp.tab) ?? "bookings";
  const t = await getTranslations("venueDashboard");
  const vp = await getTranslations("venuePage");
  const tz = venue.city?.timezone ?? "Asia/Baghdad";
  const currency = venue.city?.currency ?? "IQD";
  const fields = venue.fields ?? [];
  const supabase = await createClient();
  const visibleTabs = TABS.filter((x) => canManage || x === "bookings");

  return (
    <Container className="flex flex-col gap-6 py-10">
      <PageHeader
        eyebrow={t(`role.${role}`)}
        title={venue.name}
        actions={<Link href={`/venues/${id}`} className={buttonClass("ghost", "md")}>{t("viewPublic")}</Link>}
      />
      {venue.verification_status !== "verified" ? (
        <Alert tone={venue.verification_status === "rejected" ? "danger" : "info"} title={vp(`verification.${venue.verification_status}`)}>
          {venue.verification_note ?? t("verificationExplain")}
          {canManage && ["unverified", "rejected"].includes(venue.verification_status) ? (
            <div className="mt-2">
              <InlineAction action={requestVerificationAction} values={{ venue_id: id }} label={t("requestVerification")} variant="primary" />
            </div>
          ) : null}
        </Alert>
      ) : null}

      <nav aria-label={t("sections")} className="flex flex-wrap gap-2 border-b border-line pb-3">
        {visibleTabs.map((x) => (
          <Link key={x} href={{ pathname: `/manage/venues/${id}`, query: { tab: x } }} aria-current={tab === x ? "page" : undefined} className={cn(buttonClass(tab === x ? "secondary" : "ghost", "sm"))}>
            {t(`tabs.${x}`)}
          </Link>
        ))}
      </nav>

      {tab === "bookings" ? <BookingsTab venueId={id} fields={fields} tz={tz} date={typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayIn(tz)} /> : null}

      {tab === "fields" && canManage ? (
        <div className="flex flex-col gap-6">
          {fields.map((f) => (
            <Card key={f.id}>
              <CardBody className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-lg font-semibold">{f.name}</h2>
                  {!f.is_active ? <Badge tone="warning">{t("inactive")}</Badge> : null}
                </div>
                <FieldForm venueId={id} field={f} t={t} vp={vp} />
                <details className="rounded-xl border border-line p-3">
                  <summary className="cursor-pointer text-sm font-semibold">{t("pricingRules", { count: (f.rules ?? []).length })}</summary>
                  <PricingForm venueId={id} fieldId={f.id} rules={f.rules ?? []} t={t} locale={locale} />
                </details>
              </CardBody>
            </Card>
          ))}
          <Card>
            <CardBody className="flex flex-col gap-3">
              <h2 className="font-display text-lg font-semibold">{t("addField")}</h2>
              <FieldForm venueId={id} t={t} vp={vp} />
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === "hours" && canManage ? (
        <Card>
          <CardBody>
            <ActionForm action={setOpeningHoursAction}>
              <Hidden values={{ venue_id: id }} />
              <p className="text-sm text-muted">{t("hoursHint")}</p>
              <div className="flex flex-col gap-2">
                {[6, 0, 1, 2, 3, 4, 5].map((d) => {
                  const h = (venue.hours ?? []).find((x) => x.weekday === d);
                  const day = new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + d)));
                  return (
                    <div key={d} className="grid grid-cols-[8rem_1fr_1fr] items-center gap-3">
                      <Checkbox name={`open_${d}`} defaultChecked={Boolean(h)} label={day} />
                      <Input type="time" name={`opens_${d}`} defaultValue={h?.opens.slice(0, 5) ?? "08:00"} aria-label={t("opensOn", { day })} dir="ltr" />
                      <Input type="time" name={`closes_${d}`} defaultValue={h?.closes.slice(0, 5) ?? "00:00"} aria-label={t("closesOn", { day })} dir="ltr" />
                    </div>
                  );
                })}
              </div>
              <SubmitButton className="self-start">{t("saveHours")}</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}

      {tab === "profile" && canManage ? (
        <div className="flex flex-col gap-8">
          <Section title={t("photos")} id="photos">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {venue.cover_image_path ? (
                <div className="relative aspect-[4/3] overflow-hidden rounded-xl border-2 border-accent">
                  <StorageImage src={publicStorageUrl("venue-images", venue.cover_image_path)!} alt={t("cover")} fill sizes="25vw" className="object-cover" />
                  <Badge tone="accent" className="absolute start-2 top-2">{t("cover")}</Badge>
                </div>
              ) : null}
              {(venue.images ?? []).map((img) => (
                <div key={img.id} className="flex flex-col gap-1">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-line">
                    <StorageImage src={publicStorageUrl("venue-images", img.path)!} alt="" fill sizes="25vw" className="object-cover" />
                  </div>
                  <InlineAction action={removeVenueImageAction} values={{ image_id: img.id, venue_id: id }} label={t("removePhoto")} variant="ghost" />
                </div>
              ))}
            </div>
            <ActionForm action={uploadVenueImageAction} resetOnSuccess>
              <Hidden values={{ venue_id: id }} />
              <FormField name="image" label={t("uploadPhoto")} hint={t("photoHint")}>
                <Input {...controlProps("image")} type="file" accept="image/jpeg,image/png,image/webp" required className="py-2" />
              </FormField>
              <Checkbox name="as_cover" label={t("useAsCover")} />
              <SubmitButton variant="secondary" className="self-start">{t("upload")}</SubmitButton>
            </ActionForm>
          </Section>
          <Section title={t("details")} id="details">
            <VenueForm
              cities={await getCities()}
              areas={await getAreas()}
              canEditSettings
              defaults={{
                id,
                name: venue.name,
                description: venue.description,
                city_id: venue.city_id,
                area_id: venue.area_id,
                address: venue.address,
                latitude: venue.latitude,
                longitude: venue.longitude,
                phone: venue.phone,
                whatsapp: venue.whatsapp,
                facilities: venue.facilities,
                booking_mode: venue.booking_mode,
                auto_confirm_bookings: venue.auto_confirm_bookings,
                buffer_minutes: venue.buffer_minutes,
                min_notice_minutes: venue.min_notice_minutes,
                max_advance_days: venue.max_advance_days,
                cancellation_deadline_hours: venue.cancellation_deadline_hours,
                cancellation_policy: venue.cancellation_policy,
                verification_status: venue.verification_status,
              }}
            />
          </Section>
        </div>
      ) : null}

      {tab === "staff" && canManage ? <StaffTab venueId={id} isOwner={role === "owner"} query={typeof sp.q === "string" ? sp.q.slice(0, 40) : ""} /> : null}

      {tab === "reports" && canManage ? <ReportsTab venueId={id} currency={currency} locale={locale} /> : null}
    </Container>
  );

  async function BookingsTab({ venueId, fields: fs, tz: zone, date }: { venueId: string; fields: typeof fields; tz: string; date: string }) {
    const { data: pending } = await supabase
      .from("bookings")
      .select("*, field:venue_fields(name), requester:profiles!bookings_requested_by_fkey(display_name)")
      .eq("venue_id", venueId)
      .eq("status", "requested")
      .order("starts_at");
    const from = new Date(`${date}T00:00:00Z`);
    const { data: dayRows } = await supabase
      .from("bookings")
      .select("*, field:venue_fields(name), requester:profiles!bookings_requested_by_fkey(display_name)")
      .eq("venue_id", venueId)
      .in("status", ["confirmed", "completed", "no_show"])
      .gte("starts_at", new Date(from.getTime() - 86_400_000).toISOString())
      .lt("starts_at", new Date(from.getTime() + 2 * 86_400_000).toISOString())
      .order("starts_at");
    const sameDay = (dayRows ?? []).filter((b) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(b.starts_at)) === date);
    const ids = [...(pending ?? []), ...sameDay].map((b) => b.id);
    const { data: convs } = ids.length ? await supabase.from("conversations").select("id, booking_id").in("booking_id", ids) : { data: [] };
    const conv = new Map((convs ?? []).map((c) => [c.booking_id, c.id]));
    return (
      <div className="flex flex-col gap-8">
        <Section title={t("pendingRequests", { count: (pending ?? []).length })} id="pending">
          {(pending ?? []).length === 0 ? <p className="text-sm text-muted">{t("noPending")}</p> : null}
          <ul className="flex flex-col gap-3">
            {(pending ?? []).map((b) => (
              <BookingRow key={b.id} b={b as unknown as BookingRowData} mode="staff" tz={zone} conversationId={conv.get(b.id)} />
            ))}
          </ul>
        </Section>
        <Section title={t("calendar")} id="calendar">
          <form method="get" className="flex items-end gap-2">
            <input type="hidden" name="tab" value="bookings" />
            <label className="flex flex-col gap-1 text-sm">
              {t("date")}
              <Input type="date" name="date" defaultValue={date} dir="ltr" />
            </label>
            <button type="submit" className={buttonClass("secondary", "md")}>{t("show")}</button>
          </form>
          <div className="grid gap-4 md:grid-cols-2">
            {fs.filter((f) => f.is_active).map((f) => (
              <Card key={f.id}>
                <CardBody className="flex flex-col gap-2">
                  <h3 className="font-semibold">{f.name}</h3>
                  {sameDay.filter((b) => b.field_id === f.id).length === 0 ? <p className="text-sm text-muted">{t("free")}</p> : null}
                  <ul className="flex flex-col gap-1 text-sm">
                    {sameDay
                      .filter((b) => b.field_id === f.id)
                      .map((b) => (
                        <li key={b.id} className="num flex justify-between gap-2 rounded-lg bg-surface-2 px-2 py-1">
                          <span dir="ltr">{formatTime(b.starts_at, locale, zone)}–{formatTime(b.ends_at, locale, zone)}</span>
                          <span className="truncate text-muted">{b.kind === "block" ? t("blocked") : (b.requester?.display_name ?? b.customer_name ?? t("walkIn"))}</span>
                        </li>
                      ))}
                  </ul>
                </CardBody>
              </Card>
            ))}
          </div>
          <ul className="flex flex-col gap-3">
            {sameDay.map((b) => (
              <BookingRow key={b.id} b={b as unknown as BookingRowData} mode="staff" tz={zone} conversationId={conv.get(b.id)} />
            ))}
          </ul>
        </Section>
        <Section title={t("manualBooking")} id="manual">
          <Card>
            <CardBody>
              <ActionForm action={manualBookingAction} resetOnSuccess>
                <Hidden values={{ venue_id: venueId }} />
                <div className="grid gap-4 sm:grid-cols-3">
                  <FormField name="field_id" label={t("field")} required>
                    <Select {...controlProps("field_id")}>
                      {fs.filter((f) => f.is_active).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </Select>
                  </FormField>
                  <FormField name="start" label={t("start")} required>
                    <Input {...controlProps("start")} type="datetime-local" defaultValue={`${date}T20:00`} required dir="ltr" />
                  </FormField>
                  <FormField name="duration" label={t("duration")}>
                    <Select {...controlProps("duration")} defaultValue="60">
                      {[30, 60, 90, 120, 180, 240].map((d) => <option key={d} value={d}>{t("minutes", { count: d })}</option>)}
                    </Select>
                  </FormField>
                  <FormField name="kind" label={t("kindLabel")}>
                    <Select {...controlProps("kind")} defaultValue="manual">
                      <option value="manual">{t("kindManual")}</option>
                      <option value="block">{t("kindBlock")}</option>
                    </Select>
                  </FormField>
                  <FormField name="customer_name" label={t("customerName")}>
                    <Input {...controlProps("customer_name")} maxLength={100} />
                  </FormField>
                  <FormField name="price" label={t("priceOverride")} hint={t("priceOverrideHint")}>
                    <Input {...controlProps("price")} inputMode="numeric" dir="ltr" />
                  </FormField>
                </div>
                <SubmitButton className="self-start">{t("record")}</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        </Section>
      </div>
    );
  }

  async function StaffTab({ venueId, isOwner, query }: { venueId: string; isOwner: boolean; query: string }) {
    const { data: staff } = await supabase.from("venue_staff").select("user_id, role, profile:profiles!venue_staff_user_id_fkey(display_name, avatar_path)").eq("venue_id", venueId);
    let candidates: { id: string; display_name: string }[] = [];
    if (isOwner && query.length >= 2) {
      const { data } = await supabase.from("profiles").select("id, display_name").ilike("display_name", `%${query.replace(/[%_\\]/g, "")}%`).limit(8);
      const existing = new Set((staff ?? []).map((s) => s.user_id));
      candidates = (data ?? []).filter((p) => !existing.has(p.id));
    }
    return (
      <div className="flex flex-col gap-6">
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
          {(staff ?? []).map((s) => (
            <li key={s.user_id} className="flex items-center gap-3 p-3">
              <Avatar src={publicStorageUrl("avatars", s.profile?.avatar_path)} name={s.profile?.display_name ?? "?"} size={32} />
              <span className="flex-1 text-sm">{s.profile?.display_name}</span>
              <Badge tone={s.role === "owner" ? "accent" : "neutral"}>{t(`role.${s.role}`)}</Badge>
              {isOwner && s.role !== "owner" ? (
                <ConfirmAction action={removeStaffAction} values={{ venue_id: venueId, user_id: s.user_id }} label={t("remove")} title={t("removeStaff")} confirmLabel={t("remove")} />
              ) : null}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">{t("staffRoles")}</p>
        {isOwner ? (
          <div className="flex flex-col gap-3">
            <form method="get" className="flex gap-2">
              <input type="hidden" name="tab" value="staff" />
              <label htmlFor="staff-q" className="sr-only">{t("searchPeople")}</label>
              <Input id="staff-q" name="q" defaultValue={query} placeholder={t("searchPeople")} />
              <button type="submit" className={buttonClass("secondary", "md")}>{t("search")}</button>
            </form>
            <ul className="flex flex-col gap-2">
              {candidates.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3">
                  <span className="flex-1 text-sm">{p.display_name}</span>
                  <ActionForm action={addStaffAction} className="flex-row items-center gap-2">
                    <Hidden values={{ venue_id: venueId, user_id: p.id }} />
                    <Select name="role" defaultValue="staff" className="h-9 w-32 text-sm" aria-label={t("roleLabel")}>
                      <option value="staff">{t("role.staff")}</option>
                      <option value="manager">{t("role.manager")}</option>
                    </Select>
                    <SubmitButton size="sm">{t("addStaff")}</SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }
}

async function ReportsTab({ venueId, currency, locale }: { venueId: string; currency: string; locale: string }) {
  const t = await getTranslations("venueDashboard");
  const supabase = await createClient();
  const since = new Date(getNow() - 30 * 86_400_000).toISOString();
  const { data } = await supabase.from("bookings").select("status, kind, price_total, starts_at, ends_at").eq("venue_id", venueId).gte("starts_at", since);
  const rows = data ?? [];
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const played = rows.filter((r) => ["confirmed", "completed", "no_show"].includes(r.status) && r.kind !== "block");
  const value = played.filter((r) => r.status !== "no_show").reduce((sum, r) => sum + r.price_total, 0);
  const hours = played.reduce((sum, r) => sum + (new Date(r.ends_at).getTime() - new Date(r.starts_at).getTime()) / 3_600_000, 0);
  const noShowRate = played.length ? Math.round((count("no_show") / played.length) * 100) : 0;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t("reportPeriod")}</p>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("stat.requests")} value={rows.filter((r) => r.kind === "customer").length} />
        <Stat label={t("stat.confirmed")} value={count("confirmed") + count("completed")} />
        <Stat label={t("stat.rejected")} value={count("rejected") + count("expired")} />
        <Stat label={t("stat.cancelled")} value={count("cancelled")} />
        <Stat label={t("stat.hours")} value={Math.round(hours * 10) / 10} />
        <Stat label={t("stat.noShowRate")} value={`${noShowRate}%`} />
        <Stat label={t("stat.value")} value={formatMoney(value, currency, locale)} hint={t("stat.valueHint")} />
      </dl>
    </div>
  );
}

function FieldForm({
  venueId,
  field,
  t,
  vp,
}: {
  venueId: string;
  field?: { id: string; name: string; surface: string; formats: string[]; is_covered: boolean; has_lights: boolean; price_per_hour: number; is_active: boolean };
  t: Awaited<ReturnType<typeof getTranslations<"venueDashboard">>>;
  vp: Awaited<ReturnType<typeof getTranslations<"venuePage">>>;
}) {
  return (
    <ActionForm action={upsertFieldAction} resetOnSuccess={!field}>
      <Hidden values={{ venue_id: venueId, field_id: field?.id }} />
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField name="name" label={t("fieldName")} required>
          <Input {...controlProps("name")} defaultValue={field?.name} required maxLength={60} />
        </FormField>
        <FormField name="surface" label={t("surface")}>
          <Select {...controlProps("surface")} defaultValue={field?.surface ?? "artificial_turf"}>
            {SURFACES.map((s) => <option key={s} value={s}>{vp(`surface.${s}`)}</option>)}
          </Select>
        </FormField>
        <FormField name="price_per_hour" label={t("pricePerHour")} hint={t("currencyHint")} required>
          <Input {...controlProps("price_per_hour")} inputMode="numeric" defaultValue={field?.price_per_hour} required dir="ltr" />
        </FormField>
      </div>
      <ChoiceChips name="formats" legend={t("formats")} defaultValue={field?.formats ?? []} options={MATCH_FORMATS.map((f) => ({ value: f, label: f }))} />
      <div className="flex flex-wrap gap-4">
        <Checkbox name="is_covered" defaultChecked={field?.is_covered} label={vp("covered")} />
        <Checkbox name="has_lights" defaultChecked={field?.has_lights ?? true} label={vp("lights")} />
        {field ? <Checkbox name="is_active" defaultChecked={field.is_active} label={t("active")} /> : null}
      </div>
      <SubmitButton size="sm" className="self-start">{field ? t("saveField") : t("addField")}</SubmitButton>
    </ActionForm>
  );
}

function PricingForm({
  venueId,
  fieldId,
  rules,
  t,
  locale,
}: {
  venueId: string;
  fieldId: string;
  rules: { weekdays: number[]; start_time: string; end_time: string; price_per_hour: number }[];
  t: Awaited<ReturnType<typeof getTranslations<"venueDashboard">>>;
  locale: string;
}) {
  const rows = [...rules, ...Array.from({ length: Math.max(0, 3 - rules.length) }, () => null)].slice(0, 6);
  const dayName = (d: number) => new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ" : "en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + d)));
  return (
    <ActionForm action={setPricingRulesAction} className="mt-3">
      <Hidden values={{ venue_id: venueId, field_id: fieldId }} />
      <p className="text-xs text-muted">{t("pricingHint")}</p>
      {rows.map((r, i) => (
        <fieldset key={i} className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <legend className="px-1 text-xs text-muted">{t("rule", { n: i + 1 })}</legend>
          <ChoiceChips name={`rule_${i}_days`} legend={t("days")} defaultValue={(r?.weekdays ?? []).map(String)} options={[6, 0, 1, 2, 3, 4, 5].map((d) => ({ value: String(d), label: dayName(d) }))} />
          <div className="grid grid-cols-3 gap-2">
            <Input type="time" name={`rule_${i}_start`} defaultValue={r?.start_time.slice(0, 5) ?? "18:00"} aria-label={t("from")} dir="ltr" />
            <Input type="time" name={`rule_${i}_end`} defaultValue={r?.end_time.slice(0, 5) ?? "00:00"} aria-label={t("to")} dir="ltr" />
            <Input name={`rule_${i}_price`} inputMode="numeric" defaultValue={r?.price_per_hour ?? ""} placeholder={t("pricePerHour")} aria-label={t("pricePerHour")} dir="ltr" />
          </div>
        </fieldset>
      ))}
      <SubmitButton size="sm" className="self-start">{t("savePricing")}</SubmitButton>
    </ActionForm>
  );
}

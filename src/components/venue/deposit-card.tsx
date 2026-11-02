import { getLocale, getTranslations } from "next-intl/server";
import { MessageCircle } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/domain/money";
import { formatDateTime, formatTime } from "@/lib/format";
import { cancelBookingAction, reportDepositAction } from "@/server/venues/actions";
import { ActionForm, FormField, Hidden, SubmitButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Input, controlProps } from "@/components/ui/field";
import { Badge } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/link-button";
import { AddToCalendar, type CalendarLinks } from "./add-to-calendar";
import { depositTone, type BookingRowData } from "./booking-row";

/**
 * A booking holding its time while the customer sends the deposit: how much,
 * by when, where to send it, and a way to tell the venue it is on its way.
 */
export async function DepositCard({ b, tz, conversationId, calendar }: { b: BookingRowData; tz: string; conversationId?: string; calendar?: CalendarLinks }) {
  const t = await getTranslations("bookings");
  const locale = await getLocale();
  const deposit = formatMoney(b.deposit_amount ?? 0, b.currency, locale);
  const pending = b.deposit_status === "pending";
  return (
    <li className="reveal flex flex-col gap-3 rounded-xl border border-accent/40 bg-surface p-4 shadow-[0_0_0_1px_rgb(184_242_63/0.08),0_18px_40px_-28px_rgb(184_242_63/0.4)]">
      <div className="flex flex-wrap items-center gap-2">
        {b.venue ? <Link href={`/venues/${b.venue.id}`} className="font-semibold hover:underline">{b.venue.name}</Link> : null}
        <Badge tone={depositTone[b.deposit_status ?? "pending"]}>{t(`depositStatus.${b.deposit_status ?? "pending"}`)}</Badge>
      </div>
      <p className="num text-sm text-muted">
        {b.field?.name} · {formatDateTime(b.starts_at, locale, tz)} – {formatTime(b.ends_at, locale, tz)} · {formatMoney(b.price_total, b.currency, locale)}
      </p>
      <p className="num font-display text-2xl font-bold text-accent">{t("depositAmount", { amount: deposit })}</p>
      {pending && b.expires_at ? (
        <p className="num text-sm font-medium">{t("sendBy", { time: formatTime(b.expires_at, locale, tz) })}</p>
      ) : (
        <p className="text-sm" dir="auto">{t("reported", { reference: b.deposit_reference ?? "" })}</p>
      )}
      {b.venue?.deposit_instructions ? (
        <div className="rounded-lg border border-line bg-surface-2 p-3">
          <p className="text-xs font-semibold text-muted">{t("howToPay")}</p>
          <p className="mt-1 whitespace-pre-line text-sm" dir="auto">{b.venue.deposit_instructions}</p>
        </div>
      ) : null}
      {pending ? (
        <ActionForm action={reportDepositAction}>
          <Hidden values={{ booking_id: b.id, venue_id: b.venue_id }} />
          <FormField name="reference" label={t("referenceLabel")} hint={t("referenceHint")} required>
            <Input {...controlProps("reference")} maxLength={120} required dir="auto" />
          </FormField>
          <SubmitButton className="self-start">{t("reportButton")}</SubmitButton>
        </ActionForm>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <ConfirmAction
          action={cancelBookingAction}
          values={{ booking_id: b.id, venue_id: b.venue_id }}
          label={t("cancel")}
          title={t("cancelTitle")}
          description={pending ? t("cancelCustomerNote") : t("cancelForfeitNote", { amount: deposit })}
          confirmLabel={t("cancel")}
          reasonName="reason"
          reasonLabel={t("reason")}
        />
        {conversationId ? (
          <LinkButton href={`/messages/${conversationId}`} className={buttonClass("ghost", "sm")}>
            <MessageCircle aria-hidden="true" className="size-4" />
            {t("message")}
          </LinkButton>
        ) : null}
      </div>
      {calendar ? <AddToCalendar links={calendar} /> : null}
    </li>
  );
}

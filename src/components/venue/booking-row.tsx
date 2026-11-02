import { getLocale, getTranslations } from "next-intl/server";
import { MessageCircle } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/domain/money";
import type { DepositStatus } from "@/lib/domain/venue";
import { formatDateTime, formatTime } from "@/lib/format";
import { bookingOutcomeAction, cancelBookingAction, decideBookingAction, markDepositRefundedAction } from "@/server/venues/actions";
import { ActionForm, Hidden, InlineAction, SubmitButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Badge, type Tone } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/link-button";
import { AddToCalendar, type CalendarLinks } from "./add-to-calendar";

export interface BookingRowData {
  id: string;
  venue_id: string;
  kind: "customer" | "manual" | "block";
  status: "requested" | "confirmed" | "rejected" | "cancelled" | "completed" | "no_show" | "expired";
  starts_at: string;
  ends_at: string;
  expires_at: string | null;
  price_total: number;
  currency: string;
  customer_note: string | null;
  customer_name: string | null;
  decision_note: string | null;
  match_id: string | null;
  deposit_amount: number | null;
  deposit_status: DepositStatus | null;
  deposit_reference: string | null;
  field: { name: string } | null;
  venue?: { id: string; name: string; deposit_instructions?: string | null } | null;
  requester?: { display_name: string } | null;
}

const tone: Record<BookingRowData["status"], Tone> = {
  requested: "warning",
  confirmed: "success",
  rejected: "danger",
  cancelled: "neutral",
  completed: "neutral",
  no_show: "danger",
  expired: "neutral",
};

export const depositTone: Record<DepositStatus, Tone> = {
  pending: "warning",
  reported: "info",
  received: "success",
  refund_due: "warning",
  refunded: "neutral",
  forfeited: "neutral",
};

/** A deposit that changed hands, or one still being asked for. Unpaid deposits on closed bookings are noise. */
const showDeposit = (b: BookingRowData) => b.deposit_status != null && (b.deposit_status !== "pending" || b.status === "requested");

export async function BookingRow({
  b,
  mode,
  tz,
  conversationId,
  calendar,
}: {
  b: BookingRowData;
  mode: "customer" | "staff";
  tz: string;
  conversationId?: string;
  /** Offered to the customer while the booking still holds its time. */
  calendar?: CalendarLinks;
}) {
  const t = await getTranslations("bookings");
  const locale = await getLocale();
  const started = new Date(b.starts_at) <= new Date();
  const ended = new Date(b.ends_at) <= new Date();
  const deposit = b.deposit_amount != null ? formatMoney(b.deposit_amount, b.currency, locale) : null;
  const depositSent = b.deposit_status === "reported" || b.deposit_status === "received";
  const cancelNote =
    mode === "customer"
      ? depositSent ? t("cancelForfeitNote", { amount: deposit ?? "" }) : t("cancelCustomerNote")
      : depositSent ? t("cancelStaffRefundNote", { amount: deposit ?? "" }) : t("cancelStaffNote");
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">
          {mode === "customer" && b.venue ? <Link href={`/venues/${b.venue.id}`} className="hover:underline">{b.venue.name}</Link> : null}
          {mode === "staff" ? (b.kind === "block" ? t("blocked") : (b.requester?.display_name ?? b.customer_name ?? t("walkIn"))) : null}
        </span>
        <Badge tone={tone[b.status]}>{t(`status.${b.status}`)}</Badge>
        {showDeposit(b) ? <Badge tone={depositTone[b.deposit_status!]}>{t(`depositStatus.${b.deposit_status}`)}</Badge> : null}
        {b.kind !== "customer" ? <Badge>{t(`kind.${b.kind}`)}</Badge> : null}
        {b.match_id ? (
          <LinkButton href={`/matches/${b.match_id}`}><Badge tone="info">{t("linkedMatch")}</Badge></LinkButton>
        ) : null}
      </div>
      <p className="num text-sm text-muted">
        {b.field?.name} · {formatDateTime(b.starts_at, locale, tz)} – {formatTime(b.ends_at, locale, tz)}
        {b.kind !== "block" ? ` · ${formatMoney(b.price_total, b.currency, locale)}` : null}
        {deposit && showDeposit(b) ? ` · ${t("depositAmount", { amount: deposit })}` : null}
      </p>
      {mode === "staff" && b.status === "requested" && b.deposit_status === "pending" && b.expires_at ? (
        <p className="num text-sm">{t("staffPending", { amount: deposit ?? "", time: formatTime(b.expires_at, locale, tz) })}</p>
      ) : null}
      {mode === "staff" && b.status === "requested" && b.deposit_status === "reported" ? (
        <p className="text-sm font-medium text-accent" dir="auto">{t("staffReported", { reference: b.deposit_reference ?? "" })}</p>
      ) : null}
      {b.customer_note ? <p className="text-sm">{b.customer_note}</p> : null}
      {b.decision_note === "slot_taken" ? <p className="text-sm text-muted">{t("slotTaken")}</p> : null}
      {b.decision_note === "deposit_not_received" ? <p className="text-sm text-muted">{t("depositNotReceivedNote")}</p> : null}
      {b.decision_note && !["slot_taken", "deposit_not_received"].includes(b.decision_note) ? <p className="text-sm text-muted">{b.decision_note}</p> : null}
      {b.status === "expired" && b.deposit_status != null ? <p className="text-sm text-muted">{t("depositExpiredNote")}</p> : null}
      <div className="flex flex-wrap gap-2">
        {mode === "staff" && b.status === "requested" && !started ? (
          <>
            <ActionForm action={decideBookingAction} className="flex-row items-center gap-2">
              <Hidden values={{ booking_id: b.id, venue_id: b.venue_id, approve: "1", deposit: b.deposit_status ? "1" : undefined }} />
              <SubmitButton size="sm">{b.deposit_status ? t("depositReceived") : t("approve")}</SubmitButton>
            </ActionForm>
            <ConfirmAction
              action={decideBookingAction}
              values={{ booking_id: b.id, venue_id: b.venue_id }}
              label={b.deposit_status ? t("depositMissing") : t("reject")}
              title={b.deposit_status ? t("depositMissingTitle") : t("rejectTitle")}
              description={b.deposit_status ? t("depositMissingNote") : undefined}
              confirmLabel={b.deposit_status ? t("depositMissing") : t("reject")}
              reasonName="note"
              reasonLabel={t("rejectReason")}
            />
          </>
        ) : null}
        {mode === "staff" && b.deposit_status === "refund_due" ? (
          <InlineAction action={markDepositRefundedAction} values={{ booking_id: b.id, venue_id: b.venue_id }} label={t("markRefunded")} variant="secondary" />
        ) : null}
        {mode === "staff" && ["confirmed", "completed", "no_show"].includes(b.status) && started && b.kind !== "block" ? (
          <>
            <InlineAction action={bookingOutcomeAction} values={{ booking_id: b.id, venue_id: b.venue_id, status: "completed" }} label={t("markCompleted")} />
            <InlineAction action={bookingOutcomeAction} values={{ booking_id: b.id, venue_id: b.venue_id, status: "no_show" }} label={t("markNoShow")} variant="ghost" />
          </>
        ) : null}
        {["requested", "confirmed"].includes(b.status) && !ended ? (
          <ConfirmAction
            action={cancelBookingAction}
            values={{ booking_id: b.id, venue_id: b.venue_id }}
            label={t("cancel")}
            title={t("cancelTitle")}
            description={cancelNote}
            confirmLabel={t("cancel")}
            reasonName="reason"
            reasonLabel={t("reason")}
          />
        ) : null}
        {conversationId ? (
          <LinkButton href={`/messages/${conversationId}`} className={buttonClass("ghost", "sm")}>
            <MessageCircle aria-hidden="true" className="size-4" />
            {t("message")}
          </LinkButton>
        ) : null}
        {mode === "customer" && (b.status === "completed" || (b.status === "confirmed" && ended)) && b.venue ? (
          <LinkButton href={{ pathname: `/venues/${b.venue.id}/review`, query: { booking: b.id } }} className={buttonClass("outline", "sm")}>{t("review")}</LinkButton>
        ) : null}
      </div>
      {calendar ? <AddToCalendar links={calendar} /> : null}
    </li>
  );
}

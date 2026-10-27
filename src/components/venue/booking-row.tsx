import { getLocale, getTranslations } from "next-intl/server";
import { MessageCircle } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/domain/money";
import { formatDateTime, formatTime } from "@/lib/format";
import { bookingOutcomeAction, cancelBookingAction, decideBookingAction } from "@/server/venues/actions";
import { ActionForm, Hidden, InlineAction, SubmitButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Badge, type Tone } from "@/components/ui/primitives";

export interface BookingRowData {
  id: string;
  venue_id: string;
  kind: "customer" | "manual" | "block";
  status: "requested" | "confirmed" | "rejected" | "cancelled" | "completed" | "no_show" | "expired";
  starts_at: string;
  ends_at: string;
  price_total: number;
  currency: string;
  customer_note: string | null;
  customer_name: string | null;
  decision_note: string | null;
  match_id: string | null;
  field: { name: string } | null;
  venue?: { id: string; name: string } | null;
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

export async function BookingRow({ b, mode, tz, conversationId }: { b: BookingRowData; mode: "customer" | "staff"; tz: string; conversationId?: string }) {
  const t = await getTranslations("bookings");
  const locale = await getLocale();
  const started = new Date(b.starts_at) <= new Date();
  const ended = new Date(b.ends_at) <= new Date();
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">
          {mode === "customer" && b.venue ? <Link href={`/venues/${b.venue.id}`} className="hover:underline">{b.venue.name}</Link> : null}
          {mode === "staff" ? (b.kind === "block" ? t("blocked") : (b.requester?.display_name ?? b.customer_name ?? t("walkIn"))) : null}
        </span>
        <Badge tone={tone[b.status]}>{t(`status.${b.status}`)}</Badge>
        {b.kind !== "customer" ? <Badge>{t(`kind.${b.kind}`)}</Badge> : null}
        {b.match_id ? (
          <Link href={`/matches/${b.match_id}`}><Badge tone="info">{t("linkedMatch")}</Badge></Link>
        ) : null}
      </div>
      <p className="num text-sm text-muted">
        {b.field?.name} · {formatDateTime(b.starts_at, locale, tz)} – {formatTime(b.ends_at, locale, tz)}
        {b.kind !== "block" ? ` · ${formatMoney(b.price_total, b.currency, locale)}` : null}
      </p>
      {b.customer_note ? <p className="text-sm">{b.customer_note}</p> : null}
      {b.decision_note && b.decision_note !== "slot_taken" ? <p className="text-sm text-muted">{b.decision_note}</p> : null}
      {b.decision_note === "slot_taken" ? <p className="text-sm text-muted">{t("slotTaken")}</p> : null}
      <div className="flex flex-wrap gap-2">
        {mode === "staff" && b.status === "requested" && !started ? (
          <>
            <ActionForm action={decideBookingAction} className="flex-row items-center gap-2">
              <Hidden values={{ booking_id: b.id, venue_id: b.venue_id, approve: "1" }} />
              <SubmitButton size="sm">{t("approve")}</SubmitButton>
            </ActionForm>
            <ConfirmAction
              action={decideBookingAction}
              values={{ booking_id: b.id, venue_id: b.venue_id }}
              label={t("reject")}
              title={t("rejectTitle")}
              confirmLabel={t("reject")}
              reasonName="note"
              reasonLabel={t("rejectReason")}
            />
          </>
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
            description={mode === "customer" ? t("cancelCustomerNote") : t("cancelStaffNote")}
            confirmLabel={t("cancel")}
            reasonName="reason"
            reasonLabel={t("reason")}
          />
        ) : null}
        {conversationId ? (
          <Link href={`/messages/${conversationId}`} className={buttonClass("ghost", "sm")}>
            <MessageCircle aria-hidden="true" className="size-4" />
            {t("message")}
          </Link>
        ) : null}
        {mode === "customer" && (b.status === "completed" || (b.status === "confirmed" && ended)) && b.venue ? (
          <Link href={{ pathname: `/venues/${b.venue.id}/review`, query: { booking: b.id } }} className={buttonClass("outline", "sm")}>{t("review")}</Link>
        ) : null}
      </div>
    </li>
  );
}

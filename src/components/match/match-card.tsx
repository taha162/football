import { CalendarClock, MapPin, ShieldCheck, Users } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { availability, openSlots } from "@/lib/domain/match";
import { formatMoney } from "@/lib/domain/money";
import { formatDateTime } from "@/lib/format";
import { localizedName } from "@/server/reference";
import type { MatchCardData } from "@/server/matches/queries";
import { Badge, type Tone } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

const availabilityTone: Record<ReturnType<typeof availability>, Tone> = {
  available: "accent",
  almost_full: "warning",
  full: "danger",
  closed: "neutral",
};

export async function MatchCard({ match, role }: { match: MatchCardData; role?: string }) {
  const t = await getTranslations("match");
  const locale = await getLocale();
  const tz = match.city?.timezone ?? "Asia/Baghdad";
  const slots = openSlots(match);
  const state = availability(match);
  const capacity = match.total_players - match.reserved_spots;
  const filled = Math.min(capacity, match.confirmed_count);
  const place = match.venue?.name ?? localizedName(match.area, locale) ?? localizedName(match.city, locale);

  return (
    <article className="reveal card-hover spotlight group relative flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-line-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{match.format}</Badge>
            {match.skill_level ? <Badge tone="info">{t(`skill.${match.skill_level}`)}</Badge> : null}
            {match.match_type === "team_vs_team" ? <Badge tone="info">{t("type.team_vs_team")}</Badge> : null}
            {role ? <Badge tone="accent">{t(`role.${role}`)}</Badge> : null}
          </div>
          <h3 className="truncate font-display text-lg font-semibold">
            <Link href={`/matches/${match.id}`} className="after:absolute after:inset-0 after:rounded-[var(--radius-card)] focus-visible:outline-none">
              {match.title}
            </Link>
          </h3>
        </div>
        <Badge tone={availabilityTone[state]}>
          {state === "closed" ? t(`status.${match.status}`) : state === "full" ? t("full") : t("slotsLeft", { count: slots })}
        </Badge>
      </div>

      <ul className="flex flex-col gap-1.5 text-sm text-muted">
        <li className="flex items-center gap-2">
          <CalendarClock aria-hidden="true" className="size-4 shrink-0 text-faint" />
          <time dateTime={match.starts_at}>{formatDateTime(match.starts_at, locale, tz)}</time>
        </li>
        {place ? (
          <li className="flex items-center gap-2">
            <MapPin aria-hidden="true" className="size-4 shrink-0 text-faint" />
            <span className="truncate">{place}</span>
          </li>
        ) : null}
        <li className="flex items-center gap-2">
          {match.booking_status === "confirmed" ? (
            <>
              <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-success" />
              <span className="text-success">{t("booking.confirmed")}</span>
            </>
          ) : (
            <>
              <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-faint" />
              <span>{t(`booking.${match.booking_status}`)}</span>
            </>
          )}
        </li>
      </ul>

      <div className="mt-auto flex items-end justify-between gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Users aria-hidden="true" className="size-3.5" />
            <span className="num">{t("players", { filled: filled + match.reserved_spots, total: match.total_players })}</span>
            {match.waitlist_count > 0 ? <span className="num">· {t("waitlistCount", { count: match.waitlist_count })}</span> : null}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
            <div
              className={cn("h-full rounded-full", state === "full" ? "bg-danger" : state === "almost_full" ? "bg-warning" : "bg-accent")}
              style={{ width: `${Math.round(((filled + match.reserved_spots) / match.total_players) * 100)}%` }}
            />
          </div>
        </div>
        <p className="num shrink-0 text-end">
          {match.price_per_player > 0 ? (
            <>
              <span className="block font-display text-lg font-bold">{formatMoney(match.price_per_player, match.currency, locale)}</span>
              <span className="text-xs text-muted">{match.cost_is_estimate ? t("perPlayerEstimate") : t("perPlayer")}</span>
            </>
          ) : (
            <span className="font-display text-lg font-bold text-accent">{t("free")}</span>
          )}
        </p>
      </div>
    </article>
  );
}

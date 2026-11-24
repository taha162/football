import type { Metadata } from "next";
import { BellOff, CalendarDays, Lock, MapPin, MessageCircle, Pin, Swords, Trophy, Users, UsersRound, type LucideIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { badgeCount, formatDateTime, formatListTime } from "@/lib/format";
import { publicStorageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { ConversationListLive } from "@/components/messages/list-live";
import { ConversationRow } from "@/components/messages/conversation-row";
import { Avatar } from "@/components/ui/avatar";
import { Container, EmptyState, PageHeader } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";

// Group conversations: what they belong to, in place of a face.
const KIND_ICONS: Record<string, LucideIcon> = { match: CalendarDays, team: Users, booking: MapPin, challenge: Swords, tournament: Trophy, group: UsersRound };

// The list's filters, as in a messaging app. «المجموعات»: every conversation with more than two people.
const FILTERS = ["all", "unread", "favorites", "groups"] as const;
type Filter = (typeof FILTERS)[number];

export async function generateMetadata({ params }: PageProps<"/[locale]/messages">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "messages" });
  return { title: t("title") };
}

export default async function MessagesPage({ params, searchParams }: PageProps<"/[locale]/messages">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, "/messages");
  const t = await getTranslations("messages");
  const wanted = (await searchParams).filter;
  const filter: Filter = FILTERS.includes(wanted as Filter) ? (wanted as Filter) : "all";
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_conversations", { p_limit: 100 });
  // The member's own settings (pinned, muted, favourite, nickname) come with each row (migration 0040);
  // before that update they are simply absent.
  const all = (data ?? []).map((c) => {
    const own = c as { pinned?: boolean | null; muted?: boolean | null; favorite?: boolean | null; nickname?: string | null };
    return { ...c, pinned: Boolean(own.pinned), muted: Boolean(own.muted), favorite: Boolean(own.favorite), nickname: own.nickname ?? null };
  });
  const rows = all.filter((c) =>
    filter === "unread" ? Number(c.unread_count) > 0 : filter === "favorites" ? c.favorite : filter === "groups" ? c.kind !== "direct" : true,
  );
  // One-to-one conversations show the other person's picture: one request for the whole list.
  const direct = rows.filter((c) => c.kind === "direct").map((c) => c.conversation_id);
  // And groups their photo (migration 0048; before it runs the request fails and none shows). Both at once.
  const groupIds = rows.filter((c) => c.kind === "group").map((c) => c.conversation_id);
  const [{ data: others }, { data: groupRows }] = await Promise.all([
    direct.length
      ? supabase.from("conversation_members").select("conversation_id, profile:profiles(avatar_path)").in("conversation_id", direct).neq("user_id", user.id)
      : Promise.resolve({ data: [] }),
    groupIds.length ? supabase.from("conversations").select("id, photo_path").in("id", groupIds) : Promise.resolve({ data: [] }),
  ]);
  const faces = new Map((others ?? []).map((m) => [m.conversation_id, publicStorageUrl("avatars", m.profile?.avatar_path)]));
  for (const g of groupRows ?? []) {
    const photo = publicStorageUrl("group-photos", g.photo_path);
    if (photo) faces.set(g.id, photo);
  }
  const now = new Date();
  // A message with no text says what it carried. (last_kind is absent on a
  // database without the location/voice/calls update: an empty text is a picture.)
  const preview = (c: (typeof rows)[number]) => {
    const kind = (c as { last_kind?: string | null }).last_kind;
    if (kind === "location") return `📍 ${t("location")}`;
    if (kind === "voice") return `🎤 ${t("voice")}`;
    if (kind === "video") return `🎥 ${c.last_message || t("video")}`;
    if (kind === "call") return `📞 ${t("call")}`;
    // A deleted (or moderated) message keeps only this placeholder text.
    if (c.last_message === "[deleted]" || c.last_message === "[removed]") return t("deleted");
    if (c.last_message === "") return `📷 ${t("photo")}`;
    return c.last_message ?? t("noMessages");
  };
  const emptyTitle = filter === "unread" ? t("emptyUnread") : filter === "favorites" ? t("emptyFavorites") : filter === "groups" ? t("emptyGroups") : t("empty");
  return (
    <Container className="max-w-3xl py-10">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          // Groups of friends (migration 0044).
          <LinkButton href="/messages/groups/new" className={buttonClass("secondary", "sm")}>
            <UsersRound aria-hidden="true" className="size-4" />
            {t("newGroup")}
          </LinkButton>
        }
      />
      <ConversationListLive userId={user.id} conversationIds={all.map((c) => c.conversation_id)} />
      {all.length > 0 ? (
        <nav aria-label={t("filters")} className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {FILTERS.map((f) => (
            <LinkButton
              key={f}
              href={f === "all" ? "/messages" : { pathname: "/messages", query: { filter: f } }}
              aria-current={f === filter ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                f === filter ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted hover:text-ink",
              )}
            >
              {t(`filter.${f}`)}
            </LinkButton>
          ))}
        </nav>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon={<MessageCircle className="size-10" />} title={emptyTitle}>{filter === "all" ? t("emptyBody") : null}</EmptyState>
      ) : (
        // As in a messaging app: the face, the name and when on one line, the last message and the unread count under them.
        // A long press (a right click, or «⌄» on a computer) opens the conversation's menu.
        <ul className="-mx-4 flex flex-col border-t border-line sm:mx-0 sm:overflow-hidden sm:border sm:rounded-[var(--radius-card)] sm:bg-surface">
          {rows.map((c) => {
            const unread = Number(c.unread_count) > 0;
            const title = c.nickname ?? c.title ?? t("untitled");
            const Icon = KIND_ICONS[c.kind] ?? MessageCircle;
            return (
              <ConversationRow
                key={c.conversation_id}
                conversationId={c.conversation_id}
                name={title}
                pinned={c.pinned}
                muted={c.muted}
                favorite={c.favorite}
                nickname={c.nickname}
              >
                <LinkButton href={`/messages/${c.conversation_id}`} className="ripple flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
                  {c.kind === "direct" || faces.has(c.conversation_id) ? (
                    <Avatar src={faces.get(c.conversation_id) ?? null} name={title} size={48} />
                  ) : (
                    <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-surface-3 text-muted">
                      <Icon className="size-5" />
                    </span>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate font-semibold">{title}</span>
                      {c.last_message_at ? (
                        <time
                          className={cn("num shrink-0 text-xs", unread ? "font-semibold text-accent" : "text-faint")}
                          dateTime={c.last_message_at}
                          title={formatDateTime(c.last_message_at, locale, "Asia/Baghdad")}
                        >
                          {formatListTime(c.last_message_at, locale, "Asia/Baghdad", t("yesterday"), now)}
                        </time>
                      ) : null}
                    </span>
                    <span className="flex items-center gap-2">
                      {/* What it belongs to (a match, a team…), for group conversations; one-to-one needs no word. */}
                      {c.kind !== "direct" ? <span className="shrink-0 text-xs font-medium text-accent">{t(`kind.${c.kind}`)}</span> : null}
                      <span className={cn("min-w-0 flex-1 truncate text-sm", unread ? "text-ink" : "text-muted")} dir="auto">{preview(c)}</span>
                      {c.is_locked ? (
                        <span className="flex shrink-0 items-center gap-1 text-xs text-warning" title={t("locked")}>
                          <Lock aria-hidden="true" className="size-3.5" />
                          <span className="sr-only">{t("locked")}</span>
                        </span>
                      ) : null}
                      {c.muted ? (
                        <span className="shrink-0 text-faint" title={t("muted")}>
                          <BellOff aria-hidden="true" className="size-3.5" />
                          <span className="sr-only">{t("muted")}</span>
                        </span>
                      ) : null}
                      {c.pinned ? (
                        <span className="shrink-0 text-faint" title={t("pinned")}>
                          <Pin aria-hidden="true" className="size-3.5" />
                          <span className="sr-only">{t("pinned")}</span>
                        </span>
                      ) : null}
                      {unread ? (
                        // Grey when muted: still unread, but not calling for attention.
                        <span
                          className={cn(
                            "num grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[11px] font-bold",
                            c.muted ? "bg-surface-3 text-muted" : "bg-accent text-accent-ink",
                          )}
                          aria-label={t("unread", { count: badgeCount(Number(c.unread_count)) })}
                        >
                          {badgeCount(Number(c.unread_count))}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </LinkButton>
              </ConversationRow>
            );
          })}
        </ul>
      )}
    </Container>
  );
}

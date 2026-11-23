import type { Metadata } from "next";
import { CalendarDays, Lock, MapPin, MessageCircle, Swords, Trophy, Users, type LucideIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { badgeCount, formatDateTime, formatListTime } from "@/lib/format";
import { publicStorageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { ConversationListLive } from "@/components/messages/list-live";
import { Avatar } from "@/components/ui/avatar";
import { Container, EmptyState, PageHeader } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/link-button";

// Group conversations: what they belong to, in place of a face.
const KIND_ICONS: Record<string, LucideIcon> = { match: CalendarDays, team: Users, booking: MapPin, challenge: Swords, tournament: Trophy };

export async function generateMetadata({ params }: PageProps<"/[locale]/messages">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "messages" });
  return { title: t("title") };
}

export default async function MessagesPage({ params }: PageProps<"/[locale]/messages">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, "/messages");
  const t = await getTranslations("messages");
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_conversations", { p_limit: 100 });
  const rows = data ?? [];
  // One-to-one conversations show the other person's picture: one request for the whole list.
  const direct = rows.filter((c) => c.kind === "direct").map((c) => c.conversation_id);
  const { data: others } = direct.length
    ? await supabase.from("conversation_members").select("conversation_id, profile:profiles(avatar_path)").in("conversation_id", direct).neq("user_id", user.id)
    : { data: [] };
  const faces = new Map((others ?? []).map((m) => [m.conversation_id, publicStorageUrl("avatars", m.profile?.avatar_path)]));
  const now = new Date();
  // A message with no text says what it carried. (last_kind is absent on a
  // database without the location/voice/calls update: an empty text is a picture.)
  const preview = (c: (typeof rows)[number]) => {
    const kind = (c as { last_kind?: string | null }).last_kind;
    if (kind === "location") return `📍 ${t("location")}`;
    if (kind === "voice") return `🎤 ${t("voice")}`;
    if (kind === "call") return `📞 ${t("call")}`;
    // A deleted (or moderated) message keeps only this placeholder text.
    if (c.last_message === "[deleted]" || c.last_message === "[removed]") return t("deleted");
    if (c.last_message === "") return `📷 ${t("photo")}`;
    return c.last_message ?? t("noMessages");
  };
  return (
    <Container className="max-w-3xl py-10">
      <PageHeader title={t("title")} description={t("description")} />
      <ConversationListLive userId={user.id} conversationIds={rows.map((c) => c.conversation_id)} />
      {rows.length === 0 ? (
        <EmptyState icon={<MessageCircle className="size-10" />} title={t("empty")}>{t("emptyBody")}</EmptyState>
      ) : (
        // As in a messaging app: the face, the name and when on one line, the last message and the unread count under them.
        <ul className="-mx-4 flex flex-col border-t border-line sm:mx-0 sm:overflow-hidden sm:border sm:rounded-[var(--radius-card)] sm:bg-surface">
          {rows.map((c) => {
            const unread = Number(c.unread_count) > 0;
            const title = c.title ?? t("untitled");
            const Icon = KIND_ICONS[c.kind] ?? MessageCircle;
            return (
              <li key={c.conversation_id} className="border-b border-line last:border-b-0">
                <LinkButton href={`/messages/${c.conversation_id}`} className="ripple flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
                  {c.kind === "direct" ? (
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
                      {unread ? (
                        <span
                          className="num grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-ink"
                          aria-label={t("unread", { count: badgeCount(Number(c.unread_count)) })}
                        >
                          {badgeCount(Number(c.unread_count))}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </LinkButton>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}

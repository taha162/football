import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/auth";
import { publicStorageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { CallButton } from "@/components/calls/call-button";
import type { CallPeer } from "@/components/calls/call-provider";
import { ArrowLeft, ExternalLink, MessageCircle } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { ChatScreen } from "@/components/messages/chat-screen";
import { Thread, type ThreadMessage } from "@/components/messages/thread";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";

const PAGE = 100;

export default async function ConversationPage({ params, searchParams }: PageProps<"/[locale]/messages/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, `/messages/${id}`);
  const t = await getTranslations("messages");
  const supabase = await createClient();
  // RLS: returns nothing unless the caller currently belongs to the conversation.
  const { data: conv } = await supabase.from("conversations").select("*").eq("id", id).maybeSingle();
  if (!conv) notFound();
  const before = Number((await searchParams).before);
  // Every column: members see the whole message, and a database without the
  // newest columns still loads (they are simply absent).
  let q = supabase.from("messages").select("*").eq("conversation_id", id).order("id", { ascending: false }).limit(PAGE + 1);
  if (Number.isSafeInteger(before) && before > 0) q = q.lt("id", before);
  const { data: rows } = await q;
  const hasOlder = (rows ?? []).length > PAGE;
  const page = (rows ?? []).slice(0, PAGE).reverse();
  // Pictures and voice notes are private: signed links valid for an hour, made with the member's own session.
  const sign = async (bucket: string, paths: string[]) => {
    if (!paths.length) return new Map<string, string>();
    const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, 3600);
    return new Map((data ?? []).flatMap((s) => (s.path && s.signedUrl ? [[s.path, s.signedUrl] as const] : [])));
  };
  const live = page.filter((m) => !m.deleted_at);
  const [imageUrls, voiceUrls] = await Promise.all([
    sign("message-images", live.flatMap((m) => (m.image_path ? [m.image_path] : []))),
    sign("message-voice", live.flatMap((m) => (m.voice_path ? [m.voice_path] : []))),
  ]);
  const messages: ThreadMessage[] = page.map((m) => ({
    ...m,
    image_url: m.image_path ? (imageUrls.get(m.image_path) ?? null) : null,
    voice_url: m.voice_path ? (voiceUrls.get(m.voice_path) ?? null) : null,
  }));
  const senderIds = [...new Set(messages.map((m) => m.sender_id).filter(Boolean))] as string[];
  const { data: profiles } = senderIds.length ? await supabase.from("profiles").select("id, display_name").in("id", senderIds) : { data: [] };
  const names = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.display_name]));

  const { data: list } = await supabase.rpc("my_conversations", { p_limit: 200 });
  const meta = (list ?? []).find((c) => c.conversation_id === conv.id);
  let title = meta?.title ?? t(`kind.${conv.kind}`);
  let link: string | null = null;
  if (conv.match_id) link = `/matches/${conv.match_id}`;
  else if (conv.team_id) link = `/teams/${conv.team_id}`;
  else if (conv.booking_id) link = "/my/bookings";
  else if (conv.tournament_id) link = `/tournaments/${conv.tournament_id}`;
  else if (conv.challenge_id) link = "/opponents";
  // A direct conversation: the other person, for the title and the call button.
  let peer: CallPeer | null = null;
  // And when they last read it, for «شوهدت» (their read time reaches members of a direct conversation, 0033).
  let seenAt: string | null = null;
  if (conv.kind === "direct") {
    const [{ data: members }, { data: read }] = await Promise.all([
      supabase.from("conversation_members").select("user_id, profile:profiles(display_name, avatar_path)").eq("conversation_id", id).neq("user_id", user.id),
      supabase.from("conversation_reads").select("last_read_at").eq("conversation_id", id).neq("user_id", user.id).maybeSingle(),
    ]);
    seenAt = read?.last_read_at ?? null;
    const other = members?.[0];
    if (!meta?.title) title = other?.profile?.display_name ?? title;
    if (other) peer = { id: other.user_id, name: other.profile?.display_name ?? title, avatarUrl: publicStorageUrl("avatars", other.profile?.avatar_path) };
  }

  // Round, quiet buttons for the bar: back, call, open.
  const barButton = "ripple flex size-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface-2";
  const heading = (
    <span className="flex min-w-0 flex-col">
      <h1 className="truncate text-base font-semibold leading-tight">{title}</h1>
      <span className="truncate text-xs text-muted">{t(`kind.${conv.kind}`)}</span>
    </span>
  );
  return (
    // Its own screen: the site's header and bottom bar step aside (lib/chat-path.ts).
    <ChatScreen>
      <header className="chat-bar shrink-0 border-b border-line bg-bg/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center gap-1.5 px-2 sm:px-4">
          {/* Back to all conversations. The page is right to left: back points right. */}
          <LinkButton href="/messages" aria-label={t("back")} title={t("back")} className={barButton}>
            <ArrowLeft aria-hidden="true" className="size-5 rtl:-scale-x-100" />
          </LinkButton>
          {peer ? (
            // Who it is with: their page (where «اتصال» and «مراسلة» are too).
            <Link href={`/players/${peer.id}`} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1 pe-2">
              <Avatar src={peer.avatarUrl} name={peer.name} size={40} />
              {heading}
            </Link>
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-2.5 py-1">
              <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-3 text-muted">
                <MessageCircle className="size-5" />
              </span>
              {heading}
            </span>
          )}
          {peer && !conv.is_locked ? <CallButton conversationId={id} peer={peer} compact /> : null}
          {link ? (
            <LinkButton href={link} aria-label={t("open")} title={t("open")} className={barButton}>
              <ExternalLink aria-hidden="true" className="size-5" />
            </LinkButton>
          ) : null}
        </div>
      </header>
      <Thread
        conversationId={id}
        me={user.id}
        names={names}
        initial={messages}
        locked={conv.is_locked}
        timeZone="Asia/Baghdad"
        direct={conv.kind === "direct"}
        seenAt={seenAt}
        top={
          <>
            <p className="mx-auto mb-3 max-w-sm rounded-xl bg-surface-2/70 px-3 py-2 text-center text-[11px] leading-relaxed text-muted">{t("safetyNote")}</p>
            {hasOlder ? (
              <LinkButton href={{ pathname: `/messages/${id}`, query: { before: String(messages[0]?.id) } }} className={buttonClass("ghost", "sm", "mx-auto mb-2")}>
                {t("older")}
              </LinkButton>
            ) : null}
          </>
        }
      />
    </ChatScreen>
  );
}

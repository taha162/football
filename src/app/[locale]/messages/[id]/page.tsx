import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/auth";
import { thumbPathOf } from "@/lib/message-thumb";
import { MESSAGE_VIDEOS, posterPathOf } from "@/lib/message-video";
import { publicStorageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { CallButton } from "@/components/calls/call-button";
import type { CallPeer } from "@/components/calls/call-provider";
import { ArrowLeft, ExternalLink, MessageCircle, UsersRound } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { ActiveStatus } from "@/components/messages/active-status";
import { ChatScreen } from "@/components/messages/chat-screen";
import { Thread, type ThreadMessage } from "@/components/messages/thread";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";

const PAGE = 100;

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Conversation = { kind: string; match_id: string | null; team_id: string | null; booking_id: string | null; tournament_id: string | null; challenge_id: string | null };
type GroupMember = { user_id: string; profile: { display_name: string } | null };

/**
 * A group conversation's name: the match, team, tournament, venue of the booking,
 * or the two teams of a challenge. One small request for this conversation only
 * (the page used to load the member's whole list of conversations for it).
 * One-to-one conversations are named after the other person (below).
 */
async function conversationTitle(supabase: Supabase, c: Conversation): Promise<string | null> {
  if (c.match_id) return (await supabase.from("matches").select("title").eq("id", c.match_id).maybeSingle()).data?.title ?? null;
  if (c.team_id) return (await supabase.from("teams").select("name").eq("id", c.team_id).maybeSingle()).data?.name ?? null;
  if (c.tournament_id) return (await supabase.from("tournaments").select("name").eq("id", c.tournament_id).maybeSingle()).data?.name ?? null;
  if (c.booking_id) {
    const { data } = await supabase.from("bookings").select("venue:venues!bookings_venue_id_fkey(name)").eq("id", c.booking_id).maybeSingle();
    return (data?.venue as { name: string } | null)?.name ?? null;
  }
  if (c.challenge_id) {
    const { data } = await supabase
      .from("opponent_challenges")
      .select("challenger:teams!opponent_challenges_challenger_team_id_fkey(name), target:teams!opponent_challenges_target_team_id_fkey(name)")
      .eq("id", c.challenge_id)
      .maybeSingle();
    const a = (data?.challenger as { name: string } | null)?.name;
    const b = (data?.target as { name: string } | null)?.name;
    return a && b ? `${a} – ${b}` : null;
  }
  return null;
}

export default async function ConversationPage({ params, searchParams }: PageProps<"/[locale]/messages/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, `/messages/${id}`);
  const t = await getTranslations("messages");
  const supabase = await createClient();
  // RLS: returns nothing unless the caller currently belongs to the conversation.
  // With it, the member's own settings: a nickname, and when they deleted it for themselves (migration 0040;
  // before that update the second request fails and changes nothing).
  const [{ data: conv }, { data: pref }] = await Promise.all([
    supabase.from("conversations").select("*").eq("id", id).maybeSingle(),
    supabase.from("conversation_prefs").select("nickname, cleared_at").eq("conversation_id", id).eq("user_id", user.id).maybeSingle(),
  ]);
  if (!conv) notFound();
  const before = Number((await searchParams).before);
  // Every column: members see the whole message, and a database without the
  // newest columns still loads (they are simply absent).
  let q = supabase.from("messages").select("*").eq("conversation_id", id).order("id", { ascending: false }).limit(PAGE + 1);
  if (Number.isSafeInteger(before) && before > 0) q = q.lt("id", before);
  // Deleted for themselves: what came before stays hidden from them.
  if (pref?.cleared_at) q = q.gt("created_at", pref.cleared_at);
  // A group (migration 0044): its members, for their names and how many they are; with the messages.
  const isGroup = conv.kind === "group";
  const [{ data: rows }, { data: groupRows }] = await Promise.all([
    q,
    isGroup
      ? supabase.from("conversation_members").select("user_id, profile:profiles(display_name)").eq("conversation_id", id)
      : Promise.resolve({ data: null }),
  ]);
  const groupMembers = (groupRows ?? []) as unknown as GroupMember[];
  const hasOlder = (rows ?? []).length > PAGE;
  const page = (rows ?? []).slice(0, PAGE).reverse();
  // Pictures and voice notes are private: signed links valid for an hour, made with the member's own session.
  const sign = async (bucket: string, paths: string[]) => {
    if (!paths.length) return new Map<string, string>();
    const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, 3600);
    return new Map((data ?? []).flatMap((s) => (s.path && s.signedUrl ? [[s.path, s.signedUrl] as const] : [])));
  };
  const live = page.filter((m) => !m.deleted_at);
  // Pictures with their small copies (shown in the conversation; older pictures have none) in one request.
  const pictures = live.flatMap((m) => (m.image_path ? [m.image_path, thumbPathOf(m.image_path)] : []));
  // Videos with their stills (a video sent from a browser that couldn't make one has none).
  const videos = live.flatMap((m) => (m.video_path ? [m.video_path, posterPathOf(m.video_path)] : []));
  const [imageUrls, voiceUrls, videoUrls] = await Promise.all([
    sign("message-images", pictures),
    sign("message-voice", live.flatMap((m) => (m.voice_path ? [m.voice_path] : []))),
    sign(MESSAGE_VIDEOS, videos),
  ]);
  const messages: ThreadMessage[] = page.map((m) => ({
    ...m,
    image_url: m.image_path ? (imageUrls.get(m.image_path) ?? null) : null,
    image_thumb_url: m.image_path ? (imageUrls.get(thumbPathOf(m.image_path)) ?? null) : null,
    voice_url: m.voice_path ? (voiceUrls.get(m.voice_path) ?? null) : null,
    video_url: m.video_path ? (videoUrls.get(m.video_path) ?? null) : null,
    video_poster_url: m.video_path ? (videoUrls.get(posterPathOf(m.video_path)) ?? null) : null,
  }));
  // Names beside messages: a group's members are known already; others (and those who left) are looked up.
  const memberNames = Object.fromEntries(groupMembers.flatMap((x) => (x.profile ? [[x.user_id, x.profile.display_name] as const] : [])));
  const senderIds = [...new Set(messages.map((m) => m.sender_id).filter(Boolean))].filter((s) => !(s! in memberNames)) as string[];
  const { data: profiles } = senderIds.length ? await supabase.from("profiles").select("id, display_name").in("id", senderIds) : { data: [] };
  const names = { ...memberNames, ...Object.fromEntries((profiles ?? []).map((p) => [p.id, p.display_name])) };

  const groupTitle = isGroup ? ((conv as { title?: string | null }).title ?? null) : null;
  const groupPhoto = isGroup ? publicStorageUrl("group-photos", (conv as { photo_path?: string | null }).photo_path) : null;
  let title = (conv.kind === "direct" ? null : isGroup ? groupTitle : await conversationTitle(supabase, conv)) ?? t(`kind.${conv.kind}`);
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
  let peerSeen: string | null = null;
  // The clock it was read by: the status's first render in the browser uses it too.
  const seenRead = new Date().getTime();
  if (conv.kind === "direct") {
    const [{ data: members }, { data: read }, { data: active }] = await Promise.all([
      supabase.from("conversation_members").select("user_id, profile:profiles(display_name, avatar_path)").eq("conversation_id", id).neq("user_id", user.id),
      supabase.from("conversation_reads").select("last_read_at").eq("conversation_id", id).neq("user_id", user.id).maybeSingle(),
      // When they were last active, for «نشط الآن» (migration 0049; unknown before it, or when they hide it).
      supabase.rpc("last_seen_in", { p_conversation_ids: [id] }),
    ]);
    seenAt = read?.last_read_at ?? null;
    peerSeen = (active ?? [])[0]?.last_seen_at ?? null;
    const other = members?.[0];
    title = other?.profile?.display_name ?? title;
    if (other) peer = { id: other.user_id, name: other.profile?.display_name ?? title, avatarUrl: publicStorageUrl("avatars", other.profile?.avatar_path) };
  }
  // The member's own name for it, shown to them only.
  if (pref?.nickname) title = pref.nickname;

  // Round, quiet buttons for the bar: back, call, open.
  const barButton = "ripple flex size-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface-2";
  const heading = (
    <span className="flex min-w-0 flex-col">
      <h1 className="truncate text-base font-semibold leading-tight">{title}</h1>
      <span className="truncate text-xs text-muted">
        {isGroup ? (
          t("membersCount", { count: groupMembers.length })
        ) : peer ? (
          <ActiveStatus userId={peer.id} initial={peerSeen} at={seenRead} fallback={t(`kind.${conv.kind}`)} />
        ) : (
          t(`kind.${conv.kind}`)
        )}
      </span>
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
          ) : isGroup ? (
            // The group's page: members, admins, adding and leaving.
            <Link href={`/messages/${id}/group`} aria-label={`${title} — ${t("groupInfo")}`} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1 pe-2">
              {groupPhoto ? (
                <Avatar src={groupPhoto} name={title} size={40} />
              ) : (
                <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-3 text-muted">
                  <UsersRound className="size-5" />
                </span>
              )}
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

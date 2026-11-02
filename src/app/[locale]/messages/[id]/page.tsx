import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/auth";
import { publicStorageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { CallButton } from "@/components/calls/call-button";
import type { CallPeer } from "@/components/calls/call-provider";
import { Thread, type ThreadMessage } from "@/components/messages/thread";
import { Badge, Container, PageHeader } from "@/components/ui/primitives";
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
  if (conv.kind === "direct") {
    const { data: members } = await supabase.from("conversation_members").select("user_id, profile:profiles(display_name, avatar_path)").eq("conversation_id", id).neq("user_id", user.id);
    const other = members?.[0];
    if (!meta?.title) title = other?.profile?.display_name ?? title;
    if (other) peer = { id: other.user_id, name: other.profile?.display_name ?? title, avatarUrl: publicStorageUrl("avatars", other.profile?.avatar_path) };
  }

  return (
    <Container className="max-w-3xl py-8">
      <PageHeader
        title={title}
        eyebrow={<Badge>{t(`kind.${conv.kind}`)}</Badge>}
        actions={
          <>
            {peer && !conv.is_locked ? <CallButton conversationId={id} peer={peer} /> : null}
            <LinkButton href="/messages" className={buttonClass("ghost", "sm")}>{t("all")}</LinkButton>
            {link ? <LinkButton href={link} className={buttonClass("outline", "sm")}>{t("open")}</LinkButton> : null}
          </>
        }
      />
      {hasOlder ? (
        <LinkButton href={{ pathname: `/messages/${id}`, query: { before: String(messages[0]?.id) } }} className={buttonClass("ghost", "sm", "mb-3")}>
          {t("older")}
        </LinkButton>
      ) : null}
      <Thread conversationId={id} me={user.id} names={names} initial={messages} locked={conv.is_locked} timeZone="Asia/Baghdad" />
      <p className="mt-4 text-xs text-muted">{t("safetyNote")}</p>
    </Container>
  );
}

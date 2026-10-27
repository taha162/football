import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Thread, type ThreadMessage } from "@/components/messages/thread";
import { Badge, Container, PageHeader } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/button";

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
  let q = supabase.from("messages").select("id, sender_id, body, created_at, deleted_at").eq("conversation_id", id).order("id", { ascending: false }).limit(PAGE + 1);
  if (Number.isSafeInteger(before) && before > 0) q = q.lt("id", before);
  const { data: rows } = await q;
  const hasOlder = (rows ?? []).length > PAGE;
  const messages = ((rows ?? []).slice(0, PAGE) as ThreadMessage[]).reverse();
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
  if (conv.kind === "direct" && !meta?.title) {
    const { data: members } = await supabase.from("conversation_members").select("user_id, profile:profiles(display_name)").eq("conversation_id", id).neq("user_id", user.id);
    title = members?.[0]?.profile?.display_name ?? title;
  }

  return (
    <Container className="max-w-3xl py-8">
      <PageHeader
        title={title}
        eyebrow={<Badge>{t(`kind.${conv.kind}`)}</Badge>}
        actions={
          <>
            <Link href="/messages" className={buttonClass("ghost", "sm")}>{t("all")}</Link>
            {link ? <Link href={link} className={buttonClass("outline", "sm")}>{t("open")}</Link> : null}
          </>
        }
      />
      {hasOlder ? (
        <Link href={{ pathname: `/messages/${id}`, query: { before: String(messages[0]?.id) } }} className={buttonClass("ghost", "sm", "mb-3")}>
          {t("older")}
        </Link>
      ) : null}
      <Thread conversationId={id} me={user.id} names={names} initial={messages} locked={conv.is_locked} timeZone="Asia/Baghdad" />
      <p className="mt-4 text-xs text-muted">{t("safetyNote")}</p>
    </Container>
  );
}

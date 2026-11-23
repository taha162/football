import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth";
import { selectProfile } from "@/lib/profile-columns";
import { publicStorageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { CallButton } from "@/components/calls/call-button";
import { blockUserAction } from "@/server/profile";
import { startDirectConversationAction } from "@/server/messages";
import { PlayerSummary } from "@/components/player/player-summary";
import { FriendActions, type FriendRelation } from "@/components/friends/friend-actions";
import { ReportButton } from "@/components/report-button";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Container } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/link-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/players/[id]">): Promise<Metadata> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("display_name").eq("id", (await params).id).maybeSingle();
  return { title: data?.display_name ?? "—" };
}

export default async function PlayerPage({ params }: PageProps<"/[locale]/players/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const [profile, viewer] = await Promise.all([selectProfile(supabase, id), getCurrentUser()]);
  if (!profile) notFound();
  const t = await getTranslations("player");
  const isSelf = viewer?.id === id;
  const me = viewer && !isSelf ? viewer.id : null;
  // A block by the viewer, and where the two stand as friends (a pair is stored
  // lower id first; before migration 0042 the query fails and nothing is shown).
  const [{ data: block }, pair] = await Promise.all([
    me ? supabase.from("user_blocks").select("blocked_id").eq("blocker_id", me).eq("blocked_id", id).maybeSingle() : Promise.resolve({ data: null }),
    me
      ? supabase.from("friendships").select("status, requested_by").eq("user_a", me < id ? me : id).eq("user_b", me < id ? id : me).maybeSingle()
      : Promise.resolve(null),
  ]);
  let relation: FriendRelation | null = null;
  if (me && pair && !pair.error && !block && profile.username) {
    relation = !pair.data ? "none" : pair.data.status === "accepted" ? "friend" : pair.data.requested_by === me ? "requested" : "incoming";
  }

  return (
    <Container className="max-w-4xl py-10">
      <div className="mb-6 flex flex-wrap justify-end gap-2">
        {isSelf ? <LinkButton href="/profile" className={buttonClass("secondary", "sm")}>{t("editProfile")}</LinkButton> : null}
        {relation && profile.username ? <FriendActions userId={id} username={profile.username} relation={relation} withMessage={false} /> : null}
        {viewer && !isSelf && !block ? (
          <>
            <CallButton variant="secondary" peer={{ id, name: profile.display_name, avatarUrl: publicStorageUrl("avatars", profile.avatar_path) }} />
            <ActionForm action={startDirectConversationAction}>
              <Hidden values={{ user_id: id }} />
              <SubmitButton size="sm" variant="secondary">{t("message")}</SubmitButton>
            </ActionForm>
          </>
        ) : null}
        {viewer && !isSelf ? (
          <ActionForm action={blockUserAction}>
            <Hidden values={{ user_id: id, unblock: block ? "1" : undefined }} />
            <SubmitButton size="sm" variant="ghost">{block ? t("unblock") : t("block")}</SubmitButton>
          </ActionForm>
        ) : null}
        {viewer && !isSelf ? <ReportButton targetType="user" targetId={id} /> : null}
      </div>
      <PlayerSummary profile={profile} viewerId={viewer?.id ?? null} />
    </Container>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { blockUserAction } from "@/server/profile";
import { startDirectConversationAction } from "@/server/messages";
import { PlayerSummary } from "@/components/player/player-summary";
import { ReportButton } from "@/components/report-button";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Container } from "@/components/ui/primitives";

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
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (!profile) notFound();
  const viewer = await getCurrentUser();
  const t = await getTranslations("player");
  const isSelf = viewer?.id === id;
  const { data: block } = viewer && !isSelf
    ? await supabase.from("user_blocks").select("blocked_id").eq("blocker_id", viewer.id).eq("blocked_id", id).maybeSingle()
    : { data: null };

  return (
    <Container className="max-w-4xl py-10">
      <div className="mb-6 flex flex-wrap justify-end gap-2">
        {isSelf ? <Link href="/profile" className={buttonClass("secondary", "sm")}>{t("editProfile")}</Link> : null}
        {viewer && !isSelf && !block ? (
          <ActionForm action={startDirectConversationAction}>
            <Hidden values={{ user_id: id }} />
            <SubmitButton size="sm" variant="secondary">{t("message")}</SubmitButton>
          </ActionForm>
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

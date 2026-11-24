import type { Metadata } from "next";
import { UserPlus, UsersRound } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/auth";
import { publicStorageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { createGroupAction } from "@/server/groups";
import { FriendPicker, type PickableFriend } from "@/components/messages/friend-picker";
import { ActionForm, FormField, SubmitButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { controlProps, Input } from "@/components/ui/field";
import { LinkButton } from "@/components/ui/link-button";
import { Card, CardBody, Container, EmptyState, PageHeader } from "@/components/ui/primitives";

export async function generateMetadata({ params }: PageProps<"/[locale]/messages/groups/new">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "groups" });
  return { title: t("newTitle") };
}

type Friend = { user_id: string; display_name: string; username: string; avatar_path: string | null; relation: string };

/** «مجموعة جديدة»: a name and some friends; the one who makes it is its admin (migration 0044). */
export default async function NewGroupPage({ params }: PageProps<"/[locale]/messages/groups/new">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireOnboardedUser(locale as Locale, "/messages/groups/new");
  const t = await getTranslations("groups");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_friends");
  const friends: PickableFriend[] = ((data ?? []) as Friend[])
    .filter((f) => f.relation === "friend")
    .map((f) => ({ id: f.user_id, name: f.display_name, username: f.username, avatarUrl: publicStorageUrl("avatars", f.avatar_path) }));

  return (
    <Container className="flex max-w-2xl flex-col py-10">
      <PageHeader title={t("newTitle")} description={t("newDescription")} />
      {error ? (
        // Before the friends update (0042) there is nobody to pick.
        <EmptyState icon={<UsersRound className="size-10" />} title={t("notReady")} />
      ) : friends.length === 0 ? (
        <EmptyState
          icon={<UserPlus className="size-10" />}
          title={t("noFriends")}
          action={<LinkButton href="/friends" className={buttonClass("primary", "md", "mt-1")}>{t("toFriends")}</LinkButton>}
        >
          {t("noFriendsBody")}
        </EmptyState>
      ) : (
        <Card>
          <CardBody>
            <ActionForm action={createGroupAction} className="gap-6">
              <FormField name="title" label={t("nameLabel")} required>
                <Input {...controlProps("title")} required maxLength={60} autoComplete="off" placeholder={t("namePlaceholder")} />
              </FormField>
              <FriendPicker friends={friends} />
              <SubmitButton pendingLabel={t("creating")} className="self-start">{t("create")}</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </Container>
  );
}

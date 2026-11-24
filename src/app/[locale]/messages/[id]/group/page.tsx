import type { Metadata } from "next";
import { ArrowLeft, UsersRound } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { publicStorageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { addGroupMembersAction, leaveGroupAction, removeGroupMemberAction, renameGroupAction, setGroupAdminAction } from "@/server/groups";
import { FriendPicker, type PickableFriend } from "@/components/messages/friend-picker";
import { GroupPhotoForm } from "@/components/messages/group-photo-form";
import { AvatarViewer } from "@/components/ui/avatar-viewer";
import { ActionForm, FormField, Hidden, InlineAction, SubmitButton } from "@/components/ui/action-form";
import { Avatar } from "@/components/ui/avatar";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { controlProps, Input } from "@/components/ui/field";
import { Badge, Card, CardBody, Container, Section } from "@/components/ui/primitives";

const UUID = /^[0-9a-f-]{36}$/;

export async function generateMetadata({ params }: PageProps<"/[locale]/messages/[id]/group">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "messages" });
  return { title: t("groupInfo") };
}

type Member = {
  user_id: string;
  role: string;
  profile: { display_name: string; avatar_path: string | null } | null;
};
type Friend = { user_id: string; display_name: string; username: string; avatar_path: string | null; relation: string };

/**
 * A group's page (migration 0044): its members, who the admins are, and for
 * admins: add friends, remove members, make admins, rename. Anyone may leave.
 * Only its members reach it (RLS); the database checks every change again.
 */
export default async function GroupPage({ params }: PageProps<"/[locale]/messages/[id]/group">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!UUID.test(id)) notFound();
  const user = await requireOnboardedUser(locale as Locale, `/messages/${id}/group`);
  const t = await getTranslations("groups");
  const m = await getTranslations("messages");
  const supabase = await createClient();
  const [{ data: conv }, { data: rows }] = await Promise.all([
    // Every column: the photo (migration 0048) is simply absent before it runs.
    supabase.from("conversations").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("conversation_members")
      .select("user_id, role, created_at, profile:profiles(display_name, avatar_path)")
      .eq("conversation_id", id)
      .order("created_at")
      .order("user_id"),
  ]);
  // Not a group, not theirs, or a database before the groups update.
  if (!conv || conv.kind !== "group") notFound();
  const members = (rows ?? []) as unknown as Member[];
  const me = members.find((x) => x.user_id === user.id);
  if (!me) notFound();
  const isAdmin = me.role === "admin";
  const title = conv.title ?? m("kind.group");
  const photo = publicStorageUrl("group-photos", (conv as { photo_path?: string | null }).photo_path);
  // Admins add friends of theirs who aren't in it yet.
  let addable: PickableFriend[] = [];
  if (isAdmin) {
    const inGroup = new Set(members.map((x) => x.user_id));
    const { data } = await supabase.rpc("my_friends");
    addable = ((data ?? []) as Friend[])
      .filter((f) => f.relation === "friend" && !inGroup.has(f.user_id))
      .map((f) => ({ id: f.user_id, name: f.display_name, username: f.username, avatarUrl: publicStorageUrl("avatars", f.avatar_path) }));
  }
  // Admins first, then by when they joined.
  const ordered = [...members].sort((a, b) => Number(b.role === "admin") - Number(a.role === "admin"));

  return (
    <Container className="flex max-w-2xl flex-col gap-8 py-8">
      <Link href={`/messages/${id}`} className="flex items-center gap-1.5 self-start text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        {t("backToChat")}
      </Link>

      <header className="flex flex-col items-center gap-3 text-center">
        {photo ? (
          <AvatarViewer src={photo} name={title} size={80} />
        ) : (
          <span aria-hidden="true" className="grid size-20 place-items-center rounded-full bg-surface-3 text-muted">
            <UsersRound className="size-9" />
          </span>
        )}
        <h1 className="page-title font-display text-2xl font-bold sm:text-3xl">{title}</h1>
        <p className="text-sm text-muted">{m("membersCount", { count: members.length })}</p>
      </header>

      {isAdmin ? (
        <Card>
          <CardBody>
            <GroupPhotoForm conversationId={id} hasPhoto={Boolean(photo)} />
            <hr className="my-5 border-line" />
            <ActionForm action={renameGroupAction} className="gap-3">
              <Hidden values={{ conversation_id: id }} />
              <FormField name="title" label={t("renameTitle")} required>
                <Input {...controlProps("title")} required maxLength={60} autoComplete="off" defaultValue={title} />
              </FormField>
              <SubmitButton variant="secondary" size="sm" className="self-start">{t("rename")}</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : (
        <p className="text-center text-sm text-muted">{t("adminsOnly")}</p>
      )}

      <Section title={t("membersTitle", { count: members.length })} id="members">
        <ul className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          {ordered.map((x) => {
            const name = x.profile?.display_name ?? m("deletedUser");
            const self = x.user_id === user.id;
            const creator = x.user_id === conv.created_by;
            const manage = isAdmin && !self && !creator;
            return (
              // On a phone the buttons go under the name, so the name keeps its room.
              <li key={x.user_id} className="flex flex-col gap-1 border-b border-line px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Link href={`/players/${x.user_id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar src={publicStorageUrl("avatars", x.profile?.avatar_path)} name={name} size={44} />
                    <span className="min-w-0 truncate font-semibold">{self ? `${name} (${t("you")})` : name}</span>
                  </Link>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {x.role === "admin" ? <Badge tone="accent">{t("admin")}</Badge> : null}
                    {creator ? <span className="text-xs text-muted">{t("creator")}</span> : null}
                  </span>
                </div>
                {manage ? (
                  <div className="flex flex-wrap items-center gap-2 ps-14 sm:ps-0">
                    <InlineAction
                      action={setGroupAdminAction}
                      values={{ conversation_id: id, user_id: x.user_id, admin: x.role === "admin" ? "0" : "1" }}
                      label={x.role === "admin" ? t("removeAdmin") : t("makeAdmin")}
                      variant="ghost"
                    />
                    <ConfirmAction
                      action={removeGroupMemberAction}
                      values={{ conversation_id: id, user_id: x.user_id }}
                      label={t("remove")}
                      title={t("removeTitle", { name })}
                      description={t("removeBody")}
                      confirmLabel={t("remove")}
                      variant="ghost"
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Section>

      {isAdmin ? (
        <Section title={t("addTitle")} id="add">
          {addable.length ? (
            <Card>
              <CardBody>
                <ActionForm action={addGroupMembersAction} className="gap-4">
                  <Hidden values={{ conversation_id: id }} />
                  <FriendPicker friends={addable} />
                  <SubmitButton pendingLabel={t("adding")} className="self-start">{t("add")}</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : (
            <p className="text-sm text-muted">{t("allIn")}</p>
          )}
        </Section>
      ) : null}

      <div className="flex justify-center border-t border-line pt-6">
        <ConfirmAction
          action={leaveGroupAction}
          values={{ conversation_id: id }}
          label={t("leave")}
          title={t("leaveTitle", { name: title })}
          description={t("leaveBody")}
          confirmLabel={t("leave")}
          variant="danger"
          size="md"
        />
      </div>
    </Container>
  );
}

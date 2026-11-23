import type { Metadata } from "next";
import { Search, UserPlus, Users } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Form from "next/form";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { publicStorageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { normalizeUsername } from "@/lib/username";
import { removeFriendAction } from "@/server/friends";
import { FriendActions, type FriendRelation } from "@/components/friends/friend-actions";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Input } from "@/components/ui/field";
import { Card, CardBody, Container, EmptyState, PageHeader, Section } from "@/components/ui/primitives";

export async function generateMetadata({ params }: PageProps<"/[locale]/friends">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "friends" });
  return { title: t("title") };
}

type Person = { user_id: string; display_name: string; username: string; avatar_path: string | null; relation: string };

/** A member in a list: face, name and @username (to their page), and what can be done. */
function PersonRow({ person, children }: { person: Pick<Person, "user_id" | "display_name" | "username" | "avatar_path">; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <Link href={`/players/${person.user_id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar src={publicStorageUrl("avatars", person.avatar_path)} name={person.display_name} size={44} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{person.display_name}</span>
          <span className="max-w-full self-start truncate text-sm text-muted" dir="ltr">@{person.username}</span>
        </span>
      </Link>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </li>
  );
}

/**
 * «الأصدقاء»: find a member by username and add them; requests received and
 * sent; friends, with «مراسلة» and «إزالة» (migration 0042).
 */
export default async function FriendsPage({ params, searchParams }: PageProps<"/[locale]/friends">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireOnboardedUser(locale as Locale, "/friends");
  const t = await getTranslations("friends");
  const raw = (await searchParams).u;
  const query = normalizeUsername(typeof raw === "string" ? raw : "");
  const supabase = await createClient();
  const [{ data, error }, found] = await Promise.all([
    supabase.rpc("my_friends"),
    query ? supabase.rpc("find_member", { p_username: query }) : Promise.resolve({ data: null, error: null }),
  ]);
  if (error) {
    // Before migration 0042: the page says the feature waits for its update.
    return (
      <Container className="max-w-3xl py-10">
        <PageHeader title={t("title")} />
        <EmptyState icon={<Users className="size-10" />} title={t("notReady")} />
      </Container>
    );
  }
  const people = (data ?? []) as Person[];
  const friends = people.filter((p) => p.relation === "friend");
  const incoming = people.filter((p) => p.relation === "incoming");
  const sent = people.filter((p) => p.relation === "requested");
  const match = (found.data ?? [])[0] as (Person & { id: string }) | undefined;
  const list = "flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface";

  return (
    <Container className="flex max-w-3xl flex-col gap-10 py-10">
      <PageHeader title={t("title")} description={t("description")} />

      <Section title={t("addTitle")} id="add">
        <Card>
          <CardBody className="flex flex-col gap-4">
            <Form action="" scroll={false} role="search" className="flex gap-2">
              <label htmlFor="friend-username" className="sr-only">{t("usernameLabel")}</label>
              <div dir="ltr" className="flex min-w-0 flex-1 items-stretch overflow-hidden rounded-xl border border-line bg-surface focus-within:border-accent">
                <span aria-hidden="true" className="grid place-items-center ps-3 text-muted">@</span>
                <Input
                  id="friend-username"
                  name="u"
                  defaultValue={query}
                  placeholder={t("usernamePlaceholder")}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  className="min-w-0 flex-1 border-0 bg-transparent focus:ring-0"
                />
              </div>
              <button type="submit" className={buttonClass("primary", "md", "shrink-0")}>
                <Search aria-hidden="true" className="size-4" />
                {t("search")}
              </button>
            </Form>
            {query ? (
              match ? (
                <ul className="-mx-4 -mb-4 border-t border-line" aria-label={t("result")}>
                  <PersonRow person={{ ...match, user_id: match.id }}>
                    <FriendActions userId={match.id} username={match.username} relation={match.relation as FriendRelation} />
                  </PersonRow>
                </ul>
              ) : (
                <p role="status" className="text-sm text-muted">{t("noOne", { username: query })}</p>
              )
            ) : (
              <p className="text-sm text-muted">{t("addHint")}</p>
            )}
          </CardBody>
        </Card>
      </Section>

      {incoming.length ? (
        <Section title={t("incoming", { count: incoming.length })} id="incoming">
          <ul className={list}>
            {incoming.map((p) => (
              <PersonRow key={p.user_id} person={p}>
                <FriendActions userId={p.user_id} username={p.username} relation="incoming" />
              </PersonRow>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title={t("friendsTitle", { count: friends.length })} id="friends">
        {friends.length ? (
          <ul className={list}>
            {friends.map((p) => (
              <PersonRow key={p.user_id} person={p}>
                <FriendActions userId={p.user_id} username={p.username} relation="friend" />
                <ConfirmAction
                  action={removeFriendAction}
                  values={{ user_id: p.user_id }}
                  label={t("remove")}
                  title={t("removeTitle", { name: p.display_name })}
                  description={t("removeBody")}
                  confirmLabel={t("remove")}
                  variant="ghost"
                />
              </PersonRow>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<UserPlus className="size-10" />} title={t("empty")}>{t("emptyBody")}</EmptyState>
        )}
      </Section>

      {sent.length ? (
        <Section title={t("sent", { count: sent.length })} id="sent">
          <ul className={list}>
            {sent.map((p) => (
              <PersonRow key={p.user_id} person={p}>
                <FriendActions userId={p.user_id} username={p.username} relation="requested" />
              </PersonRow>
            ))}
          </ul>
        </Section>
      ) : null}
    </Container>
  );
}

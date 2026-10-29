import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { Badge, Container, EmptyState, PageHeader } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/link-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/messages">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "messages" });
  return { title: t("title") };
}

export default async function MessagesPage({ params }: PageProps<"/[locale]/messages">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireOnboardedUser(locale as Locale, "/messages");
  const t = await getTranslations("messages");
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_conversations", { p_limit: 100 });
  const rows = data ?? [];
  return (
    <Container className="max-w-3xl py-10">
      <PageHeader title={t("title")} description={t("description")} />
      {rows.length === 0 ? (
        <EmptyState icon={<MessageCircle className="size-10" />} title={t("empty")}>{t("emptyBody")}</EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
          {rows.map((c) => (
            <li key={c.conversation_id}>
              <LinkButton href={`/messages/${c.conversation_id}`} className="ripple flex items-center gap-3 p-4 transition-colors hover:bg-surface-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{c.title ?? t("untitled")}</span>
                    <Badge>{t(`kind.${c.kind}`)}</Badge>
                    {c.is_locked ? <Badge tone="warning">{t("locked")}</Badge> : null}
                  </div>
                  <p className="truncate text-sm text-muted" dir="auto">{c.last_message ?? t("noMessages")}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {c.last_message_at ? <time className="text-xs text-faint" dateTime={c.last_message_at}>{formatDateTime(c.last_message_at, locale, "Asia/Baghdad")}</time> : null}
                  {Number(c.unread_count) > 0 ? (
                    <span className="num rounded-full bg-accent px-2 text-xs font-bold text-accent-ink" aria-label={t("unread", { count: Number(c.unread_count) })}>
                      {c.unread_count}
                    </span>
                  ) : null}
                </div>
              </LinkButton>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}

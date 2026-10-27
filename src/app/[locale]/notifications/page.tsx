import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { notificationArgs, notificationHref } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";
import { markNotificationsReadAction } from "@/server/notifications";
import { InlineAction } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Container, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/cn";

export async function generateMetadata({ params }: PageProps<"/[locale]/notifications">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "notificationsPage" });
  return { title: t("title") };
}

const SIZE = 30;

export default async function NotificationsPage({ params, searchParams }: PageProps<"/[locale]/notifications">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale as Locale, "/notifications");
  const t = await getTranslations("notificationsPage");
  const n = await getTranslations("notifications");
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .range((page - 1) * SIZE, page * SIZE);
  const rows = (data ?? []).slice(0, SIZE);
  const unread = rows.some((r) => !r.read_at);
  const fmt = (iso: string) => formatDateTime(iso, locale, "Asia/Baghdad");

  return (
    <Container className="max-w-3xl py-10">
      <PageHeader
        title={t("title")}
        actions={
          <>
            <Link href="/settings" className={buttonClass("ghost", "sm")}>{t("preferences")}</Link>
            {unread ? <InlineAction action={markNotificationsReadAction} values={{}} label={t("markAll")} /> : null}
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={<Bell className="size-10" />} title={t("empty")} />
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
          {rows.map((r) => {
            const payload = (r.payload ?? {}) as Record<string, unknown>;
            const key = n.has(r.type) ? r.type : "generic";
            return (
              <li key={r.id} className={cn("flex items-start gap-3 p-4", !r.read_at && "bg-accent/5")}>
                <span aria-hidden="true" className={cn("mt-2 size-2 shrink-0 rounded-full", r.read_at ? "bg-transparent" : "bg-accent")} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Link href={notificationHref(r.type, payload)} className="text-sm hover:underline" dir="auto">
                    {!r.read_at ? <span className="sr-only">{t("unread")}: </span> : null}
                    {n(key, notificationArgs(payload, fmt))}
                  </Link>
                  <time className="text-xs text-faint" dateTime={r.created_at}>{fmt(r.created_at)}</time>
                </div>
                {!r.read_at ? <InlineAction action={markNotificationsReadAction} values={{ id: r.id }} label={t("markRead")} variant="ghost" /> : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-6">
        <Pagination pathname="/notifications" query={{}} page={page} hasMore={(data ?? []).length > SIZE} />
      </div>
    </Container>
  );
}

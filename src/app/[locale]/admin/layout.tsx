import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireModerator } from "@/lib/auth";
import { AdminNav } from "@/components/admin/admin-nav";
import { Container } from "@/components/ui/primitives";

/** Admin shell. Visibility here is a convenience; every admin RPC re-checks roles in the database. */
export default async function AdminLayout({ children, params }: LayoutProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireModerator(locale as Locale);
  const t = await getTranslations("admin");
  return (
    <Container className="flex flex-col gap-6 py-8">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">{t("title")}</p>
        <p className="text-xs text-muted">{user.isAdmin ? t("roleAdmin") : t("roleModerator")}</p>
      </div>
      <AdminNav isAdmin={user.isAdmin} />
      {children}
    </Container>
  );
}

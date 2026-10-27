import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "./logo";

export async function SiteFooter() {
  const t = await getTranslations("footer");
  const nav = await getTranslations("nav");
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-line bg-surface/40">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-4">
        <div className="flex flex-col gap-3 md:col-span-2">
          <Logo />
          <p className="max-w-sm text-sm text-muted">{t("tagline")}</p>
        </div>
        <nav aria-label={t("explore")} className="flex flex-col gap-2 text-sm">
          <p className="font-semibold">{t("explore")}</p>
          <Link className="text-muted hover:text-ink" href="/matches">{nav("matches")}</Link>
          <Link className="text-muted hover:text-ink" href="/teams">{nav("teams")}</Link>
          <Link className="text-muted hover:text-ink" href="/venues">{nav("venues")}</Link>
          <Link className="text-muted hover:text-ink" href="/tournaments">{nav("tournaments")}</Link>
        </nav>
        <nav aria-label={t("legal")} className="flex flex-col gap-2 text-sm">
          <p className="font-semibold">{t("legal")}</p>
          <Link className="text-muted hover:text-ink" href="/legal/terms">{t("terms")}</Link>
          <Link className="text-muted hover:text-ink" href="/legal/privacy">{t("privacy")}</Link>
          <Link className="text-muted hover:text-ink" href="/legal/safety">{t("safety")}</Link>
        </nav>
      </div>
      <p className="border-t border-line px-4 py-4 text-center text-xs text-faint">{t("copyright", { year })}</p>
    </footer>
  );
}

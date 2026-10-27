import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "./button";

/** Prev/next pagination that preserves the current query string. */
export async function Pagination({ pathname, query, page, hasMore }: { pathname: string; query: Record<string, string>; page: number; hasMore: boolean }) {
  const t = await getTranslations("common");
  if (page <= 1 && !hasMore) return null;
  const href = (p: number) => ({ pathname, query: { ...query, page: String(p) } });
  return (
    <nav aria-label={t("page", { page })} className="flex items-center justify-center gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} className={buttonClass("outline", "sm")} rel="prev">
          {t("previous")}
        </Link>
      ) : null}
      <span className="num text-sm text-muted">{t("page", { page })}</span>
      {hasMore ? (
        <Link href={href(page + 1)} className={buttonClass("outline", "sm")} rel="next">
          {t("next")}
        </Link>
      ) : null}
    </nav>
  );
}

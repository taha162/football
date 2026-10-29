import { getTranslations } from "next-intl/server";
import { buttonClass } from "./button";
import { LinkButton } from "./link-button";

/** Prev/next pagination that preserves the current query string. */
export async function Pagination({ pathname, query, page, hasMore }: { pathname: string; query: Record<string, string>; page: number; hasMore: boolean }) {
  const t = await getTranslations("common");
  if (page <= 1 && !hasMore) return null;
  const href = (p: number) => ({ pathname, query: { ...query, page: String(p) } });
  return (
    <nav aria-label={t("page", { page })} className="flex items-center justify-center gap-3">
      {page > 1 ? (
        <LinkButton href={href(page - 1)} className={buttonClass("outline", "sm")} rel="prev">
          {t("previous")}
        </LinkButton>
      ) : null}
      <span className="num text-sm text-muted">{t("page", { page })}</span>
      {hasMore ? (
        <LinkButton href={href(page + 1)} className={buttonClass("outline", "sm")} rel="next">
          {t("next")}
        </LinkButton>
      ) : null}
    </nav>
  );
}

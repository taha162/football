import { ViewTransition, type CSSProperties } from "react";
import { getTranslations } from "next-intl/server";
import { Container } from "@/components/ui/primitives";

/**
 * Stands in for a page while it loads: the shape of a page header and a grid
 * of cards, with a sheen passing over them. When the content arrives the
 * skeleton fades out as the page fades in (`skeleton-out` in globals.css).
 */
export default async function Loading() {
  const t = await getTranslations("common");
  return (
    <ViewTransition exit="skeleton-out" default="none">
      <Container className="py-10" aria-busy="true">
        <p role="status" className="sr-only">
          {t("loading")}
        </p>
        <div className="flex flex-col gap-3 pb-6" aria-hidden="true">
          <div className="skeleton h-9 w-56 max-w-full rounded-lg" />
          <div className="skeleton h-4 w-80 max-w-full rounded-md" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="flex h-44 flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4"
              style={{ "--sheen-delay": `${i * 90}ms` } as CSSProperties}
            >
              <div className="skeleton h-5 w-2/3 rounded-md" />
              <div className="skeleton h-3.5 w-1/2 rounded" />
              <div className="skeleton h-3.5 w-2/5 rounded" />
              <div className="skeleton mt-auto h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
      </Container>
    </ViewTransition>
  );
}

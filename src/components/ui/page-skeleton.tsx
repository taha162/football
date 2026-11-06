import type { CSSProperties } from "react";

/**
 * The shape of a page that is still loading: a page header and a grid of
 * cards, with a sheen passing over them (`.skeleton` in globals.css). Only
 * shapes: whoever shows it also tells screen readers the page is loading.
 * Shown only when loading takes longer than a second: the page's stand-in
 * on a first visit (src/app/[locale]/layout.tsx) and during a slow
 * navigation (src/components/motion/nav-progress.tsx).
 */
export function PageSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="flex flex-col gap-3 pb-6">
        <div className="skeleton h-9 w-56 max-w-full rounded-lg" />
        <div className="skeleton h-4 w-80 max-w-full rounded-md" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
    </div>
  );
}

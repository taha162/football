"use client";

import { ViewTransition, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Hands each page over to the next: keyed by the path, so every navigation
 * (detail pages included) is an exit and an enter, animated by the
 * `page-out`/`page-in` view-transition classes in globals.css. Changing only
 * the query (filters) or refreshing data keeps the page in place.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <ViewTransition key={pathname} enter="page-in" exit="page-out" default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}

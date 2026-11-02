"use client";

import type { ReactNode } from "react";
import { usePathname } from "@/i18n/navigation";

/**
 * Shows its content on the landing page only. The site footer sits behind it:
 * other pages end with their own content and the bottom bar. The footer's
 * links (terms, privacy, safety) stay one tap away through the logo.
 */
export function LandingOnly({ children }: { children: ReactNode }) {
  return usePathname() === "/" ? children : null;
}

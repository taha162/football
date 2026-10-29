"use client";

import type { Locale } from "@/i18n/routing";
import { useLinkTarget, type Href } from "./link-button";

/**
 * Makes a whole card clickable without an address preview: a layer over the
 * card that navigates on click or tap (Ctrl/⌘/Shift-click or a middle click
 * open a new tab). The card's title keeps an ordinary link underneath, which
 * keyboard, screen-reader and search-engine users follow; the card must be
 * `relative`, and nothing else in it may need the pointer.
 */
export function CardCover({ href, locale }: { href: Href; locale?: Locale }) {
  const target = useLinkTarget(href, { locale });
  return (
    <span
      aria-hidden="true"
      data-href={target.path}
      className="card-cover absolute inset-0 z-[1] cursor-pointer rounded-[inherit]"
      onClick={target.open}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        target.open(e);
      }}
      onPointerEnter={target.prefetch}
      onTouchStart={target.prefetch}
    />
  );
}

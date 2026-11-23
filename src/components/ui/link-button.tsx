"use client";

import { useCallback, type AnchorHTMLAttributes, type KeyboardEvent, type MouseEvent } from "react";
import { useRouter as useNextRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { getPathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { cn } from "@/lib/cn";
import { announceNavigation } from "@/components/motion/nav-progress";

export type Href = Parameters<typeof getPathname>[0]["href"];

/** Navigation shared by LinkButton and CardCover: what a link does, without an href. */
export function useLinkTarget(href: Href, options: { locale?: Locale; replace?: boolean; scroll?: boolean } = {}) {
  const router = useRouter(); // next-intl: adds the locale prefix and keeps the language cookie in step
  const nextRouter = useNextRouter();
  const current = useLocale() as Locale;
  const locale = options.locale ?? current;
  const path = getPathname({ href, locale, forcePrefix: locale !== current || undefined });
  const prefetch = useCallback(() => nextRouter.prefetch(path), [nextRouter, path]);
  const open = (e: MouseEvent | KeyboardEvent) => {
    // Ctrl/⌘/Shift and the middle button open a new tab, as they would on a link.
    if (e.metaKey || e.ctrlKey || e.shiftKey || ("button" in e && e.button === 1)) {
      window.open(path, "_blank", "noopener");
      return;
    }
    announceNavigation(path);
    (options.replace ? router.replace : router.push)(href, { locale, scroll: options.scroll });
  };
  return { path, prefetch, open };
}

/**
 * A control that navigates like a link but has no href, so the browser shows
 * no address preview when the pointer is over it. It keeps the link role and
 * is focusable; Enter activates it, and Ctrl/⌘/Shift-click or a middle click
 * opens the page in a new tab. The page is prefetched when the pointer comes
 * over it or it takes the focus, not merely because it is on screen: pages
 * here are dynamic, so a prefetch fetches no content, only a request to the
 * server (dozens per page when every visible control did it). Use it for
 * controls that look like buttons; links in running text stay ordinary links.
 */
export function LinkButton({
  href,
  locale,
  replace,
  scroll,
  className,
  onClick,
  onKeyDown,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: Href; locale?: Locale; replace?: boolean; scroll?: boolean }) {
  const { path, prefetch, open } = useLinkTarget(href, { locale, replace, scroll });

  return (
    <a
      role="link"
      tabIndex={0}
      data-href={path}
      className={cn("cursor-pointer", className)}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) open(e);
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        open(e);
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented || e.key !== "Enter") return;
        e.preventDefault();
        open(e);
      }}
      onPointerEnter={prefetch}
      onFocus={prefetch}
      {...rest}
    />
  );
}

/** LinkButton for another site (WhatsApp, maps): opens it in a new tab, again without an address preview. */
export function ExternalLinkButton({ href, className, ...rest }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "target" | "rel"> & { href: string }) {
  const open = () => window.open(href, "_blank", "noopener,noreferrer");
  return (
    <a
      role="link"
      tabIndex={0}
      data-href={href}
      className={cn("cursor-pointer", className)}
      onClick={open}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        open();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        open();
      }}
      {...rest}
    />
  );
}

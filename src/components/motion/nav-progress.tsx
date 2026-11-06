"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Container } from "@/components/ui/primitives";
import { PageSkeleton } from "@/components/ui/page-skeleton";

/** Fast navigations never show the line; a stuck one gives up. */
const SHOW_AFTER_MS = 120;
/** A page that takes longer than this to arrive gets a skeleton in its place; a quicker one never flashes it. */
const SKELETON_AFTER_MS = 1000;
const GIVE_UP_MS = 10_000;
const NAVIGATE = "app:navigate";

const key = (url: URL) => `${url.pathname}?${new URLSearchParams(url.search).toString()}`;
/** True when following this URL is a navigation inside the app to somewhere else. */
const leadsElsewhere = (url: URL) => url.origin === location.origin && key(url) !== key(new URL(location.href));

/**
 * For navigations started in code (router.push) rather than by a link or a
 * form, which the progress line cannot see: they get the same feedback.
 * `path` is the address the browser will show, locale prefix included.
 */
export function announceNavigation(path: string) {
  window.dispatchEvent(new CustomEvent<string>(NAVIGATE, { detail: path }));
}

/**
 * Feedback while the next page loads. The current page stays until the next
 * one is ready; past a blink, a chalk line runs across the top of the window,
 * and past a second the page's skeleton stands in for it (screen readers hear
 * that it is loading). It starts on a click on an internal link, on a search
 * form being sent or on an announced navigation, and finishes when the
 * address changes.
 */
export function NavProgress() {
  const t = useTranslations("common");
  const ref = useRef<HTMLDivElement>(null);
  const skeletonRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const finish = useRef<() => void>(() => undefined);
  // The skeleton is built when a navigation first starts, rather than sent
  // (hidden) with every page: pages stay as light as before.
  const [armed, setArmed] = useState(false);
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    const line = ref.current;
    const skeleton = skeletonRef.current;
    const status = statusRef.current;
    if (!line || !skeleton || !status) return;
    let show = 0;
    let slow = 0;
    let stop = 0;
    let rest = 0;
    const end = () => {
      clearTimeout(show);
      clearTimeout(slow);
      clearTimeout(stop);
      if (skeleton.dataset.state === "slow") {
        skeleton.dataset.state = "idle";
        status.textContent = "";
        const main = document.getElementById("main");
        main?.removeAttribute("aria-busy");
        delete main?.dataset.navSlow;
      }
      if (line.dataset.state !== "loading") return;
      line.dataset.state = "done";
      rest = window.setTimeout(() => (line.dataset.state = "idle"), 600);
    };
    const begin = () => {
      setArmed(true);
      clearTimeout(show);
      clearTimeout(slow);
      clearTimeout(stop);
      clearTimeout(rest);
      show = window.setTimeout(() => (line.dataset.state = "loading"), SHOW_AFTER_MS);
      slow = window.setTimeout(() => {
        skeleton.dataset.state = "slow";
        status.textContent = status.dataset.label ?? "";
        const main = document.getElementById("main");
        main?.setAttribute("aria-busy", "true");
        if (main) main.dataset.navSlow = ""; // the current page steps aside (globals.css)
      }, SKELETON_AFTER_MS);
      stop = window.setTimeout(end, GIVE_UP_MS);
    };
    finish.current = end;

    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      if (leadsElsewhere(new URL(link.href))) begin();
    };
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement) || form.method !== "get" || form.getAttribute("action")?.startsWith("javascript:")) return;
      const url = new URL(form.action, location.href);
      const fields = [...new FormData(form, e.submitter)].filter((entry): entry is [string, string] => typeof entry[1] === "string");
      url.search = new URLSearchParams(fields).toString();
      if (leadsElsewhere(url)) begin();
    };
    const onNavigate = (e: Event) => {
      const path = (e as CustomEvent<unknown>).detail;
      if (typeof path === "string" && leadsElsewhere(new URL(path, location.href))) begin();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    window.addEventListener(NAVIGATE, onNavigate);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
      window.removeEventListener(NAVIGATE, onNavigate);
      clearTimeout(show);
      clearTimeout(slow);
      clearTimeout(stop);
      clearTimeout(rest);
    };
  }, []);

  // In the commit that puts the new page in, before the page transition takes
  // its picture of the new state: the skeleton must not be in that picture.
  useLayoutEffect(() => finish.current(), [pathname, search]);

  return (
    <>
      <div ref={ref} className="nav-progress" data-state="idle" aria-hidden="true" />
      <p ref={statusRef} role="status" className="sr-only" data-label={t("loading")} />
      <div ref={skeletonRef} className="nav-skeleton" data-state="idle">
        {armed ? (
          <Container className="py-10">
            <PageSkeleton />
          </Container>
        ) : null}
      </div>
    </>
  );
}

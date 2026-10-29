"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Fast navigations never show the line; a stuck one gives up. */
const SHOW_AFTER_MS = 120;
const GIVE_UP_MS = 10_000;

const key = (url: URL) => `${url.pathname}?${new URLSearchParams(url.search).toString()}`;
/** True when following this URL is a navigation inside the app to somewhere else. */
const leadsElsewhere = (url: URL) => url.origin === location.origin && key(url) !== key(new URL(location.href));

/**
 * The chalk line across the top of the window while the next page loads. It
 * starts on a click on an internal link or on a search form being sent, and
 * finishes when the address changes.
 */
export function NavProgress() {
  const ref = useRef<HTMLDivElement>(null);
  const finish = useRef<() => void>(() => undefined);
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    const line = ref.current;
    if (!line) return;
    let show = 0;
    let stop = 0;
    let rest = 0;
    const end = () => {
      clearTimeout(show);
      clearTimeout(stop);
      if (line.dataset.state !== "loading") return;
      line.dataset.state = "done";
      rest = window.setTimeout(() => (line.dataset.state = "idle"), 600);
    };
    const begin = () => {
      clearTimeout(show);
      clearTimeout(stop);
      clearTimeout(rest);
      show = window.setTimeout(() => (line.dataset.state = "loading"), SHOW_AFTER_MS);
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
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
      clearTimeout(show);
      clearTimeout(stop);
      clearTimeout(rest);
    };
  }, []);

  useEffect(() => finish.current(), [pathname, search]);

  return <div ref={ref} className="nav-progress" data-state="idle" aria-hidden="true" />;
}

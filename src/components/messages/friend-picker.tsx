"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/field";

export type PickableFriend = { id: string; name: string; username: string; avatarUrl: string | null };

/**
 * Friends to tick for a group («member» boxes in the surrounding form), by
 * name (their @username is on their page), with a search over names and
 * usernames once the list is long. A search only hides
 * rows: every box stays in the form, so what was ticked survives it.
 */
export function FriendPicker({ friends, name = "member" }: { friends: PickableFriend[]; name?: string }) {
  const t = useTranslations("groups");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const searchId = useId();
  const legendId = useId();
  const q = query.trim().toLowerCase().replace(/^@/, "");
  const matches = (f: PickableFriend) => !q || f.name.toLowerCase().includes(q) || f.username.includes(q);
  const shown = friends.filter(matches).length;
  // Only those still offered: after an addition the page drops the friends who joined.
  const count = friends.filter((f) => picked.has(f.id)).length;
  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div role="group" aria-labelledby={legendId} className="flex flex-col gap-3">
      <span id={legendId} className="text-sm font-medium text-ink">{t("pickLabel")}</span>
      {friends.length > 6 ? (
        <div className="relative">
          <label htmlFor={searchId} className="sr-only">{t("search")}</label>
          <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search")}
            autoComplete="off"
            enterKeyHint="search"
            // Enter searches; it mustn't send the form.
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            className="ps-9"
          />
        </div>
      ) : null}
      <ul className="flex max-h-[min(50vh,26rem)] flex-col overflow-y-auto rounded-[var(--radius-card)] border border-line bg-surface">
        {friends.map((f) => (
          <li key={f.id} hidden={!matches(f)} className="border-b border-line last:border-b-0">
            <label className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2 transition-colors hover:bg-surface-2">
              <input
                type="checkbox"
                name={name}
                value={f.id}
                checked={picked.has(f.id)}
                onChange={(e) => toggle(f.id, e.target.checked)}
                className="size-5 shrink-0 rounded accent-[var(--color-accent)]"
              />
              <Avatar src={f.avatarUrl} name={f.name} size={36} />
              <span className="min-w-0 truncate font-medium">{f.name}</span>
            </label>
          </li>
        ))}
      </ul>
      {shown === 0 ? <p role="status" className="text-sm text-muted">{t("noMatch")}</p> : null}
      <p aria-live="polite" className="text-sm text-muted">{t("selected", { count })}</p>
    </div>
  );
}

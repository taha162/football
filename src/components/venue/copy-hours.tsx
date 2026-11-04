"use client";

import { Copy } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

/** Gives every day the first day's hours (and open or closed), so a venue with the same hours all week sets them once. */
export function CopyHoursToAll({ days, label }: { days: readonly number[]; label: string }) {
  const copy = (e: React.MouseEvent<HTMLButtonElement>) => {
    const form = e.currentTarget.form;
    if (!form) return;
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | null;
    const [first, ...rest] = days;
    const open = field(`open_${first}`)?.checked ?? true;
    const opens = field(`opens_${first}`)?.value ?? "";
    const closes = field(`closes_${first}`)?.value ?? "";
    for (const d of rest) {
      const box = field(`open_${d}`);
      if (box) box.checked = open;
      const o = field(`opens_${d}`);
      if (o) o.value = opens;
      const c = field(`closes_${d}`);
      if (c) c.value = closes;
    }
  };
  return (
    <button type="button" onClick={copy} className={buttonClass("outline", "md")}>
      <Copy aria-hidden="true" className="size-4" />
      {label}
    </button>
  );
}

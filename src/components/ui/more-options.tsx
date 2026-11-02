"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Folds optional fields away so a form shows only what most people need.
 * Nothing is removed: the fields are still submitted with the form. Opens by
 * itself when one of its fields is reported invalid, so errors stay visible.
 */
export function MoreOptions({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open && el.querySelector('[aria-invalid="true"]')) el.open = true;
  });
  return (
    <details ref={ref} className={cn("group rounded-xl border border-line", className)}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown aria-hidden="true" className="size-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-5 border-t border-line p-4">{children}</div>
    </details>
  );
}

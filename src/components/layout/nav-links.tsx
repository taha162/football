"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

type Href = "/matches" | "/teams" | "/venues" | "/tournaments";

export function NavLinks({ items }: { items: { href: Href; label: string }[] }) {
  const pathname = usePathname();
  return (
    <ul className="flex items-center gap-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium transition-colors",
                active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

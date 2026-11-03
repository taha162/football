"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";

export function AdminNav({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations("admin.nav");
  const pathname = usePathname();
  const items = [
    { href: "/admin", key: "overview" },
    { href: "/admin/reports", key: "reports" },
    { href: "/admin/users", key: "users", admin: true },
    { href: "/admin/venues", key: "venues" },
    { href: "/admin/content", key: "content" },
    { href: "/admin/bookings", key: "bookings" },
    { href: "/admin/audit", key: "audit", admin: true },
    { href: "/admin/settings", key: "settings", admin: true },
  ].filter((i) => !i.admin || isAdmin);
  return (
    <nav aria-label={t("label")} className="flex flex-wrap gap-2 border-b border-line pb-3">
      {items.map((i) => {
        const active = i.href === "/admin" ? pathname === "/admin" : pathname.startsWith(i.href);
        return (
          <LinkButton key={i.href} href={i.href} aria-current={active ? "page" : undefined} className={buttonClass(active ? "secondary" : "ghost", "sm")}>
            {t(i.key)}
          </LinkButton>
        );
      })}
    </nav>
  );
}

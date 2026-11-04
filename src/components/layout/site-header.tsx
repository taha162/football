import { Bell, MessageCircle, Plus, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { CurrentUser } from "@/lib/auth";
import { publicStorageUrl } from "@/lib/storage";
import { getManagedThings, getUnreadCounts } from "@/server/reference";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { HeaderFrame } from "./header-frame";
import { Logo } from "./logo";
import { CountLink } from "./count-link";
import { NavLinks } from "./nav-links";
import { UserMenu } from "./user-menu";
import { LinkButton } from "@/components/ui/link-button";

export async function SiteHeader({ user }: { user: CurrentUser | null }) {
  const t = await getTranslations("nav");
  const counts = user ? await getUnreadCounts() : { notifications: 0, messages: 0 };
  // The account menu lists management pages only for people who manage something.
  const roles = user ? await getManagedThings(user.id) : { venues: false, tournaments: false };

  return (
    <HeaderFrame>
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
        <LinkButton href="/" className="logo-link shrink-0 rounded-lg" aria-label={t("home")}>
          <Logo slogan />
        </LinkButton>
        <nav aria-label={t("primary")} className="hidden flex-1 lg:block">
          <NavLinks
            items={[
              { href: "/matches", label: t("matches") },
              { href: "/teams", label: t("teams") },
              { href: "/venues", label: t("venues") },
              { href: "/tournaments", label: t("tournaments") },
            ]}
          />
        </nav>
        <div className="ms-auto flex min-w-0 items-center gap-1 sm:gap-1.5">
          {user ? (
            <>
              <LinkButton href="/matches/new" className={buttonClass("primary", "sm", "hidden lg:inline-flex")}>
                <Plus aria-hidden="true" className="size-4" />
                {t("createMatch")}
              </LinkButton>
              {user.isModerator ? (
                <LinkButton href="/admin" className={buttonClass("ghost", "sm", "hidden lg:inline-flex")} aria-label={t("admin")}>
                  <ShieldCheck aria-hidden="true" className="size-5" />
                </LinkButton>
              ) : null}
              <CountLink href="/messages" label={t("messages")} count={counts.messages} className="hidden lg:inline-flex">
                <MessageCircle aria-hidden="true" className="size-5" />
              </CountLink>
              <CountLink href="/notifications" label={t("notifications")} count={counts.notifications}>
                <Bell aria-hidden="true" className="size-5" />
              </CountLink>
              <UserMenu
                name={user.profile.display_name}
                avatar={<Avatar src={publicStorageUrl("avatars", user.profile.avatar_path)} name={user.profile.display_name} size={32} />}
                isModerator={user.isModerator}
                managesVenues={roles.venues}
                organizesTournaments={roles.tournaments}
              />
            </>
          ) : (
            <>
              {/* Phones have it in the bottom bar; the top bar keeps room for the logo. */}
              <LinkButton href="/sign-in" className={buttonClass("ghost", "sm", "hidden sm:inline-flex")}>
                {t("signIn")}
              </LinkButton>
              <LinkButton href="/sign-up" className={buttonClass("primary", "sm")}>
                {t("signUp")}
              </LinkButton>
            </>
          )}
        </div>
      </div>
    </HeaderFrame>
  );
}

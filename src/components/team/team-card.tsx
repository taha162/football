import { Shield, Users } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { publicStorageUrl } from "@/lib/storage";
import { localizedName } from "@/server/reference";
import type { TeamCardData } from "@/server/teams/queries";
import { StorageImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/primitives";

export function TeamLogo({ path, name, size = 48 }: { path: string | null; name: string; size?: number }) {
  const url = publicStorageUrl("team-logos", path);
  return (
    <span className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-3 text-accent" style={{ width: size, height: size }}>
      {url ? <StorageImage src={url} alt="" width={size} height={size} className="size-full object-cover" /> : <Shield aria-hidden="true" className="size-1/2" />}
      <span className="sr-only">{name}</span>
    </span>
  );
}

export async function TeamCard({ team, role }: { team: TeamCardData; role?: string }) {
  const t = await getTranslations("teams");
  const e = await getTranslations("enums");
  const locale = await getLocale();
  const count = team.members?.[0]?.count ?? 0;
  return (
    <article className="relative flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 transition-colors hover:border-line-strong">
      <div className="flex items-center gap-3">
        <TeamLogo path={team.logo_path} name={team.name} />
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-semibold">
            <Link href={`/teams/${team.id}`} className="after:absolute after:inset-0">{team.name}</Link>
          </h3>
          <p className="text-xs text-muted">{[localizedName(team.area, locale), localizedName(team.city, locale)].filter(Boolean).join("، ")}</p>
        </div>
      </div>
      {team.description ? <p className="line-clamp-2 text-sm text-muted">{team.description}</p> : null}
      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <Badge>
          <Users aria-hidden="true" className="size-3" />
          <span className="num">{t("memberCount", { count })}</span>
        </Badge>
        {team.preferred_format ? <Badge>{team.preferred_format}</Badge> : null}
        {team.skill_level ? <Badge tone="info">{e(`skill.${team.skill_level}`)}</Badge> : null}
        {team.visibility === "private" ? <Badge tone="warning">{t("private")}</Badge> : null}
        {role ? <Badge tone="accent">{t(`role.${role}`)}</Badge> : null}
      </div>
    </article>
  );
}

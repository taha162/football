import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/auth";
import { publicStorageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { getAreas, getCities } from "@/server/reference";
import { AvatarForm } from "@/components/forms/avatar-form";
import { ProfileForm } from "@/components/forms/profile-form";
import { AvatarViewer } from "@/components/ui/avatar-viewer";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, Container, PageHeader } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/link-button";

export default async function ProfilePage({ params }: PageProps<"/[locale]/profile">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, "/profile");
  const t = await getTranslations("profile");
  const supabase = await createClient();
  const [cities, areas, { data: prefs }] = await Promise.all([
    getCities(),
    getAreas(),
    supabase.from("user_preferences").select("preferred_times").eq("user_id", user.id).maybeSingle(),
  ]);
  const p = user.profile;
  return (
    <Container className="max-w-3xl py-10">
      <PageHeader title={t("title")} actions={<LinkButton href={`/players/${user.id}`} className={buttonClass("outline", "md")}>{t("viewPublic")}</LinkButton>} />
      <Card className="mb-8">
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <AvatarViewer src={publicStorageUrl("avatars", p.avatar_path)} name={p.display_name} size={80} />
          <div className="flex flex-1 flex-col gap-3">
            {/* The username shows here and on their page only (elsewhere, the name); it is changed in settings. */}
            {p.username ? (
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-accent" data-testid="username"><bdi dir="ltr">@{p.username}</bdi></span>
                <LinkButton href="/settings#username" aria-label={t("changeUsernameLabel")} className="text-muted underline underline-offset-2 hover:text-ink">
                  {t("changeUsername")}
                </LinkButton>
              </p>
            ) : null}
            <AvatarForm hasAvatar={Boolean(p.avatar_path)} />
          </div>
        </CardBody>
      </Card>
      <ProfileForm
        cities={cities}
        areas={areas}
        defaults={{
          display_name: p.display_name,
          city_id: p.city_id,
          area_id: p.area_id,
          bio: p.bio,
          positions: p.positions,
          skill_level: p.skill_level,
          preferred_formats: p.preferred_formats,
          preferred_times: prefs?.preferred_times ?? [],
          show_match_history: p.show_match_history,
        }}
      />
    </Container>
  );
}

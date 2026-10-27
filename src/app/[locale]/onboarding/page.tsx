import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser, safeNext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAreas, getCities } from "@/server/reference";
import { ProfileForm } from "@/components/forms/profile-form";
import { Container, PageHeader } from "@/components/ui/primitives";
import type { Locale } from "@/i18n/routing";

export async function generateMetadata({ params }: PageProps<"/[locale]/onboarding">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "onboarding" });
  return { title: t("title") };
}

export default async function OnboardingPage({ params, searchParams }: PageProps<"/[locale]/onboarding">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const next = safeNext((await searchParams).next, "/dashboard");
  const user = await requireUser(locale as Locale, "/onboarding");
  const t = await getTranslations("onboarding");
  const [cities, areas, supabase] = await Promise.all([getCities(), getAreas(), createClient()]);
  const { data: prefs } = await supabase.from("user_preferences").select("preferred_times").eq("user_id", user.id).maybeSingle();
  const p = user.profile;
  return (
    <Container className="max-w-2xl py-10">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <ProfileForm
        onboarding
        next={next}
        cities={cities}
        areas={areas}
        defaults={{
          display_name: p.display_name,
          city_id: p.city_id ?? cities[0]?.id ?? null,
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

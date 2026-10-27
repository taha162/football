import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/auth";
import { getAreas, getCities } from "@/server/reference";
import { VenueForm } from "@/components/venue/venue-form";
import { Alert, Container, PageHeader } from "@/components/ui/primitives";

export default async function NewVenuePage({ params }: PageProps<"/[locale]/manage/venues/new">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, "/manage/venues/new");
  const t = await getTranslations("venueDashboard");
  const [cities, areas] = await Promise.all([getCities(), getAreas()]);
  return (
    <Container className="max-w-2xl py-10">
      <PageHeader title={t("newTitle")} description={t("newDescription")} />
      <Alert tone="info" className="mb-6">{t("ownershipNote")}</Alert>
      <VenueForm cities={cities} areas={areas} canEditSettings={false} defaults={{ city_id: user.profile.city_id }} />
    </Container>
  );
}

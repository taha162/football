import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { myVenues } from "@/server/venues/queries";
import { VenueCard } from "@/components/venue/venue-card";
import { buttonClass } from "@/components/ui/button";
import { Container, EmptyState, PageHeader } from "@/components/ui/primitives";

export default async function ManageVenuesPage({ params }: PageProps<"/[locale]/manage/venues">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, "/manage/venues");
  const t = await getTranslations("venueDashboard");
  const venues = await myVenues(user.id);
  return (
    <Container className="py-10">
      <PageHeader title={t("title")} description={t("description")} actions={<Link href="/manage/venues/new" className={buttonClass("primary", "md")}>{t("add")}</Link>} />
      {venues.length === 0 ? (
        <EmptyState title={t("empty")} action={<Link href="/manage/venues/new" className={buttonClass("primary", "md")}>{t("add")}</Link>}>{t("emptyBody")}</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {venues.map(({ venue, role }) => (
            <div key={venue.id} className="flex flex-col gap-2">
              <VenueCard venue={venue} role={role} />
              <Link href={`/manage/venues/${venue.id}`} className={buttonClass("secondary", "sm")}>{t("manage")}</Link>
            </div>
          ))}
        </div>
      )}
    </Container>
  );
}

import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/auth";
import { getVenue } from "@/server/venues/queries";
import { submitVenueReviewAction } from "@/server/reviews";
import { RatingInput } from "@/components/review/rating-input";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Textarea } from "@/components/ui/field";
import { Card, CardBody, Container, PageHeader } from "@/components/ui/primitives";

/** Review a venue after a completed booking (eligibility is checked by the database). */
export default async function VenueReviewPage({ params, searchParams }: PageProps<"/[locale]/venues/[id]/review">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireOnboardedUser(locale as Locale, `/venues/${id}/review`);
  const venue = await getVenue(id);
  if (!venue) notFound();
  const booking = (await searchParams).booking;
  if (typeof booking !== "string") notFound();
  const t = await getTranslations("review");
  return (
    <Container className="max-w-xl py-10">
      <PageHeader title={t("venueTitle", { name: venue.name })} />
      <Card>
        <CardBody>
          <ActionForm action={submitVenueReviewAction}>
            <Hidden values={{ venue_id: id, booking_id: booking }} />
            <RatingInput name="venue_rating" legend={t("venueExperience")} required />
            <Textarea name="comment" maxLength={500} placeholder={t("commentPlaceholder")} aria-label={t("comment")} />
            <SubmitButton className="self-start">{t("submit")}</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
    </Container>
  );
}

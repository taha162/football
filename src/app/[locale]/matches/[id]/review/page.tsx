import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { publicStorageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { getMatch, getRoster } from "@/server/matches/queries";
import { submitPlayerReviewAction, submitVenueReviewAction } from "@/server/reviews";
import { RatingInput } from "@/components/review/rating-input";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Avatar } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/field";
import { Alert, Card, CardBody, Container, PageHeader } from "@/components/ui/primitives";

export default async function ReviewPage({ params }: PageProps<"/[locale]/matches/[id]/review">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, `/matches/${id}/review`);
  const match = await getMatch(id);
  if (!match) notFound();
  const t = await getTranslations("review");
  const supabase = await createClient();
  const [roster, { data: mine }] = await Promise.all([
    getRoster(id),
    supabase.from("reviews").select("subject_user_id, venue_id").eq("reviewer_id", user.id).eq("match_id", id),
  ]);
  const reviewed = new Set((mine ?? []).map((r) => r.subject_user_id ?? `venue:${r.venue_id}`));
  const people = [
    ...(match.organizer_id !== user.id ? [{ user_id: match.organizer_id, name: match.organizer?.display_name ?? "", avatar: match.organizer?.avatar_path ?? null, isOrganizer: true }] : []),
    ...roster
      .filter((r) => r.status === "confirmed" && r.user_id !== user.id && r.user_id !== match.organizer_id && r.attendance !== "no_show")
      .map((r) => ({ user_id: r.user_id, name: r.profile?.display_name ?? "", avatar: r.profile?.avatar_path ?? null, isOrganizer: false })),
  ];

  return (
    <Container className="max-w-3xl py-10">
      <PageHeader
        title={t("title")}
        description={
          <>
            <Link href={`/matches/${id}`} className="text-accent hover:underline">{match.title}</Link> — {t("description")}
          </>
        }
      />
      {match.status !== "completed" ? <Alert tone="info">{t("notYet")}</Alert> : null}
      <Alert tone="info" className="mb-6">{t("privacyNote")}</Alert>
      <div className="flex flex-col gap-4">
        {match.status === "completed" && match.venue ? (
          <Card>
            <CardBody>
              <h2 className="mb-3 font-display text-lg font-semibold">{t("venueTitle", { name: match.venue.name })}</h2>
              {reviewed.has(`venue:${match.venue.id}`) ? (
                <p className="text-sm text-success">{t("done")}</p>
              ) : (
                <ActionForm action={submitVenueReviewAction}>
                  <Hidden values={{ venue_id: match.venue.id, match_id: id }} />
                  <RatingInput name="venue_rating" legend={t("venueExperience")} required />
                  <Textarea name="comment" maxLength={500} placeholder={t("commentPlaceholder")} aria-label={t("comment")} />
                  <SubmitButton className="self-start">{t("submit")}</SubmitButton>
                </ActionForm>
              )}
            </CardBody>
          </Card>
        ) : null}
        {match.status === "completed" && people.length === 0 ? <p className="text-muted">{t("nobody")}</p> : null}
        {match.status === "completed"
          ? people.map((p) => (
              <Card key={p.user_id}>
                <CardBody className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <Avatar src={publicStorageUrl("avatars", p.avatar)} name={p.name} size={40} />
                    <h2 className="font-display text-lg font-semibold">{p.name}</h2>
                  </div>
                  {reviewed.has(p.user_id) ? (
                    <p className="text-sm text-success">{t("done")}</p>
                  ) : (
                    <ActionForm action={submitPlayerReviewAction}>
                      <Hidden values={{ match_id: id, subject_user_id: p.user_id }} />
                      <div className="grid gap-4 sm:grid-cols-2">
                        <RatingInput name="reliability" legend={t("reliability")} required />
                        <RatingInput name="punctuality" legend={t("punctuality")} required />
                        <RatingInput name="sportsmanship" legend={t("sportsmanship")} required />
                        {p.isOrganizer ? <RatingInput name="organization" legend={t("organization")} /> : null}
                      </div>
                      <Textarea name="comment" maxLength={500} placeholder={t("commentPlaceholder")} aria-label={t("comment")} />
                      <SubmitButton className="self-start">{t("submit")}</SubmitButton>
                    </ActionForm>
                  )}
                </CardBody>
              </Card>
            ))
          : null}
      </div>
    </Container>
  );
}

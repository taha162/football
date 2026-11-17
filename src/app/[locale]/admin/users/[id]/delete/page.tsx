import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { DELETE_WORD } from "@/lib/member-deletion";
import { createClient } from "@/lib/supabase/server";
import { deleteMemberAction } from "@/server/admin";
import { ActionForm, FormField, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Input, Textarea } from "@/components/ui/field";
import { Alert, Card, CardBody, PageHeader } from "@/components/ui/primitives";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: t("deleteMemberTitle"), robots: { index: false } };
}

type Preview = {
  display_name: string;
  blockers: { self: boolean; admin: boolean; owns_venues: string[] };
  matches: number;
  tournaments: number;
  messages: number;
  bookings: number;
  upcoming_bookings: number;
  teams: number;
  reviews: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deleting a member for good (admins only). The page says what goes with them
 * and what stays, or why they can't be deleted; the admin types «حذف» to
 * confirm. The database checks everything again when it is sent.
 */
export default async function DeleteMemberPage({ params }: PageProps<"/[locale]/admin/users/[id]/delete">) {
  const { id } = await params;
  const locale = await getLocale();
  if (!(await getCurrentUser())?.isAdmin) redirect({ href: "/admin", locale });
  if (!UUID.test(id)) notFound();
  const t = await getTranslations("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_user_deletion_preview", { p_user_id: id });
  if (error?.message === "user_not_found") notFound();
  const back = (
    <Link href="/admin/users" className="text-sm text-accent hover:underline">
      {t("deleteBack")}
    </Link>
  );
  if (error || !data) {
    return (
      <>
        <PageHeader title={t("deleteMemberTitle")} />
        <Alert tone="warning">{t("deleteUnavailable")}</Alert>
        {back}
      </>
    );
  }
  const p = data as unknown as Preview;
  const n = (x: number) => formatNumber(x, locale);
  const blocked = p.blockers.self
    ? t("deleteBlockedSelf")
    : p.blockers.admin
      ? t("deleteBlockedAdmin")
      : p.blockers.owns_venues.length > 0
        ? t("deleteBlockedVenue", { venues: p.blockers.owns_venues.map((v) => `«${v}»`).join("، ") })
        : null;

  return (
    <>
      <PageHeader title={t("deleteMemberTitle")} description={t("deleteMemberIntro", { name: p.display_name })} />
      <Card>
        <CardBody className="flex flex-col gap-4 text-sm">
          <section className="flex flex-col gap-1.5">
            <h2 className="font-semibold text-danger">{t("deleteGoes")}</h2>
            <ul className="list-disc ps-5 text-muted" data-testid="delete-goes">
              <li>{t("deleteGoesAccount")}</li>
              <li>{t("deleteGoesMatches", { count: n(p.matches), tournaments: n(p.tournaments) })}</li>
              <li>{t("deleteGoesMessages", { count: n(p.messages) })}</li>
              <li>{t("deleteGoesTeams", { count: n(p.teams) })}</li>
              <li>{t("deleteGoesReviews", { count: n(p.reviews) })}</li>
            </ul>
          </section>
          <section className="flex flex-col gap-1.5">
            <h2 className="font-semibold">{t("deleteStays")}</h2>
            <ul className="list-disc ps-5 text-muted">
              <li>{t("deleteStaysBookings", { count: n(p.bookings), upcoming: n(p.upcoming_bookings) })}</li>
              <li>{t("deleteStaysRecords")}</li>
            </ul>
          </section>
        </CardBody>
      </Card>
      {blocked ? (
        <Alert tone="warning">{blocked}</Alert>
      ) : (
        <Card>
          <CardBody>
            <ActionForm action={deleteMemberAction}>
              <Hidden values={{ user_id: id }} />
              <FormField name="reason" label={t("deleteReason")}>
                {(a) => <Textarea {...a} rows={2} maxLength={500} />}
              </FormField>
              <FormField name="confirm" label={t("deleteConfirm", { word: DELETE_WORD })} required>
                {(a) => <Input {...a} required autoComplete="off" spellCheck={false} maxLength={20} />}
              </FormField>
              <SubmitButton variant="danger" className="self-start">
                {t("deleteSubmit")}
              </SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      )}
      {back}
    </>
  );
}

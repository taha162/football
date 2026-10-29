import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { localizedName } from "@/server/reference";
import { setHiddenAction, setVerificationAction } from "@/server/admin";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Input, Select } from "@/components/ui/field";
import { Badge, Card, CardBody, EmptyState, PageHeader } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/link-button";

const FILTERS = ["pending", "unverified", "verified", "rejected"] as const;

export default async function AdminVenuesPage({ searchParams }: PageProps<"/[locale]/admin/venues">) {
  const t = await getTranslations("admin");
  const vp = await getTranslations("venuePage");
  const locale = await getLocale();
  const requested = (await searchParams).status;
  const status = FILTERS.find((f) => f === requested) ?? "pending";
  const supabase = await createClient();
  const { data } = await supabase
    .from("venues")
    .select("id, name, address, phone, created_at, verification_status, verification_note, is_hidden, city:cities(name_en, name_ar), owner:venue_staff(role, profile:profiles!venue_staff_user_id_fkey(id, display_name))")
    .eq("verification_status", status)
    .order("created_at")
    .limit(100);
  return (
    <>
      <PageHeader title={t("nav.venues")} description={t("venuesDescription")} />
      <nav className="flex flex-wrap gap-2" aria-label={t("verificationStatus")}>
        {FILTERS.map((f) => (
          <LinkButton key={f} href={{ pathname: "/admin/venues", query: { status: f } }} aria-current={f === status ? "page" : undefined} className={buttonClass(f === status ? "secondary" : "ghost", "sm")}>
            {vp(`verification.${f}`)}
          </LinkButton>
        ))}
      </nav>
      {(data ?? []).length === 0 ? <EmptyState title={t("noVenues")} /> : null}
      <ul className="flex flex-col gap-3">
        {(data ?? []).map((v) => {
          const owner = (v.owner ?? []).find((s) => s.role === "owner");
          return (
            <li key={v.id}>
              <Card>
                <CardBody className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/venues/${v.id}`} className="font-display text-lg font-semibold hover:underline">{v.name}</Link>
                    <Badge>{localizedName(v.city, locale)}</Badge>
                    {v.is_hidden ? <Badge tone="danger">{t("hidden")}</Badge> : null}
                  </div>
                  <p className="text-sm text-muted">
                    {v.address ?? "—"} · <span dir="ltr">{v.phone ?? "—"}</span> · {t("owner")}:{" "}
                    {owner?.profile ? <Link href={`/players/${owner.profile.id}`} className="hover:underline">{owner.profile.display_name}</Link> : "—"} · {formatDate(v.created_at, locale, "Asia/Baghdad")}
                  </p>
                  <ActionForm action={setVerificationAction} className="flex-row flex-wrap items-end gap-2">
                    <Hidden values={{ venue_id: v.id }} />
                    <Select name="status" defaultValue={v.verification_status === "pending" ? "verified" : v.verification_status} className="w-40" aria-label={t("verificationStatus")}>
                      {FILTERS.map((f) => <option key={f} value={f}>{vp(`verification.${f}`)}</option>)}
                    </Select>
                    <Input name="note" defaultValue={v.verification_note ?? ""} placeholder={t("verificationNote")} aria-label={t("verificationNote")} className="flex-1" maxLength={300} />
                    <SubmitButton>{t("update")}</SubmitButton>
                  </ActionForm>
                  <p className="text-xs text-muted">{t("verificationChecklist")}</p>
                  <div>
                    <ConfirmAction
                      action={setHiddenAction}
                      values={{ entity_type: "venue", entity_id: v.id, hidden: v.is_hidden ? undefined : "1" }}
                      label={v.is_hidden ? t("unhide") : t("hideContent")}
                      title={v.is_hidden ? t("unhide") : t("hideContent")}
                      confirmLabel={v.is_hidden ? t("unhide") : t("hideContent")}
                      reasonName={v.is_hidden ? undefined : "reason"}
                      reasonLabel={t("reason")}
                      reasonRequired={!v.is_hidden}
                      variant={v.is_hidden ? "primary" : "danger"}
                    />
                  </div>
                </CardBody>
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}

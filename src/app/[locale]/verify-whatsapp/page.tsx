import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { displayPhone } from "@/lib/phone";
import { getVerifyTicket, hashTicket } from "@/lib/phone-verification";
import { createAdminClient } from "@/lib/supabase/admin";
import { chatLink, whatsappConfig } from "@/lib/whatsapp";
import { AuthShell } from "@/components/auth/auth-shell";
import { WhatsappWaiter } from "@/components/auth/whatsapp-waiter";

export async function generateMetadata({ params }: PageProps<"/[locale]/verify-whatsapp">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "auth" });
  return { title: t("waTitle"), robots: { index: false } };
}

export default async function VerifyWhatsappPage({ params }: PageProps<"/[locale]/verify-whatsapp">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const cfg = whatsappConfig();
  const ticket = await getVerifyTicket();
  const admin = createAdminClient();
  const row = cfg.enabled && ticket && admin ? (await admin.rpc("phone_verify_lookup", { p_ticket_hash: hashTicket(ticket) })).data?.[0] : null;
  if (!row) redirect({ href: "/sign-up", locale });
  const t = await getTranslations("auth");
  return (
    <AuthShell
      title={t("waTitle")}
      subtitle={row!.purpose === "signup" ? t("waSubtitleSignup") : t("waSubtitleReset")}
      footer={
        <Link href="/sign-in" className="font-semibold text-accent hover:underline">
          {t("backToSignIn")}
        </Link>
      }
    >
      <WhatsappWaiter
        code={row!.code}
        from={row!.claimed_phone ? displayPhone(row!.claimed_phone) : null}
        number={displayPhone(cfg.number)}
        link={chatLink(cfg.number, row!.code)}
        expiresAt={row!.expires_at}
        purpose={row!.purpose}
      />
    </AuthShell>
  );
}

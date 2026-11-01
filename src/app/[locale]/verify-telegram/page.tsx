import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { getVerifyTicket, hashTicket } from "@/lib/phone-verification";
import { createAdminClient } from "@/lib/supabase/admin";
import { botLink, telegramConfig } from "@/lib/telegram";
import { AuthShell } from "@/components/auth/auth-shell";
import { TelegramWaiter } from "@/components/auth/telegram-waiter";

export async function generateMetadata({ params }: PageProps<"/[locale]/verify-telegram">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "auth" });
  return { title: t("tgTitle"), robots: { index: false } };
}

export default async function VerifyTelegramPage({ params }: PageProps<"/[locale]/verify-telegram">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const cfg = telegramConfig();
  const ticket = await getVerifyTicket();
  const admin = createAdminClient();
  const row = cfg.enabled && ticket && admin ? (await admin.rpc("phone_verify_lookup", { p_ticket_hash: hashTicket(ticket) })).data?.[0] : null;
  if (!row) redirect({ href: "/sign-up", locale });
  const t = await getTranslations("auth");
  return (
    <AuthShell
      title={t("tgTitle")}
      subtitle={row!.purpose === "signup" ? t("tgSubtitleSignup") : t("tgSubtitleReset")}
      footer={
        <Link href="/sign-in" className="font-semibold text-accent hover:underline">
          {t("backToSignIn")}
        </Link>
      }
    >
      <TelegramWaiter
        code={row!.code}
        bot={cfg.username}
        link={botLink(cfg.username, row!.code)}
        expiresAt={row!.expires_at}
        purpose={row!.purpose}
        linked={row!.linked}
      />
    </AuthShell>
  );
}

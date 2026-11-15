import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm, WhatsappResetForm } from "@/components/auth/auth-forms";
import { whatsappConfig } from "@/lib/whatsapp";

export async function generateMetadata({ params }: PageProps<"/[locale]/forgot-password">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "auth" });
  return { title: t("forgotTitle") };
}

export default async function ForgotPasswordPage({ params }: PageProps<"/[locale]/forgot-password">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");
  // E-mail always; accounts made with a phone number recover through the WhatsApp bot once it is set up.
  const byWhatsapp = whatsappConfig().enabled;
  return (
    <AuthShell
      title={t("forgotTitle")}
      subtitle={t("forgotSubtitle")}
      footer={
        <Link href="/sign-in" className="font-semibold text-accent hover:underline">
          {t("backToSignIn")}
        </Link>
      }
    >
      <ForgotPasswordForm />
      {byWhatsapp ? (
        <>
          <div className="flex items-center gap-3 text-xs text-faint" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            {t("or")}
            <span className="h-px flex-1 bg-line" />
          </div>
          <WhatsappResetForm />
        </>
      ) : null}
    </AuthShell>
  );
}

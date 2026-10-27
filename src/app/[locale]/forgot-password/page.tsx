import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/auth-forms";

export async function generateMetadata({ params }: PageProps<"/[locale]/forgot-password">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "auth" });
  return { title: t("forgotTitle") };
}

export default async function ForgotPasswordPage({ params }: PageProps<"/[locale]/forgot-password">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");
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
    </AuthShell>
  );
}

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/auth-forms";

export async function generateMetadata({ params }: PageProps<"/[locale]/reset-password">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "auth" });
  return { title: t("resetTitle") };
}

export default async function ResetPasswordPage({ params }: PageProps<"/[locale]/reset-password">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");
  const user = await getCurrentUser();
  return (
    <AuthShell title={t("resetTitle")} subtitle={t("resetSubtitle")}>
      <ResetPasswordForm hasSession={Boolean(user)} />
    </AuthShell>
  );
}

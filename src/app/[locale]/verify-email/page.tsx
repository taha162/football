import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getPendingEmail } from "@/lib/pending-email";
import { AuthShell } from "@/components/auth/auth-shell";
import { VerifyEmailForm } from "@/components/auth/auth-forms";

export async function generateMetadata({ params }: PageProps<"/[locale]/verify-email">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "auth" });
  return { title: t("verifyEmailTitle"), robots: { index: false } };
}

export default async function VerifyEmailPage({ params }: PageProps<"/[locale]/verify-email">) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (await getCurrentUser()) redirect({ href: "/dashboard", locale });
  const email = await getPendingEmail();
  if (!email) redirect({ href: "/sign-up", locale });
  const t = await getTranslations("auth");
  return (
    <AuthShell
      title={t("verifyEmailTitle")}
      subtitle={t.rich("verifyEmailSubtitle", {
        email: () => (
          <bdi dir="ltr" className="font-medium text-ink">
            {email}
          </bdi>
        ),
      })}
      footer={
        <Link href="/sign-up" className="font-semibold text-accent hover:underline">
          {t("changeEmail")}
        </Link>
      }
    >
      <VerifyEmailForm />
    </AuthShell>
  );
}

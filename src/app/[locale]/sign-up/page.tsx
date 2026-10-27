import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/auth-forms";

export async function generateMetadata({ params }: PageProps<"/[locale]/sign-up">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "auth" });
  return { title: t("createAccount") };
}

export default async function SignUpPage({ params }: PageProps<"/[locale]/sign-up">) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (await getCurrentUser()) redirect({ href: "/dashboard", locale });
  const t = await getTranslations("auth");
  return (
    <AuthShell
      title={t("signUpTitle")}
      subtitle={t("signUpSubtitle")}
      footer={
        <>
          {t("haveAccount")}{" "}
          <Link href="/sign-in" className="font-semibold text-accent hover:underline">
            {t("signIn")}
          </Link>
        </>
      }
    >
      <SignUpForm />
    </AuthShell>
  );
}

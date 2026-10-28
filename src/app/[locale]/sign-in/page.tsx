import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { getCurrentUser, safeNext } from "@/lib/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/auth-forms";
import { Alert } from "@/components/ui/primitives";
import { whatsappConfig } from "@/lib/whatsapp";

export async function generateMetadata({ params }: PageProps<"/[locale]/sign-in">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "auth" });
  return { title: t("signIn") };
}

export default async function SignInPage({ params, searchParams }: PageProps<"/[locale]/sign-in">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const next = safeNext(sp.next, "/dashboard");
  if (await getCurrentUser()) redirect({ href: next, locale });
  const t = await getTranslations("auth");
  return (
    <AuthShell
      title={t("signInTitle")}
      subtitle={t("signInSubtitle")}
      footer={
        <>
          {t("noAccount")}{" "}
          <Link href="/sign-up" className="font-semibold text-accent hover:underline">
            {t("createAccount")}
          </Link>
        </>
      }
    >
      {sp.error === "link_invalid" ? <Alert tone="warning">{t("linkInvalid")}</Alert> : null}
      <SignInForm next={next} allowPhone={whatsappConfig().enabled} />
    </AuthShell>
  );
}

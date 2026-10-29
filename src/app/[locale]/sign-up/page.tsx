import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm, WhatsappSignUpForm } from "@/components/auth/auth-forms";
import { buttonClass } from "@/components/ui/button";
import { whatsappConfig } from "@/lib/whatsapp";
import { LinkButton } from "@/components/ui/link-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/sign-up">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "auth" });
  return { title: t("createAccount") };
}

export default async function SignUpPage({ params, searchParams }: PageProps<"/[locale]/sign-up">) {
  const { locale } = await params;
  const waEnabled = whatsappConfig().enabled;
  const method = waEnabled && (await searchParams).method === "whatsapp" ? "whatsapp" : "email";
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
      {waEnabled ? (
        <nav aria-label={t("verifyMethod")} className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface-2 p-1">
          {(["email", "whatsapp"] as const).map((m) => (
            <LinkButton
              key={m}
              href={{ pathname: "/sign-up", query: m === "email" ? {} : { method: m } }}
              aria-current={method === m ? "page" : undefined}
              className={buttonClass(method === m ? "secondary" : "ghost", "sm", "w-full")}
            >
              {m === "email" ? t("methodEmail") : t("methodWhatsapp")}
            </LinkButton>
          ))}
        </nav>
      ) : null}
      {method === "whatsapp" ? <WhatsappSignUpForm /> : <SignUpForm />}
    </AuthShell>
  );
}

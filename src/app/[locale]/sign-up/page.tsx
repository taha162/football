import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthShell, OtherWay } from "@/components/auth/auth-shell";
import { SignUpForm, WhatsappSignUpForm } from "@/components/auth/auth-forms";
import { whatsappConfig } from "@/lib/whatsapp";

export async function generateMetadata({ params }: PageProps<"/[locale]/sign-up">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "auth" });
  return { title: t("createAccount") };
}

type Method = "email" | "whatsapp";

export default async function SignUpPage({ params, searchParams }: PageProps<"/[locale]/sign-up">) {
  const { locale } = await params;
  const wa = whatsappConfig();
  // WhatsApp first once its bot is set up; the e-mail is the other way, under «أو» (?method=email).
  const methods: Method[] = wa.enabled ? ["whatsapp", "email"] : ["email"];
  const asked = (await searchParams).method;
  const method = methods.find((m) => m === asked) ?? methods[0];
  const other = methods.find((m) => m !== method);
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
          <Link href={{ pathname: "/sign-in", query: method === "email" ? { method } : {} }} className="font-semibold text-accent hover:underline">
            {t("signIn")}
          </Link>
        </>
      }
    >
      {method === "whatsapp" ? <WhatsappSignUpForm offerPromos={wa.canSend} /> : <SignUpForm />}
      {other ? (
        <OtherWay via={other} or={t("or")} href={{ pathname: "/sign-up", query: other === methods[0] ? {} : { method: other } }}>
          {t(other === "email" ? "signUpEmail" : "signUpWhatsapp")}
        </OtherWay>
      ) : null}
    </AuthShell>
  );
}

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { getCurrentUser, safeNext } from "@/lib/auth";
import { AuthShell, OtherWay } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/auth-forms";
import { Alert } from "@/components/ui/primitives";

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
  // The WhatsApp number first; the e-mail is the other way, under «أو» (?method=email).
  const method = sp.method === "email" ? "email" : "whatsapp";
  const keep = typeof sp.next === "string" ? { next } : {};
  return (
    <AuthShell
      title={t("signInTitle")}
      subtitle={t("signInSubtitle")}
      footer={
        <>
          {t("noAccount")}{" "}
          <Link href={{ pathname: "/sign-up", query: method === "email" ? { method } : {} }} className="font-semibold text-accent hover:underline">
            {t("createAccount")}
          </Link>
        </>
      }
    >
      {sp.error === "link_invalid" ? <Alert tone="warning">{t("linkInvalid")}</Alert> : null}
      {/* Sent here by the proxy when the session passed its lifetime (src/lib/session-policy.ts). */}
      {sp.reason === "expired" ? <Alert tone="info">{t("sessionExpired")}</Alert> : null}
      {/* After deleting their own account (Settings → «حذف الحساب»). */}
      {sp.account === "deleted" ? <Alert tone="success">{t("accountDeleted")}</Alert> : null}
      <SignInForm next={next} method={method} />
      {method === "whatsapp" ? (
        <OtherWay via="email" or={t("or")} href={{ pathname: "/sign-in", query: { ...keep, method: "email" } }}>
          {t("continueEmail")}
        </OtherWay>
      ) : (
        <OtherWay via="whatsapp" or={t("or")} href={{ pathname: "/sign-in", query: keep }}>
          {t("continueWhatsappNumber")}
        </OtherWay>
      )}
    </AuthShell>
  );
}

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { safeNext } from "@/lib/auth";
import { afterSecondStep, hasSecondFactor } from "@/lib/second-factor";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/server/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { SecondStepForm } from "@/components/auth/auth-forms";
import { buttonClass } from "@/components/ui/button";

export async function generateMetadata({ params }: PageProps<"/[locale]/mfa">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "auth" });
  return { title: t("secondStepTitle"), robots: { index: false } };
}

/**
 * The second step of signing in: the code from the authenticator app. Only
 * reached with a session that passed the password; until the code is accepted,
 * every other page sends here (src/proxy.ts) and the database shows nothing.
 */
export default async function SecondStepPage({ params, searchParams }: PageProps<"/[locale]/mfa">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const next = afterSecondStep(safeNext((await searchParams).next));
  // Not getCurrentUser(): it reads the profile, which stays hidden until the code is accepted.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect({ href: "/sign-in", locale });
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!hasSecondFactor(data.user) || aal?.currentLevel === "aal2") redirect({ href: next, locale });
  const t = await getTranslations("auth");
  return (
    <AuthShell
      title={t("secondStepTitle")}
      subtitle={t("secondStepSubtitle")}
      footer={
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs text-muted">{t("secondStepLost")}</p>
          <form action={signOutAction}>
            <button type="submit" className={buttonClass("ghost", "sm")}>{t("secondStepSignOut")}</button>
          </form>
        </div>
      }
    >
      <SecondStepForm next={next} />
    </AuthShell>
  );
}

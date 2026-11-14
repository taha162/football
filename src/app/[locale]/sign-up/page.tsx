import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm, TelegramSignUpForm, WhatsappSignUpForm } from "@/components/auth/auth-forms";
import { buttonClass } from "@/components/ui/button";
import { telegramConfig } from "@/lib/telegram";
import { whatsappConfig } from "@/lib/whatsapp";
import { LinkButton } from "@/components/ui/link-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/sign-up">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "auth" });
  return { title: t("createAccount") };
}

type Method = "email" | "telegram" | "whatsapp";
const LABEL = { email: "methodEmail", telegram: "methodTelegram", whatsapp: "methodWhatsapp" } as const;

export default async function SignUpPage({ params, searchParams }: PageProps<"/[locale]/sign-up">) {
  const { locale } = await params;
  const wa = whatsappConfig();
  // Only the ways that are set up: e-mail always, Telegram and WhatsApp once their bots are.
  const methods: Method[] = ["email", ...(telegramConfig().enabled ? (["telegram"] as const) : []), ...(wa.enabled ? (["whatsapp"] as const) : [])];
  const asked = (await searchParams).method;
  const method = methods.find((m) => m !== "email" && m === asked) ?? "email";
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
      {methods.length > 1 ? (
        <nav
          aria-label={t("verifyMethod")}
          className={`grid ${methods.length === 3 ? "grid-cols-3" : "grid-cols-2"} gap-1 rounded-xl border border-line bg-surface-2 p-1`}
        >
          {methods.map((m) => (
            <LinkButton
              key={m}
              href={{ pathname: "/sign-up", query: m === "email" ? {} : { method: m } }}
              aria-current={method === m ? "page" : undefined}
              className={buttonClass(method === m ? "secondary" : "ghost", "sm", "w-full")}
            >
              {t(LABEL[m])}
            </LinkButton>
          ))}
        </nav>
      ) : null}
      {method === "telegram" ? (
        <TelegramSignUpForm offerPromos={wa.canSend} />
      ) : method === "whatsapp" ? (
        <WhatsappSignUpForm offerPromos={wa.canSend} />
      ) : (
        <SignUpForm />
      )}
    </AuthShell>
  );
}

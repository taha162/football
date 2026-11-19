import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Mail, MessageCircle } from "lucide-react";
import { Steps } from "@/components/ui/steps";
import { buttonClass } from "@/components/ui/button";
import { LinkButton, type Href } from "@/components/ui/link-button";

/** The thin line with «أو» between the main way in and the other one. */
export function OrDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-xs text-faint" aria-hidden="true">
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/**
 * The other way in, under «أو»: the divider, then a full-width outlined button
 * with its mark, as sign-in pages offer another provider. It swaps the form on
 * the same page. `-mt-4`: the form above ends with its (empty) message area,
 * so the line sits as far from the button above as from the one below.
 */
export function OtherWay({ href, via, or, children }: { href: Href; via: "email" | "whatsapp"; or: string; children: ReactNode }) {
  return (
    <div className="-mt-4 flex flex-col gap-5">
      <OrDivider label={or} />
      <LinkButton href={href} replace scroll={false} className={buttonClass("outline", "lg", "w-full")}>
        {via === "email" ? (
          <Mail aria-hidden="true" className="size-5 text-muted" />
        ) : (
          <MessageCircle aria-hidden="true" className="size-5 text-[#25d366]" />
        )}
        {children}
      </LinkButton>
    </div>
  );
}

/**
 * Where a new member is on the way in: the account, its confirmation (the
 * WhatsApp message or the e-mailed code), then the player profile.
 */
export async function SignUpSteps({ current, className }: { current: 0 | 1 | 2; className?: string }) {
  const t = await getTranslations("steps");
  return <Steps label={t("signUp")} steps={[t("account"), t("confirm"), t("profile")]} current={current} doneLabel={t("done")} className={className} />;
}

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  steps,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Above the title: where this page is on a longer path (SignUpSteps). */
  steps?: ReactNode;
}) {
  return (
    <div className="relative flex justify-center px-4 py-12 sm:py-20">
      <div aria-hidden="true" className="pitch-lines pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]" />
      <div className="reveal relative flex w-full max-w-md flex-col gap-6 rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-card)] sm:p-8">
        {steps}
        <div className="flex flex-col gap-1.5">
          <h1 className="page-title font-display text-3xl font-bold">{title}</h1>
          {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
        </div>
        {children}
        {footer ? <div className="border-t border-line pt-4 text-center text-sm text-muted">{footer}</div> : null}
      </div>
    </div>
  );
}

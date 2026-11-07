"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Copy, ShieldCheck } from "lucide-react";
import { confirmSecondFactorAction, startSecondFactorAction, turnOffSecondFactorAction } from "@/server/mfa";
import { AppCodeInput } from "@/components/auth/auth-forms";
import { ActionForm, FormField, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";

interface Setup {
  factorId: string;
  qr: string;
  secret: string;
}

/** The secret in groups of four, easier to type into an app by hand. */
const grouped = (secret: string) => secret.replace(/(.{4})(?=.)/g, "$1 ");

/**
 * Settings card: two-step verification with an authenticator app. Off → a
 * QR code (or the key, for setting it up on this same phone) and the first
 * code to confirm it. On → turning it off takes a current code.
 */
export function SecondFactorSettings({ enabled }: { enabled: boolean }) {
  const t = useTranslations("settings");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [copied, setCopied] = useState(false);

  if (enabled) {
    return (
      <div className="flex flex-col gap-4">
        <p className="flex items-center gap-2 text-sm">
          <ShieldCheck className="size-5 text-accent" aria-hidden />
          <Badge tone="success">{t("secondFactorOn")}</Badge>
          <span className="text-muted">{t("secondFactorOnHint")}</span>
        </p>
        <ActionForm action={turnOffSecondFactorAction}>
          <FormField name="code" id="second-factor-off-code" label={t("secondFactorOffLabel")} hint={t("secondFactorOffHint")} required>
            {(a) => <AppCodeInput {...a} />}
          </FormField>
          <SubmitButton variant="outline" className="self-start">{t("secondFactorTurnOff")}</SubmitButton>
        </ActionForm>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">{t("secondFactorIntro")}</p>
        <ActionForm action={startSecondFactorAction} hideSuccess onSuccess={(data) => setSetup(data as Setup)}>
          <SubmitButton className="self-start">{t("secondFactorTurnOn")}</SubmitButton>
        </ActionForm>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex list-decimal flex-col gap-3 ps-5 text-sm">
        <li>{t("secondFactorStep1")}</li>
        <li>
          {t("secondFactorStep2")}
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- a one-time picture made for this person, never stored */}
            <img src={setup.qr} alt={t("secondFactorQrAlt")} width={176} height={176} className="rounded-lg bg-white p-2" />
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-xs text-muted">{t("secondFactorKeyHint")}</p>
              <code dir="ltr" className="break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm" data-testid="second-factor-key">
                {grouped(setup.secret)}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => {
                  void navigator.clipboard?.writeText(setup.secret).then(() => setCopied(true), () => undefined);
                }}
              >
                {copied ? <CheckCircle2 className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copied ? t("secondFactorCopied") : t("secondFactorCopy")}
              </Button>
            </div>
          </div>
        </li>
        <li>{t("secondFactorStep3")}</li>
      </ol>
      <ActionForm action={confirmSecondFactorAction}>
        <Hidden values={{ factor_id: setup.factorId }} />
        <FormField name="code" id="second-factor-on-code" label={t("secondFactorCodeLabel")} required>
          {(a) => <AppCodeInput {...a} autoFocus />}
        </FormField>
        <div className="flex flex-wrap gap-2">
          <SubmitButton>{t("secondFactorConfirm")}</SubmitButton>
          <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
            {t("secondFactorCancel")}
          </Button>
        </div>
      </ActionForm>
    </div>
  );
}

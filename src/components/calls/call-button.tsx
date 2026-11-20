"use client";

import { Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { useCall, type CallPeer } from "./call-provider";

/**
 * Starts a voice call with one person: in a direct conversation (its id), or
 * from their player page (no id yet: the direct conversation is opened first).
 */
export function CallButton({
  conversationId = null,
  peer,
  variant = "outline",
  compact = false,
}: {
  conversationId?: string | null;
  peer: CallPeer;
  variant?: ButtonVariant;
  /** The phone alone, round (a conversation's bar); its name stays «اتصال». */
  compact?: boolean;
}) {
  const t = useTranslations("calls");
  const call = useCall();
  if (!call) return null;
  if (compact) {
    return (
      <Button variant="ghost" onClick={() => call.start(conversationId, peer)} disabled={call.busy} aria-label={t("call")} title={t("call")} className="size-11 shrink-0 rounded-full p-0 text-accent">
        <Phone aria-hidden="true" className="size-5" />
      </Button>
    );
  }
  return (
    <Button variant={variant} size="sm" onClick={() => call.start(conversationId, peer)} disabled={call.busy}>
      <Phone aria-hidden="true" className="size-4" />
      {t("call")}
    </Button>
  );
}

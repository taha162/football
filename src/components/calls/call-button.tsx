"use client";

import { Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { useCall, type CallPeer } from "./call-provider";

/**
 * Starts a voice call with one person: in a direct conversation (its id), or
 * from their player page (no id yet: the direct conversation is opened first).
 */
export function CallButton({ conversationId = null, peer, variant = "outline" }: { conversationId?: string | null; peer: CallPeer; variant?: ButtonVariant }) {
  const t = useTranslations("calls");
  const call = useCall();
  if (!call) return null;
  return (
    <Button variant={variant} size="sm" onClick={() => call.start(conversationId, peer)} disabled={call.busy}>
      <Phone aria-hidden="true" className="size-4" />
      {t("call")}
    </Button>
  );
}

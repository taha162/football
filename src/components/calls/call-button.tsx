"use client";

import { Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useCall, type CallPeer } from "./call-provider";

/** Starts a voice call with the other member of a direct conversation. */
export function CallButton({ conversationId, peer }: { conversationId: string; peer: CallPeer }) {
  const t = useTranslations("calls");
  const call = useCall();
  if (!call) return null;
  return (
    <Button variant="outline" size="sm" onClick={() => call.start(conversationId, peer)} disabled={call.busy}>
      <Phone aria-hidden="true" className="size-4" />
      {t("call")}
    </Button>
  );
}

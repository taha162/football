"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/primitives";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errorPage");
  useEffect(() => {
    // Only the digest is reported; server error details never reach the client.
    console.error("render_error", error.digest);
  }, [error]);
  return (
    <Container className="flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="font-display text-2xl font-bold">{t("title")}</h1>
      <p className="max-w-md text-muted">{t("body")}</p>
      {error.digest ? <p className="font-mono text-xs text-faint">{t("reference", { id: error.digest })}</p> : null}
      <Button onClick={reset}>{t("retry")}</Button>
    </Container>
  );
}
